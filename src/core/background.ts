import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WSL_WINDOWS_DRIVE, defaultPathEnv, isWsl, type PathEnv } from '../config/paths.js';
import type { BackgroundKind, BackgroundMode, BackgroundSize } from '../runtime/background.js';
import { BACKGROUND_PRESETS } from './presets.js';

/**
 * 自訂背景圖設定（專用於 Antigravity App）。
 *
 * 設定存於 `${toolHome}/background.json`；App 主行程掛鉤在每次視窗 `dom-ready`
 * 時讀取，所以換圖或調整參數**不需要重新打包 app.asar**。
 *
 * WSL 注意：Windows 側的 Electron 讀的是 Windows 家目錄下的
 * `%USERPROFILE%\.antigravity-i18n\background.json`，因此在 WSL 中寫入設定時，
 * 會同步鏡像一份到 Windows 家目錄，並記錄圖片的 Windows 路徑。
 */

export const BACKGROUND_FILE = 'background.json';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
export const BACKGROUND_SIZES: readonly BackgroundSize[] = ['cover', 'contain', 'auto'];
export const BACKGROUND_MODES: readonly BackgroundMode[] = ['overlay', 'underlay'];

export interface BackgroundConfig {
  schemaVersion: 1;
  enabled: boolean;
  /**
   * 背景種類：`image`（圖片）或 `preset`（內建漸層）。
   * 舊版（PR #2）寫入的設定沒有此欄位，一律視為 `image`。
   */
  kind?: BackgroundKind;
  /** kind 為 image：正規化後的絕對路徑（以執行 CLI 的系統為準） */
  imagePath?: string;
  /** WSL 中設定時，對應的 Windows 路徑（供 Windows 側 Electron 讀取） */
  windowsPath?: string;
  mime?: string;
  /** kind 為 preset：預設名稱 */
  preset?: string;
  /** 可讀性遮罩顏色；未設定表示不套用 */
  tint?: string;
  opacity: number;
  blur: number;
  size: BackgroundSize;
  position: string;
  mode: BackgroundMode;
  updatedAt: string;
}

export const BACKGROUND_DEFAULTS = {
  opacity: 0.12,
  blur: 0,
  size: 'cover' as BackgroundSize,
  position: 'center',
  mode: 'overlay' as BackgroundMode,
};

export class BackgroundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackgroundError';
  }
}

export function backgroundConfigPath(home: string): string {
  return path.join(home, BACKGROUND_FILE);
}

// ── 參數驗證 ──────────────────────────────────────────────

export function parseOpacity(input: string | number | undefined): number {
  if (input === undefined) return BACKGROUND_DEFAULTS.opacity;
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  if (String(input).trim() === '' || !Number.isFinite(n) || n < 0.01 || n > 1) {
    throw new BackgroundError(`--opacity 必須是 0.01 ~ 1 之間的數字（收到「${input}」）`);
  }
  return n;
}

export function parseBlur(input: string | number | undefined): number {
  if (input === undefined) return BACKGROUND_DEFAULTS.blur;
  const raw = String(input).trim().replace(/px$/i, '');
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new BackgroundError(`--blur 必須是 0 ~ 100 之間的像素值（收到「${input}」）`);
  }
  return n;
}

export function parseSize(input: string | undefined): BackgroundSize {
  if (input === undefined) return BACKGROUND_DEFAULTS.size;
  const v = input.trim().toLowerCase();
  if (!(BACKGROUND_SIZES as readonly string[]).includes(v)) {
    throw new BackgroundError(`--size 可用值：${BACKGROUND_SIZES.join('、')}（收到「${input}」）`);
  }
  return v as BackgroundSize;
}

/** 只允許安全的 CSS background-position 值（避免注入其他 CSS） */
export function parsePosition(input: string | undefined): string {
  if (input === undefined) return BACKGROUND_DEFAULTS.position;
  const v = input.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9%.\s-]{1,64}$/.test(v)) {
    throw new BackgroundError(`--position 只能包含英數字、空白、%、. 與 -，例如 center、top right、50% 20%（收到「${input}」）`);
  }
  return v;
}

/**
 * 可讀性遮罩只接受安全的 CSS 顏色值：`#hex`（3/4/6/8 位）、`rgb()` / `rgba()` /
 * `hsl()` / `hsla()`、`transparent` / `black` / `white`，或 `none`（清除）。
 * 這個規則與 src/runtime/background.ts 內的 TINT_RE 必須一致（測試會比對）。
 */
