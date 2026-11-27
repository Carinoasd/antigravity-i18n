import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ApplyLang, DetectedTarget, Dictionary, Manifest } from '../types.js';
import type { AsarArchiver } from './asar.js';
import { listManifests, manifestPathFor, readManifest, sha256File } from './backup.js';
import { wslToWindowsPath } from './background.js';
import { FileLockError, formatFsError } from './errors.js';
import { applyTarget, type ApplyResult } from './patcher.js';
import { HOOK_VERSION, type RuntimeDicts } from './runtime.js';

/**
 * 智慧啟動器：`antigravity-i18n launch`。
 *
 * 解決 Antigravity 自動更新覆蓋 `app.asar` 的問題，但**不常駐任何背景行程**：
 * 只在使用者透過捷徑啟動 Antigravity 的那一刻檢查一次，必要時重新套用，
 * 接著以 detached 方式啟動 Antigravity 並立即結束自身行程。
 *
 * 1. 讀取 manifest（readManifest），比對目前 `app.asar` 的 SHA-256 與 `patchedSha256`
 *    - 為了毫秒級跳過，以 `launch-state.json` 快取「大小＋修改時間＋inode → SHA-256」，
 *      只有檔案的 stat 改變時才重新計算雜湊
 * 2. SHA-256 不同（官方剛自動更新）、掛鉤版本過舊或指定了不同語系 → 重新 `applyTarget`
 *    （以新版檔案為原始檔重新備份後套用）
 * 3. 遇到 FileLockError（Antigravity 已在執行中）不中斷，只提示並略過本次重套用
 * 4. 以平台對應的方式啟動 Antigravity（spawn 可注入，方便單元測試）
 */

export const LAUNCH_STATE_FILE = 'launch-state.json';

// ── 平台啟動指令（純函式） ─────────────────────────────────

export interface LaunchCommand {
  cmd: string;
  args: string[];
  /** 子行程的工作目錄（WSL 呼叫 cmd.exe 時切到 /mnt/c，避免 UNC 路徑警告） */
  cwd?: string;
  /** 給使用者看的說明 */
  display: string;
}

export interface LaunchEnv {
  platform: NodeJS.Platform;
  /** 是否在 WSL 中執行 */
  wsl: boolean;
  exists: (p: string) => boolean;
}

export class LaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchError';
  }
}

