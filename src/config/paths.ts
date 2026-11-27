import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DetectedTarget, TargetId } from '../types.js';

/** 平台環境（抽象出來方便在單元測試中模擬其他作業系統） */
export interface PathEnv {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /**
   * 在 WSL 中執行時，Windows 側（/mnt/c/Users/*）的使用者目錄名稱；
   * 非 WSL 環境為 undefined。用來額外偵測裝在 Windows 側的 Antigravity。
   */
  wslWindowsUsers?: string[];
}

/** WSL 的 Windows 系統磁碟掛載點 */
export const WSL_WINDOWS_DRIVE = '/mnt/c';

const WSL_SKIP_USERS = new Set(['all users', 'default', 'default user', 'public', 'defaultapppool', 'wdagutilityaccount']);

/** 判斷目前是否在 WSL 中執行 */
export function isWsl(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

/** 列出 /mnt/c/Users 下的 Windows 使用者目錄 */
export function listWslWindowsUsers(drive = WSL_WINDOWS_DRIVE): string[] {
  try {
    return fs
      .readdirSync(path.posix.join(drive, 'Users'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !WSL_SKIP_USERS.has(e.name.toLowerCase()))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function defaultPathEnv(): PathEnv {
  const pe: PathEnv = { platform: process.platform, home: os.homedir(), env: process.env };
  if (isWsl(pe.env, pe.platform)) pe.wslWindowsUsers = listWslWindowsUsers();
  return pe;
}

/** WSL 下對應 Windows 安裝位置的 /mnt/c 路徑 */
function wslWindowsCandidates(pe: PathEnv, names: string[]): string[] {
  if (pe.platform !== 'linux' || !pe.wslWindowsUsers) return [];
  const p = path.posix;
  const out: string[] = [];
  for (const name of names) {
    for (const user of pe.wslWindowsUsers) out.push(p.join(WSL_WINDOWS_DRIVE, 'Users', user, 'AppData', 'Local', 'Programs', name));
    out.push(p.join(WSL_WINDOWS_DRIVE, 'Program Files', name), p.join(WSL_WINDOWS_DRIVE, 'Program Files (x86)', name));
  }
  return out;
}

function pathLib(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** 工具自身的資料目錄：`~/.antigravity-i18n`（可用 ANTIGRAVITY_I18N_HOME 覆寫） */
export function toolHome(pe: PathEnv = defaultPathEnv()): string {
  const override = pe.env.ANTIGRAVITY_I18N_HOME;
  if (override && override.trim() !== '') return override;
  return pathLib(pe.platform).join(pe.home, '.antigravity-i18n');
}

export function manifestsDir(home: string): string {
  return path.join(home, 'manifests');
}

export function backupsDir(home: string): string {
  return path.join(home, 'backups');
}

/** Antigravity 全域規則目錄：`~/.gemini/config/rules` */
export function geminiRulesDir(userHome: string): string {
  return path.join(userHome, '.gemini', 'config', 'rules');
}

const APP_DIR_NAMES = ['Antigravity App', 'Antigravity'];

/** 桌面版（App）可能的安裝根目錄 */
export function appInstallCandidates(pe: PathEnv): string[] {
  const p = pathLib(pe.platform);
  const out: string[] = [];
  switch (pe.platform) {
    case 'darwin':
      for (const name of APP_DIR_NAMES) {
        out.push(`/Applications/${name}.app`, p.join(pe.home, 'Applications', `${name}.app`));
      }
      break;
    case 'win32': {
      const local = pe.env.LOCALAPPDATA ?? p.join(pe.home, 'AppData', 'Local');
      const pf = pe.env.ProgramFiles ?? 'C:\\Program Files';
      const pf86 = pe.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
      for (const name of APP_DIR_NAMES) {
        out.push(p.join(local, 'Programs', name), p.join(pf, name), p.join(pf86, name));
      }
      break;
    }
    default:
      out.push(
        '/opt/Antigravity App',
        '/opt/antigravity-app',
        '/opt/Antigravity',
        '/opt/antigravity',
        '/usr/share/antigravity-app',
        '/usr/share/antigravity',
        '/usr/lib/antigravity',
        p.join(pe.home, '.local', 'share', 'antigravity-app'),
        p.join(pe.home, '.local', 'share', 'antigravity'),
        ...wslWindowsCandidates(pe, APP_DIR_NAMES),
      );
  }
  return out;
}

/** IDE 可能的安裝根目錄（VS Code 系列結構） */
export function ideInstallCandidates(pe: PathEnv): string[] {
  const p = pathLib(pe.platform);
  switch (pe.platform) {
    case 'darwin':
      return ['/Applications/Antigravity.app', p.join(pe.home, 'Applications', 'Antigravity.app')];
    case 'win32': {
      const local = pe.env.LOCALAPPDATA ?? p.join(pe.home, 'AppData', 'Local');
      const pf = pe.env.ProgramFiles ?? 'C:\\Program Files';
      return [p.join(local, 'Programs', 'Antigravity'), p.join(pf, 'Antigravity')];
    }
    default:
      return [
        '/usr/share/antigravity',
        '/opt/Antigravity',
        '/opt/antigravity',
        '/usr/lib/antigravity',
        p.join(pe.home, '.local', 'share', 'antigravity'),
        ...wslWindowsCandidates(pe, ['Antigravity']),
      ];
  }
}

/** CLI（agy）可能的執行檔位置 */
export function cliCandidates(pe: PathEnv): string[] {
  const p = pathLib(pe.platform);
  const names = pe.platform === 'win32' ? ['agy.cmd', 'agy.exe', 'agy.ps1', 'agy'] : ['agy'];
  const dirs: string[] = [];
  const pathVar = pe.env.PATH ?? pe.env.Path ?? '';
  const sep = pe.platform === 'win32' ? ';' : ':';
  for (const d of pathVar.split(sep)) if (d) dirs.push(d);
  if (pe.platform === 'win32') {
    const local = pe.env.LOCALAPPDATA ?? p.join(pe.home, 'AppData', 'Local');
    const roaming = pe.env.APPDATA ?? p.join(pe.home, 'AppData', 'Roaming');
    dirs.push(p.join(local, 'Programs', 'Antigravity CLI'), p.join(roaming, 'npm'));
  } else {
    dirs.push(
      p.join(pe.home, '.antigravity', 'cli', 'bin'),
      p.join(pe.home, '.local', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
    );
  }
  const out: string[] = [];
  for (const d of dirs) for (const n of names) out.push(p.join(d, n));
  return [...new Set(out)];
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 遞迴列出檔案（略過 node_modules 與隱藏目錄） */
export function listFiles(dir: string, exts: string[], maxDepth = 6): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) out.push(full);
    }
  };
  walk(dir, 0);
  return out.sort();
}

/** 從安裝根目錄或檔案路徑找出 app.asar */
export function resolveAsar(root: string): string | null {
  if (root.endsWith('.asar') && isFile(root)) return root;
  const candidates = [
    path.join(root, 'Contents', 'Resources', 'app.asar'),
    path.join(root, 'resources', 'app.asar'),
    path.join(root, 'app.asar'),
  ];
  return candidates.find(isFile) ?? null;
}

const WORKBENCH_REL = path.join('out', 'vs', 'workbench', 'workbench.desktop.main.js');

/** 從安裝根目錄找出 VS Code 系列的 `resources/app` 目錄 */
export function resolveIdeAppDir(root: string): string | null {
  const candidates = [path.join(root, 'Contents', 'Resources', 'app'), path.join(root, 'resources', 'app'), root];
  return candidates.find((c) => isFile(path.join(c, WORKBENCH_REL))) ?? null;
}

/** 列出 IDE 需要修補的檔案 */
export function ideFiles(appDir: string): string[] {
  const files: string[] = [];
  const nls = path.join(appDir, 'out', 'nls.messages.json');
  if (isFile(nls)) files.push(nls);
  files.push(path.join(appDir, WORKBENCH_REL));
  const extDir = path.join(appDir, 'extensions');
  if (isDir(extDir)) {
    for (const name of fs.readdirSync(extDir).sort()) {
      if (!/antigravity|agent|jetski|cascade/i.test(name)) continue;
      const ext = path.join(extDir, name);
      const pkgNls = path.join(ext, 'package.nls.json');
      if (isFile(pkgNls)) files.push(pkgNls);
      for (const sub of ['dist', 'out', 'webview', 'media']) {
        const d = path.join(ext, sub);
        if (isDir(d)) files.push(...listFiles(d, ['.js', '.mjs', '.cjs', '.html']));
      }
    }
  }
  return [...new Set(files)];
}

/** 判斷檔案是否為二進位（前 8KB 內含 NUL） */
export function isBinaryFile(p: string): boolean {
  const fd = fs.openSync(p, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

function findPackageRoot(start: string): string | null {
  let dir = path.dirname(start);
  for (let i = 0; i < 6; i++) {
    if (isFile(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 從 agy 執行檔或目錄推導要修補的 JS bundle */
export function resolveCliFiles(entry: string): { root: string; files: string[]; reason?: string } {
  if (isDir(entry)) {
    const files = ['dist', 'build', 'lib', 'out']
      .map((d) => path.join(entry, d))
      .filter(isDir)
      .flatMap((d) => listFiles(d, ['.js', '.mjs', '.cjs']));
    return files.length > 0
      ? { root: entry, files }
      : { root: entry, files: [], reason: '目錄中找不到 dist/、build/、lib/ 或 out/ 下的 JS bundle' };
  }
  const real = fs.realpathSync(entry);
  if (isBinaryFile(real)) {
    return { root: path.dirname(real), files: [], reason: 'agy 為原生二進位執行檔，目前僅支援 Node.js 版 CLI bundle' };
  }
  const head = fs.readFileSync(real, 'utf8').slice(0, 512);
  const pkgRoot = findPackageRoot(real);
  if (/^#!.*\bnode\b/.test(head) || /\.(c|m)?js$/.test(real)) {
    const files = [real];
    if (pkgRoot) {
      for (const d of ['dist', 'build', 'lib']) {
        const full = path.join(pkgRoot, d);
        if (isDir(full)) files.push(...listFiles(full, ['.js', '.mjs', '.cjs']));
      }
    }
    return { root: pkgRoot ?? path.dirname(real), files: [...new Set(files)] };
  }
  // shell / cmd 包裝腳本：嘗試從腳本內容找出指向的 JS 檔案
  const script = fs.readFileSync(real, 'utf8');
  const m = script.match(/["']?([^"'\s]+\.(?:c|m)?js)["']?/);
  if (m?.[1]) {
    const ref = m[1].replace(/%~dp0\\?|\$basedir\/?|\$\{?basedir\}?\/?/g, '');
    const target = path.resolve(path.dirname(real), ref);
    if (isFile(target)) return resolveCliFiles(target);
  }
  return { root: path.dirname(real), files: [], reason: '無法從 agy 包裝腳本解析出 JS bundle，請用 --path 指定 CLI 安裝目錄' };
}

export interface DetectOptions {
  customPath?: string;
  pathEnv?: PathEnv;
}

/** 偵測單一目標的安裝位置；找不到回傳 null */
export function detectTarget(id: TargetId, opts: DetectOptions = {}): DetectedTarget | null {
  const pe = opts.pathEnv ?? defaultPathEnv();
  const source: DetectedTarget['source'] = opts.customPath ? 'custom' : 'auto';
  const custom = opts.customPath ? path.resolve(opts.customPath) : undefined;
  if (custom && !fs.existsSync(custom)) return null;

  if (id === 'app') {
    const roots = custom ? [custom] : appInstallCandidates(pe);
    for (const root of roots) {
      const asarPath = resolveAsar(root);
      if (!asarPath) continue;
      const installRoot = custom && custom.endsWith('.asar') ? path.dirname(asarPath) : root;
      const plist = path.join(path.dirname(path.dirname(asarPath)), 'Info.plist');
      return {
        id,
        installRoot,
        kind: 'asar',
        files: [asarPath],
        infoPlist: isFile(plist) ? plist : undefined,
        source,
        supported: true,
      };
    }
    return null;
  }

  if (id === 'ide') {
    const roots = custom ? [custom] : ideInstallCandidates(pe);
    for (const root of roots) {
      const appDir = resolveIdeAppDir(root);
      if (!appDir) continue;
      const productJson = path.join(appDir, 'product.json');
      return {
        id,
        installRoot: root,
        kind: 'files',
        files: ideFiles(appDir),
        productJson: isFile(productJson) ? productJson : undefined,
        checksumBase: path.join(appDir, 'out'),
        source,
        supported: true,
      };
    }
    return null;
  }

  // cli
  const entries = custom ? [custom] : cliCandidates(pe).filter(isFile);
  const entry = entries[0];
  if (!entry) return null;
  const resolved = resolveCliFiles(entry);
  return {
    id,
    installRoot: resolved.root,
    kind: 'files',
    files: resolved.files,
    source,
    supported: resolved.files.length > 0,
    reason: resolved.reason,
  };
}