export const TINT_RE =
  /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgba?|hsla?)\(\s*[0-9.+\-%\s,/]*\d[0-9.+\-%\s,/]*(?:(?:deg|turn|rad|grad)[0-9.+\-%\s,/]*)?\)|transparent|black|white)$/i;

/** 回傳正規化的 tint；`none` 或未提供時回傳 undefined（不套用） */
export function parseTint(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const v = input.trim().replace(/\s+/g, ' ');
  if (v.toLowerCase() === 'none') return undefined;
  // rgb()/hsl() 的括號內至少要有一個數字（規則已寫在 TINT_RE 內，三端一致）
  if (v.length > 64 || !TINT_RE.test(v)) {
    throw new BackgroundError(
      `--tint 只接受 #hex、rgb()、rgba()、hsl()、hsla()、transparent、black、white 或 none，例如 "rgba(0,0,0,0.25)"、"#00000040"（收到「${input}」）`,
    );
  }
  return v;
}

export function parseMode(input: string | undefined): BackgroundMode {
  if (input === undefined) return BACKGROUND_DEFAULTS.mode;
  const v = input.trim().toLowerCase();
  if (!(BACKGROUND_MODES as readonly string[]).includes(v)) {
    throw new BackgroundError(`--mode 可用值：${BACKGROUND_MODES.join('、')}（收到「${input}」）`);
  }
  return v as BackgroundMode;
}

export interface ValidatedImage {
  absPath: string;
  mime: string;
  size: number;
}

/** 檢查圖片格式與大小，並將相對路徑正規化為絕對路徑 */
export function validateImage(imagePath: string, cwd = process.cwd()): ValidatedImage {
  if (!imagePath || imagePath.trim() === '') throw new BackgroundError('請指定圖片路徑');
  const absPath = path.resolve(cwd, imagePath.trim());
  const ext = path.extname(absPath).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) {
    throw new BackgroundError(`不支援的圖片格式「${ext || '（無副檔名）'}」，僅支援 ${Object.keys(IMAGE_MIME).join('、')}`);
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(absPath);
  } catch {
    throw new BackgroundError(`找不到圖片：${absPath}`);
  }
  if (!st.isFile()) throw new BackgroundError(`不是檔案：${absPath}`);
  if (st.size > MAX_IMAGE_BYTES) {
    throw new BackgroundError(`圖片大小 ${(st.size / 1024 / 1024).toFixed(1)} MB 超過上限 10 MB：${absPath}`);
  }
  if (st.size === 0) throw new BackgroundError(`圖片是空檔案：${absPath}`);
  return { absPath, mime, size: st.size };
}

// ── WSL 路徑轉換 ──────────────────────────────────────────

/**
 * WSL 路徑 → Windows 路徑：
 * - `/mnt/c/Users/me/a.png` → `C:\Users\me\a.png`
 * - 其他 Linux 路徑（需提供 distro）→ `\\wsl.localhost\<distro>\home\me\a.png`
 */
export function wslToWindowsPath(p: string, distro?: string): string | null {
  const m = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(p);
  if (m?.[1]) {
    const rest = (m[2] ?? '').split('/').filter(Boolean).join('\\');
    return `${m[1].toUpperCase()}:\\${rest}`;
  }
  if (distro && p.startsWith('/')) return `\\\\wsl.localhost\\${distro}${p.split('/').join('\\')}`;
  return null;
}

/** Windows 路徑 → WSL 路徑：`C:\Users\me` → `/mnt/c/Users/me` */
export function windowsToWslPath(p: string): string | null {
  const m = /^([a-zA-Z]):[\\/]?(.*)$/.exec(p.trim());
  if (!m?.[1]) return null;
  const rest = (m[2] ?? '').split(/[\\/]+/).filter(Boolean).join('/');
  return `/mnt/${m[1].toLowerCase()}${rest ? `/${rest}` : ''}`;
}

export type CommandRunner = (cmd: string, args: string[]) => string;

