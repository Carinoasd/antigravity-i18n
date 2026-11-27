import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WSL_WINDOWS_DRIVE, defaultPathEnv, isWsl, type PathEnv } from '../config/paths.js';
import type { BackgroundMode, BackgroundSize } from '../runtime/background.js';

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
  /** 正規化後的絕對路徑（以執行 CLI 的系統為準） */
  imagePath: string;
  /** WSL 中設定時，對應的 Windows 路徑（供 Windows 側 Electron 讀取） */
  windowsPath?: string;
  mime: string;
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
 * 2. 透過 WSL interop 執行 `cmd.exe /c echo %USERPROFILE%`
 * 3. `/mnt/c/Users` 下只有一位使用者時使用該使用者
 */
export function resolveWindowsHome(pe: PathEnv, run: CommandRunner = defaultRunner): string | null {
  const override = pe.env.ANTIGRAVITY_I18N_WIN_HOME?.trim();
  if (override) return override.startsWith('/') ? override : windowsToWslPath(override);
  try {
    const out = run('cmd.exe', ['/d', '/c', 'echo %USERPROFILE%']).trim().split(/\r?\n/).pop()?.trim() ?? '';
    if (/^[A-Za-z]:\\/.test(out)) return windowsToWslPath(out);
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
    return cfg && typeof cfg.imagePath === 'string' ? cfg : null;
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
  cwd?: string;
  /** 測試用：注入 WSL 狀態；未提供時自動偵測 */
  wsl?: WslContext | null;
  now?: Date;
}

export function setBackground(home: string, imagePath: string, opts: SetBackgroundOptions = {}): WriteResult {
  const img = validateImage(imagePath, opts.cwd);
  const cfg: BackgroundConfig = {
    schemaVersion: 1,
    enabled: true,
    imagePath: img.absPath,
    mime: img.mime,
    opacity: parseOpacity(opts.opacity),
    blur: parseBlur(opts.blur),
    size: parseSize(opts.size),
    position: parsePosition(opts.position),
    mode: parseMode(opts.mode),
    updatedAt: (opts.now ?? new Date()).toISOString(),
  };
  const wsl = opts.wsl !== undefined ? opts.wsl : detectWslContext();
  const extra: string[] = [];
  if (wsl) {
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
  /** WSL 鏡像檔（存在時） */
  mirror?: string;
  mirrorInSync?: boolean;
}

export function backgroundStatus(home: string, opts: { wsl?: WslContext | null } = {}): BackgroundStatus {
  const file = backgroundConfigPath(home);
  const config = readBackgroundConfig(home);
  const st: BackgroundStatus = { file, config, imageExists: false };
  if (config) {
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