const WINDOWS_EXE_NAMES = ['Antigravity.exe', 'Antigravity App.exe'];
const LINUX_EXE_NAMES = ['antigravity', 'Antigravity', 'antigravity-app'];
/** cmd.exe 會解讀的特殊字元：WSL 經 cmd.exe 啟動時一律拒絕，避免指令注入 */
const CMD_META_RE = /["&|<>^%!\r\n]/;

/**
 * 安裝根目錄的候選位置：以 `--path` 指向 `app.asar` 時 installRoot 會是 `resources/`，
 * 執行檔在上一層。
 */
function rootCandidates(installRoot: string, lib: path.PlatformPath): string[] {
  const out = [installRoot];
  if (lib.basename(installRoot).toLowerCase() === 'resources') out.push(lib.dirname(installRoot));
  return out;
}

/** 找出 Windows 版 Antigravity 的執行檔；找不到時回傳 `<installRoot>\Antigravity.exe` 與 found=false */
export function findWindowsExe(installRoot: string, exists: (p: string) => boolean, lib: path.PlatformPath = path.win32): { exe: string; found: boolean } {
  for (const root of rootCandidates(installRoot, lib)) {
    for (const name of WINDOWS_EXE_NAMES) {
      const exe = lib.join(root, name);
      if (exists(exe)) return { exe, found: true };
    }
  }
  return { exe: lib.join(installRoot, WINDOWS_EXE_NAMES[0]!), found: false };
}

/** WSL 的 Windows 系統磁碟路徑（/mnt/<drive>/...） */
export function isWslWindowsPath(p: string): boolean {
  return /^\/mnt\/[a-zA-Z](?:\/|$)/.test(p);
}

/** 依平台產生啟動 Antigravity 的指令 */
export function launchCommandFor(installRoot: string, env: LaunchEnv): LaunchCommand {
  if (env.platform === 'win32') {
    const { exe, found } = findWindowsExe(installRoot, env.exists);
    if (!found) throw new LaunchError(`找不到 Antigravity 執行檔：${exe}`);
    return { cmd: exe, args: [], display: exe };
  }
  if (env.platform === 'darwin') {
    return { cmd: 'open', args: ['-a', installRoot], display: `open -a "${installRoot}"` };
  }
  if (env.platform === 'linux' && env.wsl && isWslWindowsPath(installRoot)) {
    // WSL + Windows 側安裝：轉成 Windows 路徑，交給 cmd.exe 的 start 啟動（脫離 WSL 工作階段）
    const { exe, found } = findWindowsExe(installRoot, env.exists, path.posix);
    if (!found) throw new LaunchError(`找不到 Windows 側的 Antigravity 執行檔：${exe}`);
    const winExe = wslToWindowsPath(exe);
    if (!winExe) throw new LaunchError(`無法把 ${exe} 轉換為 Windows 路徑`);
    if (CMD_META_RE.test(winExe)) throw new LaunchError(`Antigravity 的安裝路徑含有 cmd.exe 特殊字元，無法安全啟動：${winExe}`);
    const cmdExe = '/mnt/c/Windows/System32/cmd.exe';
    return {
      cmd: env.exists(cmdExe) ? cmdExe : 'cmd.exe',
      args: ['/d', '/c', 'start', '', winExe],
      cwd: env.exists('/mnt/c') ? '/mnt/c' : undefined,
      display: `cmd.exe /c start "" "${winExe}"`,
    };
  }
  for (const root of rootCandidates(installRoot, path.posix)) {
    for (const name of LINUX_EXE_NAMES) {
      const exe = path.posix.join(root, name);
      if (env.exists(exe)) return { cmd: exe, args: [], display: exe };
    }
  }
  throw new LaunchError(`在 ${installRoot} 下找不到 antigravity 執行檔`);
}

// ── 啟動子行程（spawn 可注入） ───────────────────────────

export interface ChildLike {
  once(event: 'spawn', fn: () => void): unknown;
  once(event: 'error', fn: (e: Error) => void): unknown;
  unref(): void;
}

export interface SpawnOptionsLike {
  detached: true;
  stdio: 'ignore';
  cwd?: string;
  windowsHide?: boolean;
}

export type Spawn = (cmd: string, args: string[], opts: SpawnOptionsLike) => ChildLike;

export const defaultSpawn: Spawn = (cmd, args, opts) => nodeSpawn(cmd, args, opts);

/**
 * 以 detached 方式啟動並 `unref()`，讓本工具可以立刻結束、不影響 Antigravity。
 * 等到子行程確實建立（spawn 事件）或失敗（error 事件）才 resolve，通常只需數毫秒。
 */
export function spawnDetached(c: LaunchCommand, spawn: Spawn = defaultSpawn): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildLike;
    try {
      child = spawn(c.cmd, c.args, { detached: true, stdio: 'ignore', ...(c.cwd ? { cwd: c.cwd } : {}), windowsHide: false });
    } catch (e) {
      reject(e);
      return;
    }
    let done = false;
    child.once('spawn', () => {
      if (done) return;
      done = true;
      child.unref();
      resolve();
    });
    child.once('error', (e) => {
      if (done) return;
      done = true;
      reject(e);
    });
  });
}

// ── 檢查是否需要重新套用 ──────────────────────────────────

interface StatStamp {
  size: number;
  mtimeMs: number;
  ino: number;
}

interface LaunchState {
  /** asar 路徑 → stat 與 SHA-256 */
  hashes: Record<string, StatStamp & { sha256: string }>;
}

function readLaunchState(toolHome: string): LaunchState {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(toolHome, LAUNCH_STATE_FILE), 'utf8')) as Partial<LaunchState>;
    if (v && typeof v === 'object' && v.hashes && typeof v.hashes === 'object') return { hashes: v.hashes };
  } catch {
    /* 沒有或損毀的快取一律重新計算 */
  }
  return { hashes: {} };
}