const defaultRunner: CommandRunner = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000, cwd: WSL_WINDOWS_DRIVE, stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * 找出 WSL 對應的 Windows 家目錄（WSL 路徑形式，例如 `/mnt/c/Users/me`）：
 * 1. 環境變數 `ANTIGRAVITY_I18N_WIN_HOME`（可寫 `C:\Users\me` 或 `/mnt/c/Users/me`）
 * 2. 透過 WSL interop 執行 `cmd.exe /c "chcp 65001 >nul & echo %USERPROFILE%"`，且目錄必須存在
 * 3. `/mnt/c/Users` 下只有一位使用者時使用該使用者
 */
export function resolveWindowsHome(
  pe: PathEnv,
  run: CommandRunner = defaultRunner,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): string | null {
  const override = pe.env.ANTIGRAVITY_I18N_WIN_HOME?.trim();
  if (override) return override.startsWith('/') ? override : windowsToWslPath(override);
  try {
    // 先切到 UTF-8 codepage，避免非 UTF-8 系統（例如 cp950 / cp936）上的中文使用者名稱變成亂碼
    const out = run('cmd.exe', ['/d', '/c', 'chcp 65001 >nul & echo %USERPROFILE%']).trim().split(/\r?\n/).pop()?.trim() ?? '';
    if (/^[A-Za-z]:\\/.test(out)) {
      const wslPath = windowsToWslPath(out);
      // 驗證轉換後的目錄確實存在才採用（亂碼路徑不會存在）
      if (wslPath && exists(wslPath)) return wslPath;
    }
  } catch {
    /* interop 未啟用 */
  }
  const users = pe.wslWindowsUsers ?? [];
  return users.length === 1 && users[0] ? `${WSL_WINDOWS_DRIVE}/Users/${users[0]}` : null;
}

export interface WslContext {
  distro?: string;
  /** Windows 家目錄（WSL 路徑形式） */
  windowsHome: string | null;
}

/** 目前環境為 WSL 時回傳 WSL 資訊，否則 null */
export function detectWslContext(pe: PathEnv = defaultPathEnv(), run?: CommandRunner): WslContext | null {
  if (!isWsl(pe.env, pe.platform)) return null;
  return { distro: pe.env.WSL_DISTRO_NAME, windowsHome: resolveWindowsHome(pe, run) };
}

/** WSL 中，Windows 側 Electron 會讀取的工具資料目錄（WSL 路徑形式） */
export function mirrorHome(wsl: WslContext | null, home: string): string | null {
  if (!wsl?.windowsHome) return null;
  const m = path.posix.join(wsl.windowsHome, '.antigravity-i18n');
  return path.resolve(m) === path.resolve(home) ? null : m;
}

// ── 讀寫設定 ──────────────────────────────────────────────

export function readBackgroundConfig(home: string): BackgroundConfig | null {
  const file = backgroundConfigPath(home);
  if (!fs.existsSync(file)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as BackgroundConfig;
    if (!cfg || typeof cfg !== 'object') return null;
    if (cfg.kind === 'preset') return typeof cfg.preset === 'string' ? cfg : null;
    // 沒有 kind 的舊設定視為圖片
    return typeof cfg.imagePath === 'string' ? { ...cfg, kind: 'image' } : null;
  } catch {
    throw new BackgroundError(`背景圖設定檔格式錯誤：${file}（可執行 bg clear 後重新設定）`);
  }
}

function writeConfigFile(home: string, cfg: BackgroundConfig): string {
  const file = backgroundConfigPath(home);
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

export interface WriteResult {
  config: BackgroundConfig;
  file: string;
  /** WSL 中同步寫到 Windows 家目錄的鏡像檔 */
  mirror?: string;
  warnings: string[];
}

function writeWithMirror(home: string, cfg: BackgroundConfig, wsl: WslContext | null): WriteResult {
  const warnings: string[] = [];
  const file = writeConfigFile(home, cfg);
  let mirror: string | undefined;
  const mh = mirrorHome(wsl, home);
  if (mh) {
    try {
      mirror = writeConfigFile(mh, cfg);
    } catch (e) {
      warnings.push(`無法寫入 Windows 側設定檔（${mh}）：${(e as Error).message}`);
    }
  } else if (wsl && !wsl.windowsHome) {
    warnings.push('偵測到 WSL，但找不到 Windows 家目錄，Windows 版 Antigravity 可能讀不到設定；可設定 ANTIGRAVITY_I18N_WIN_HOME=C:\\Users\\<你>');
  }
  return { config: cfg, file, mirror, warnings };
}

export interface SetBackgroundOptions {
  opacity?: string | number;
  blur?: string | number;
  size?: string;
  position?: string;
  mode?: string;
  tint?: string;
  cwd?: string;
  /** 測試用：注入 WSL 狀態；未提供時自動偵測 */
  wsl?: WslContext | null;
  /** 已知的 Windows 路徑（例如上傳時已複製到 Windows 家目錄），優先於自動換算 */
  windowsPath?: string;
  now?: Date;
}

export function setBackground(home: string, imagePath: string, opts: SetBackgroundOptions = {}): WriteResult {
  const img = validateImage(imagePath, opts.cwd);
  const tint = parseTint(opts.tint);
  const cfg: BackgroundConfig = {
    schemaVersion: 1,
    enabled: true,
    kind: 'image',
    imagePath: img.absPath,
    mime: img.mime,
    opacity: parseOpacity(opts.opacity),
    blur: parseBlur(opts.blur),
    size: parseSize(opts.size),
    position: parsePosition(opts.position),
    mode: parseMode(opts.mode),
    ...(tint ? { tint } : {}),
    updatedAt: (opts.now ?? new Date()).toISOString(),
  };
  const wsl = opts.wsl !== undefined ? opts.wsl : detectWslContext();
  const extra: string[] = [];
  if (wsl && opts.windowsPath) {
    cfg.windowsPath = opts.windowsPath;
  } else if (wsl) {
    const win = wslToWindowsPath(img.absPath, wsl.distro);
    if (win) cfg.windowsPath = win;
    if (!img.absPath.startsWith('/mnt/')) {
      extra.push('圖片位於 WSL 檔案系統，Windows 版 Antigravity 只能在 WSL 執行中時讀取；建議改放到 Windows 磁碟（/mnt/c/...）。');
    }
  }
  const r = writeWithMirror(home, cfg, wsl);
  r.warnings.unshift(...extra);
  return r;
}

// ── 上傳圖片（圖形控制台的「選擇電腦圖片…」） ──────────────

/** 上傳的圖片存成 `${toolHome}/wallpaper.<ext>` */
export const UPLOAD_BASENAME = 'wallpaper';

/** 以檔案開頭的魔術位元組判斷圖片格式（不信任副檔名或 Content-Type） */
export function sniffImage(data: Buffer): { ext: string; mime: string } | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString('latin1'))) return { ext: 'gif', mime: 'image/gif' };
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

function removeOldUploads(dir: string): void {
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) fs.rmSync(path.join(dir, `${UPLOAD_BASENAME}.${ext}`), { force: true });
}

export interface UploadResult extends WriteResult {
  imagePath: string;
  /** WSL 中複製到 Windows 家目錄的圖片 */
  mirrorImage?: string;
}

/**
 * 儲存上傳的圖片並設為背景。
 * WSL 中會把圖片一併複製到 Windows 家目錄，設定檔記錄那一份的 Windows 路徑，
 * 讓 Windows 版 Antigravity 不必依賴 WSL 檔案系統（\\wsl.localhost）就能讀取。
 */
export function saveUploadedImage(home: string, data: Buffer, opts: SetBackgroundOptions = {}): UploadResult {
  if (data.length === 0) throw new BackgroundError('沒有收到圖片內容');
  if (data.length > MAX_IMAGE_BYTES) {
    throw new BackgroundError(`圖片大小 ${(data.length / 1024 / 1024).toFixed(1)} MB 超過上限 10 MB`);
  }
  const kind = sniffImage(data);
  if (!kind) throw new BackgroundError('只支援 PNG、JPEG、WebP、GIF 圖片');
  // 先驗證其餘參數，避免寫了圖片才發現參數錯誤
  parseOpacity(opts.opacity);
  parseBlur(opts.blur);
  parseSize(opts.size);
  parsePosition(opts.position);
  parseMode(opts.mode);
  parseTint(opts.tint);

  fs.mkdirSync(home, { recursive: true });
  removeOldUploads(home);
  const imagePath = path.join(home, `${UPLOAD_BASENAME}.${kind.ext}`);
  fs.writeFileSync(imagePath, data);

  const wsl = opts.wsl !== undefined ? opts.wsl : detectWslContext();
  const mh = mirrorHome(wsl, home);
  let mirrorImage: string | undefined;
  let windowsPath: string | undefined;
  if (mh) {
    try {
      fs.mkdirSync(mh, { recursive: true });
      removeOldUploads(mh);
      mirrorImage = path.join(mh, `${UPLOAD_BASENAME}.${kind.ext}`);
      fs.writeFileSync(mirrorImage, data);
      windowsPath = wslToWindowsPath(mirrorImage, wsl?.distro) ?? undefined;
    } catch {
      mirrorImage = undefined;
    }
  }
  const r = setBackground(home, imagePath, { ...opts, wsl, windowsPath });
  return { ...r, imagePath, mirrorImage };
}