function writeLaunchState(toolHome: string, state: LaunchState): void {
  try {
    fs.mkdirSync(toolHome, { recursive: true });
    const file = path.join(toolHome, LAUNCH_STATE_FILE);
    const tmp = `${file}.agi18n-tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    /* 快取寫入失敗只影響下次速度 */
  }
}

/**
 * 取得檔案 SHA-256：stat（大小、修改時間、inode）與快取相同時直接使用快取，
 * 否則重新計算並更新快取。回傳值中的 cached 表示是否命中快取。
 */
export async function cachedSha256(file: string, toolHome: string): Promise<{ sha256: string; cached: boolean }> {
  const st = fs.statSync(file);
  const stamp: StatStamp = { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
  const state = readLaunchState(toolHome);
  const hit = state.hashes[file];
  if (hit && hit.size === stamp.size && hit.mtimeMs === stamp.mtimeMs && hit.ino === stamp.ino && typeof hit.sha256 === 'string') {
    return { sha256: hit.sha256, cached: true };
  }
  const sha256 = await sha256File(file);
  state.hashes[file] = { ...stamp, sha256 };
  writeLaunchState(toolHome, state);
  return { sha256, cached: false };
}

/** 記住剛寫入檔案的 SHA-256（已由 patcher 計算過），避免下次啟動重新計算 */
export function rememberSha256(file: string, sha256: string, toolHome: string): void {
  try {
    const st = fs.statSync(file);
    const state = readLaunchState(toolHome);
    state.hashes[file] = { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, sha256 };
    writeLaunchState(toolHome, state);
  } catch {
    /* 只影響下次速度 */
  }
}

export type ReapplyReason = 'updated' | 'old-hook' | 'lang-changed';

export interface ReapplyCheck {
  needed: boolean;
  reasons: ReapplyReason[];
  /** 重新套用時使用的語系（--lang 優先，否則沿用 manifest） */
  lang: ApplyLang;
}

/** 純函式：依 manifest 與目前 asar 的 SHA-256 判斷是否需要重新套用 */
export function checkReapply(manifest: Manifest, asarPath: string, currentSha256: string, langOverride?: ApplyLang): ReapplyCheck {
  const reasons: ReapplyReason[] = [];
  const mf = manifest.files.find((f) => f.path === asarPath) ?? manifest.files.find((f) => f.role === 'content');
  if (!mf || mf.patchedSha256 !== currentSha256) reasons.push('updated');
  // --no-runtime 套用的 manifest 沒有掛鉤，不視為舊版掛鉤
  if (manifest.runtime && (manifest.runtime.hookVersion ?? 1) < HOOK_VERSION) reasons.push('old-hook');
  if (langOverride !== undefined && langOverride !== manifest.lang) reasons.push('lang-changed');
  return { needed: reasons.length > 0, reasons, lang: langOverride ?? manifest.lang };
}

// ── 整體流程 ──────────────────────────────────────────────

export interface LaunchOptions {
  lang?: ApplyLang;
  /** --path：手動指定 App 安裝路徑 */
  path?: string;
  /** false：只啟動，不檢查、不重新套用（--no-reapply） */
  reapply?: boolean;
}

export interface LaunchDeps {
  toolHome: string;
  toolVersion: string;
  detect: (customPath?: string) => DetectedTarget | null;
  loadDict: (lang: Exclude<ApplyLang, 'none'>) => Dictionary;
  /** 打包進多語系 runtime 的四語詞庫（未提供時 runtime 只含重新套用的語系） */
  loadRuntimeDicts?: () => RuntimeDicts;
  env: LaunchEnv;
  spawn?: Spawn;
  archiver?: AsarArchiver;
  /** 測試用：取代 applyTarget */
  apply?: typeof applyTarget;
}

export type LaunchReapplyStatus =
  /** 已是最新修補狀態，直接啟動 */
  | 'up-to-date'
  /** 偵測到更新或舊版掛鉤，已重新套用 */
  | 'reapplied'
  /** Antigravity 執行中，檔案被鎖定，略過本次重套用 */
  | 'locked'
  /** 重新套用失敗（仍會啟動） */
  | 'failed'
  /** 尚未套用過（沒有 manifest） */
  | 'not-applied'
  /** --no-reapply */
  | 'disabled';

export interface LaunchResult {
  installRoot: string;
  status: LaunchReapplyStatus;
  reasons: ReapplyReason[];
  lang?: ApplyLang;
  /** asar SHA-256 是否命中 stat 快取（毫秒級跳過） */
  cached?: boolean;
  apply?: ApplyResult;
  error?: string;
  /** FileLockError 的處理步驟 */
  steps?: string[];
  command: LaunchCommand;
  launched: boolean;
}

/** 找出 App：先依 --path / 自動偵測，偵測不到時改用先前套用紀錄（例如以 --path 套用過）的安裝路徑 */
export function resolveLaunchTarget(deps: Pick<LaunchDeps, 'detect' | 'toolHome'>, customPath?: string): DetectedTarget | null {
  const t = deps.detect(customPath);
  if (t || customPath) return t;
  for (const { manifest } of listManifests(deps.toolHome, 'app')) {
    const fromManifest = deps.detect(manifest.installRoot);
    if (fromManifest) return fromManifest;
  }
  return null;
}

export async function smartLaunch(opts: LaunchOptions, deps: LaunchDeps): Promise<LaunchResult> {
  const target = resolveLaunchTarget(deps, opts.path);
  if (!target) throw new LaunchError('找不到 Antigravity App 的安裝位置，請以 --path 手動指定');
  // 先確認能啟動，再決定要不要修補（找不到執行檔時不做任何寫入）
  const command = launchCommandFor(target.installRoot, deps.env);
  const result: LaunchResult = { installRoot: target.installRoot, status: 'disabled', reasons: [], command, launched: false };

  if (opts.reapply !== false) {
    const manifest = readManifest(manifestPathFor(deps.toolHome, target));
    const asarPath = target.files[0];
    if (!manifest || !asarPath) {
      result.status = 'not-applied';
      result.lang = opts.lang;
    } else {
      const { sha256, cached } = await cachedSha256(asarPath, deps.toolHome);
      result.cached = cached;
      const check = checkReapply(manifest, asarPath, sha256, opts.lang);
      result.reasons = check.reasons;
      result.lang = check.lang;
      if (!check.needed) {
        result.status = 'up-to-date';
      } else {
        try {
          const lang = check.lang;
          const r = await (deps.apply ?? applyTarget)(target, {
            lang,
            dict: lang === 'none' ? {} : deps.loadDict(lang),
            toolHome: deps.toolHome,
            force: true,
            toolVersion: deps.toolVersion,
            // 沿用上次的選擇：以 --no-runtime 套用過的就維持只有靜態層
            runtime: lang === 'none' || manifest.runtime !== undefined,
            runtimeDicts: lang !== 'none' && manifest.runtime !== undefined ? deps.loadRuntimeDicts?.() : undefined,
            archiver: deps.archiver,
          });
          result.apply = r;
          result.status = r.status === 'applied' || r.status === 'already-applied' ? 'reapplied' : 'failed';
          if (result.status === 'failed') result.error = r.warnings.join('；') || `重新套用結果：${r.status}`;
          if (r.status === 'applied') {
            // 新版 asar 的雜湊（patcher 已計算並寫進 manifest）直接記進快取，下次啟動即可毫秒級跳過
            const patched = readManifest(r.manifestPath)?.files.find((f) => f.path === asarPath)?.patchedSha256;
            if (patched) rememberSha256(asarPath, patched, deps.toolHome);
          }
        } catch (e) {
          if (e instanceof FileLockError) {
            result.status = 'locked';
            result.error = e.message;
            result.steps = e.steps;
          } else {
            result.status = 'failed';
            result.error = formatFsError(e);
          }
        }
      }
    }
  }

  await spawnDetached(command, deps.spawn);
  result.launched = true;
  return result;
}