export interface SetPresetOptions {
  opacity?: string | number;
  blur?: string | number;
  tint?: string;
  mode?: string;
  wsl?: WslContext | null;
  now?: Date;
}

/** 列出內建預設名稱 */
export function presetNames(): string[] {
  return Object.keys(BACKGROUND_PRESETS);
}

/** bg preset <name>：寫入同一份 background.json（含 WSL 鏡像） */
export function setPreset(home: string, name: string, opts: SetPresetOptions = {}): WriteResult {
  const key = name.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(BACKGROUND_PRESETS, key)) {
    throw new BackgroundError(`未知的預設「${name}」，可用：${presetNames().join('、')}（執行 bg presets 查看說明）`);
  }
  const tint = parseTint(opts.tint);
  const cfg: BackgroundConfig = {
    schemaVersion: 1,
    enabled: true,
    kind: 'preset',
    preset: key,
    opacity: parseOpacity(opts.opacity),
    blur: parseBlur(opts.blur),
    size: 'cover',
    position: 'center',
    mode: parseMode(opts.mode),
    ...(tint ? { tint } : {}),
    updatedAt: (opts.now ?? new Date()).toISOString(),
  };
  return writeWithMirror(home, cfg, opts.wsl !== undefined ? opts.wsl : detectWslContext());
}

/** bg on / bg off：只切換啟用狀態，保留其他設定 */
export function setBackgroundEnabled(home: string, enabled: boolean, opts: { wsl?: WslContext | null; now?: Date } = {}): WriteResult {
  const cfg = readBackgroundConfig(home);
  if (!cfg) throw new BackgroundError('尚未設定背景圖，請先執行：antigravity-i18n bg set <圖片路徑>');
  const next: BackgroundConfig = { ...cfg, enabled, updatedAt: (opts.now ?? new Date()).toISOString() };
  return writeWithMirror(home, next, opts.wsl !== undefined ? opts.wsl : detectWslContext());
}

/** bg clear：刪除設定檔（含 WSL 鏡像） */
export function clearBackground(home: string, opts: { wsl?: WslContext | null } = {}): string[] {
  const removed: string[] = [];
  const wsl = opts.wsl !== undefined ? opts.wsl : detectWslContext();
  for (const h of [home, mirrorHome(wsl, home)]) {
    if (!h) continue;
    const f = backgroundConfigPath(h);
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      removed.push(f);
    }
  }
  return removed;
}

export interface BackgroundStatus {
  file: string;
  config: BackgroundConfig | null;
  imageExists: boolean;
  imageSize?: number;
  /** kind 為 preset 時，名稱是否為內建預設 */
  presetKnown?: boolean;
  /** WSL 鏡像檔（存在時） */
  mirror?: string;
  mirrorInSync?: boolean;
}

export function backgroundStatus(home: string, opts: { wsl?: WslContext | null } = {}): BackgroundStatus {
  const file = backgroundConfigPath(home);
  const config = readBackgroundConfig(home);
  const st: BackgroundStatus = { file, config, imageExists: false };
  if (config?.kind === 'preset') {
    st.presetKnown = Object.prototype.hasOwnProperty.call(BACKGROUND_PRESETS, config.preset ?? '');
  } else if (config?.imagePath) {
    try {
      const s = fs.statSync(config.imagePath);
      st.imageExists = s.isFile();
      st.imageSize = s.size;
    } catch {
      st.imageExists = false;
    }
  }
  const mh = mirrorHome(opts.wsl !== undefined ? opts.wsl : detectWslContext(), home);
  if (mh) {
    const mf = backgroundConfigPath(mh);
    st.mirror = mf;
    try {
      st.mirrorInSync = fs.existsSync(mf) && fs.existsSync(file) && fs.readFileSync(mf, 'utf8') === fs.readFileSync(file, 'utf8');
    } catch {
      st.mirrorInSync = false;
    }
  }
  return st;
}
