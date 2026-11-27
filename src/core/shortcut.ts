import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defaultPathEnv, isWsl } from '../config/paths.js';
import type { ApplyLang } from '../types.js';
import { resolveWindowsHome, wslToWindowsPath } from './background.js';
import { isStandalone } from './embedded.js';
import { atomicWrite } from './backup.js';
import { findWindowsExe, isWslWindowsPath } from './launcher.js';

/**
 * 桌面捷徑：`antigravity-i18n shortcut <install|remove|status>`。
 *
 * 捷徑只指向本工具的 `launch` 指令（開啟時檢查一次、必要時重新套用、啟動 Antigravity 後立即結束），
 * 不安裝任何常駐程式。
 *
 * | 平台 | 產物 |
 * | --- | --- |
 * | Windows | 桌面 `.lnk`（PowerShell `WScript.Shell`，圖示 `Antigravity.exe,0`，`WindowStyle = 7`） |
 * | WSL（Windows 側 Antigravity） | Windows 桌面 `.lnk`，目標 `wsl.exe -d <distro> -- … launch` |
 * | macOS | `~/Desktop/<名稱>.command`（0755） |
 * | Linux | `~/.local/share/applications/antigravity-i18n.desktop` |
 *
 * 安全性：PowerShell 腳本是固定字串（以 `-EncodedCommand` 傳入），路徑與參數**一律透過環境變數**
 * 傳進腳本，絕不把使用者提供的值拼接進 PowerShell 程式碼。
 */

export const DEFAULT_SHORTCUT_NAME = 'Antigravity (i18n)';
export const LINUX_DESKTOP_FILE = 'antigravity-i18n.desktop';
/** 寫進捷徑描述／內容的標記，用來辨識是否為本工具建立（移除時只刪自己的檔案） */
export const SHORTCUT_MARKER = 'antigravity-i18n launch';
const SCRIPT_MARKER = '# antigravity-i18n:shortcut';
const DESKTOP_MARKER = 'X-Antigravity-I18n-Shortcut=true';

export type ShortcutKind = 'windows-lnk' | 'wsl-lnk' | 'macos-command' | 'linux-desktop';

export class ShortcutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShortcutError';
  }
}

// ── 引號處理（純函式） ───────────────────────────────────

const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** 依 CommandLineToArgvW 規則為單一參數加上引號（Windows 程式解析命令列的標準規則） */
export function quoteWindowsArg(arg: string): string {
  if (CONTROL_RE.test(arg)) throw new ShortcutError('捷徑參數不可包含換行或控制字元');
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

export function joinWindowsArgs(args: string[]): string {
  return args.map(quoteWindowsArg).join(' ');
}

/** POSIX shell 單引號：`'` → `'\''`，其他字元一律原樣 */
export function quotePosixArg(arg: string): string {
  if (CONTROL_RE.test(arg)) throw new ShortcutError('捷徑參數不可包含換行或控制字元');
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * freedesktop `.desktop` 的 Exec 參數：含保留字元時以雙引號包住，引號內的 `"` `` ` `` `$` `\`
 * 以反斜線跳脫；`%` 一律寫成 `%%`（避免被當成欄位代碼）。最後再套用一次 desktop 字串值的 `\\` 跳脫。
 */
export function quoteDesktopArg(arg: string): string {
  if (CONTROL_RE.test(arg)) throw new ShortcutError('捷徑參數不可包含換行或控制字元');
  const pct = arg.replace(/%/g, '%%');
  const needs = pct === '' || /[\s"'\\><~|&;$*?#()`]/.test(pct);
  const quoted = needs ? `"${pct.replace(/(["`$\\])/g, '\\$1')}"` : pct;
  return quoted.replace(/\\/g, '\\\\');
}

/** 驗證顯示名稱；回傳清理前後空白的名稱 */
export function cleanShortcutName(input: string | undefined): string {
  const name = (input ?? DEFAULT_SHORTCUT_NAME).trim();
  if (name === '') throw new ShortcutError('--name 不可為空');
  if (name.length > 80) throw new ShortcutError('--name 最多 80 個字元');
  if (CONTROL_RE.test(name)) throw new ShortcutError('--name 不可包含換行或控制字元');
  return name;
}

/** 顯示名稱 → 安全的檔名（移除 Windows / macOS 不允許的字元） */
export function shortcutFileName(name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  return safe === '' ? 'Antigravity-i18n' : safe;
}

// ── 環境 ──────────────────────────────────────────────────

/** 執行本工具的方式：單檔執行檔為 `<exe>`；一般模式為 `<node> <dist/cli.js>` */
export interface SelfCommand {
  exe: string;
  args: string[];
}

/**
 * - 一般模式（npm / npx）：`<node> <argv[1]>`（argv[1] 可能是沒有副檔名的 bin 連結，一律保留）
 * - 單檔執行檔（SEA）：argv[1] 與執行檔相同，只需要 `<exe>`
 * - esbuild bundle（`node antigravity-i18n.cjs`）：也有內嵌資源，但仍需要帶上 bundle 路徑
 */
export function selfCommandFor(execPath: string, argv1: string | undefined, standalone: boolean): SelfCommand {
  const script = argv1 ? path.resolve(argv1) : undefined;
  if (standalone) {
    const isScript = !!script && script !== path.resolve(execPath) && /\.(?:c|m)?js$/i.test(script);
    return { exe: execPath, args: isScript ? [script] : [] };
  }
  if (!script) throw new ShortcutError('無法判斷本工具的執行路徑');
  return { exe: execPath, args: [script] };
}

export function defaultSelfCommand(): SelfCommand {
  return selfCommandFor(process.execPath, process.argv[1], isStandalone());
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type Runner = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd?: string }) => RunResult;

export const defaultRunner: Runner = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { env: opts.env, cwd: opts.cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
};

export interface ShortcutEnv {
  platform: NodeJS.Platform;
  wsl: boolean;
  /** 使用者家目錄（macOS / Linux / Windows 桌面的基準） */
  home: string;
  env: NodeJS.ProcessEnv;
  exists: (p: string) => boolean;
  self: SelfCommand;
  run: Runner;
  /** WSL：Windows 家目錄（WSL 路徑形式，例如 /mnt/c/Users/me） */
  windowsHome?: () => string | null;
}

/** 目前電腦的捷徑環境；home 預設為目前使用者家目錄 */
export function defaultShortcutEnv(home?: string, overrides: Partial<ShortcutEnv> = {}): ShortcutEnv {
  const pe = defaultPathEnv();
  return {
    platform: pe.platform,
    wsl: isWsl(pe.env, pe.platform),
    home: home ?? pe.home,
    env: pe.env,
    exists: (p) => fs.existsSync(p),
    self: defaultSelfCommand(),
    run: defaultRunner,
    windowsHome: () => resolveWindowsHome(pe),
    ...overrides,
  };
}

export interface ShortcutOptions {
  name?: string;
  lang?: ApplyLang;
  /** 傳給 launch 的 --path */
  path?: string;
  /** 捷徑所在目錄（預設為桌面；Linux 為 ~/.local/share/applications） */
  dir?: string;
  /** 覆蓋或移除非本工具建立的同名檔案 */
  force?: boolean;
}

/** Windows 的 .lnk 內容（全部透過環境變數傳給 PowerShell） */
export interface LnkSpec {
  /** PowerShell 看到的 .lnk 路徑（Windows 路徑） */
  file: string;
  target: string;
  arguments: string;
  workingDirectory: string;
  icon?: string;
  description: string;
}

export interface ShortcutPlan {
  kind: ShortcutKind;
  name: string;
  /** 捷徑檔案在本機的路徑（WSL 為 /mnt/c/... 形式） */
  file: string;
  /** 捷徑實際執行的指令（argv） */
  argv: string[];
  lnk?: LnkSpec;
  /** .command / .desktop 的檔案內容 */
  content?: string;
  warnings: string[];
}

function pickDesktop(base: string, lib: path.PlatformPath, exists: (p: string) => boolean): string {
  const plain = lib.join(base, 'Desktop');
  if (exists(plain)) return plain;
  const oneDrive = lib.join(base, 'OneDrive', 'Desktop');
  return exists(oneDrive) ? oneDrive : plain;
}

/** 絕對路徑原樣使用，相對路徑以目前目錄為基準 */
function absDir(dir: string, lib: path.PlatformPath): string {
  return lib.isAbsolute(dir) ? lib.normalize(dir) : lib.resolve(dir);
}

function launchArgs(opts: ShortcutOptions, lib: path.PlatformPath): string[] {
  const out = ['launch'];
  if (opts.lang) out.push('--lang', opts.lang);
  if (opts.path) out.push('--path', absDir(opts.path, lib));
  return out;
}

function selfWarnings(self: SelfCommand): string[] {
  const all = [self.exe, ...self.args].join(' ');
  return /[\\/]_npx[\\/]/.test(all)
    ? ['目前透過 npx 執行，捷徑會指向 npx 的暫存快取，快取被清除後捷徑會失效；建議改用單檔執行檔或 npm install -g antigravity-i18n 後重新建立捷徑']
    : [];
}

/**
 * 決定要建立哪一種捷徑與其內容（純函式，不寫入任何檔案）。
 * @param installRoot 偵測到的 Antigravity App 安裝根目錄（用於圖示與 WSL 判斷）
 */
export function planShortcut(opts: ShortcutOptions, env: ShortcutEnv, installRoot?: string): ShortcutPlan {
  const name = cleanShortcutName(opts.name);
  const warnings = selfWarnings(env.self);
  if (!installRoot) warnings.push('尚未偵測到 Antigravity App；捷徑仍會建立，但啟動前請確認 Antigravity 已安裝（或以 --path 指定）');

  if (env.platform === 'win32') {
    const lib = path.win32;
    const dir = opts.dir ? absDir(opts.dir, lib) : pickDesktop(env.home, lib, env.exists);
    const file = lib.join(dir, `${shortcutFileName(name)}.lnk`);
    const argv = [env.self.exe, ...env.self.args, ...launchArgs(opts, lib)];
    const exe = installRoot ? findWindowsExe(installRoot, env.exists) : null;
    return {
      kind: 'windows-lnk',
      name,
      file,
      argv,
      lnk: {
        file,
        target: env.self.exe,
        arguments: joinWindowsArgs(argv.slice(1)),
        workingDirectory: lib.dirname(env.self.exe),
        icon: exe?.found ? `${exe.exe},0` : undefined,
        description: `${name} — ${SHORTCUT_MARKER}`,
      },
      warnings,
    };
  }

  if (env.platform === 'linux' && env.wsl && installRoot && isWslWindowsPath(installRoot)) {
    const distro = env.env.WSL_DISTRO_NAME;
    if (!distro || !/^[A-Za-z0-9._-]+$/.test(distro)) {
      throw new ShortcutError('無法取得 WSL 發行版名稱（WSL_DISTRO_NAME），請在 WSL 終端機中執行');
    }
    const winHome = env.windowsHome?.() ?? null;
    if (!opts.dir && !winHome) {
      throw new ShortcutError('找不到 Windows 家目錄；可設定 ANTIGRAVITY_I18N_WIN_HOME=C:\\Users\\<你>，或以 --dir 指定 Windows 桌面（/mnt/c/...）');
    }
    const dir = opts.dir ? absDir(opts.dir, path.posix) : pickDesktop(winHome!, path.posix, env.exists);
    const file = path.posix.join(dir, `${shortcutFileName(name)}.lnk`);
    const winFile = wslToWindowsPath(file);
    if (!winFile) throw new ShortcutError(`捷徑必須建立在 Windows 磁碟上（/mnt/<磁碟>/...）：${file}`);
    const linuxArgv = [env.self.exe, ...env.self.args, ...launchArgs(opts, path.posix)];
    // wsl.exe 的 `--` 之後交給 Linux 預設 shell 解析：每個參數以 POSIX 單引號處理。
    // 雙引號與連續空白在 Windows 命令列解析時會被改寫，一律拒絕。
    for (const a of linuxArgv) {
      if (a.includes('"') || /\s{2,}|\t/.test(a)) throw new ShortcutError(`WSL 捷徑參數不可包含雙引號或連續空白：${a}`);
    }
    const exe = findWindowsExe(installRoot, env.exists, path.posix);
    const winExe = exe.found ? wslToWindowsPath(exe.exe) : null;
    const winHomeWin = winHome ? wslToWindowsPath(winHome) : null;
    return {
      kind: 'wsl-lnk',
      name,
      file,
      argv: ['wsl.exe', '-d', distro, '--', ...linuxArgv],
      lnk: {
        file: winFile,
        target: 'C:\\Windows\\System32\\wsl.exe',
        arguments: `${joinWindowsArgs(['-d', distro, '--'])} ${linuxArgv.map(quotePosixArg).join(' ')}`,
        workingDirectory: winHomeWin ?? 'C:\\Windows\\System32',
        icon: winExe ? `${winExe},0` : undefined,
        description: `${name} — ${SHORTCUT_MARKER}`,
      },
      warnings,
    };
  }

  const argv = [env.self.exe, ...env.self.args, ...launchArgs(opts, path.posix)];
  if (env.platform === 'darwin') {
    const dir = opts.dir ? absDir(opts.dir, path.posix) : path.posix.join(env.home, 'Desktop');
    const file = path.posix.join(dir, `${shortcutFileName(name)}.command`);
    const content = [
      '#!/bin/sh',
      SCRIPT_MARKER,
      `# ${name}：檢查 Antigravity 是否剛自動更新、必要時重新套用，然後啟動 Antigravity（${SHORTCUT_MARKER}）`,
      `exec ${argv.map(quotePosixArg).join(' ')}`,
      '',
    ].join('\n');
    return { kind: 'macos-command', name, file, argv, content, warnings };
  }

  const dir = opts.dir ? absDir(opts.dir, path.posix) : path.posix.join(env.home, '.local', 'share', 'applications');
  const file = path.posix.join(dir, LINUX_DESKTOP_FILE);
  const icon = linuxIcon(installRoot, env.exists);
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${name}`,
    `Comment=Antigravity (${SHORTCUT_MARKER})`,
    `Exec=${argv.map(quoteDesktopArg).join(' ')}`,
    `Icon=${icon.replace(/\\/g, '\\\\')}`,
    'Terminal=false',
    'Categories=Development;',
    'StartupNotify=true',
    DESKTOP_MARKER,
    '',
  ].join('\n');
  return { kind: 'linux-desktop', name, file, argv, content, warnings };
}

function linuxIcon(installRoot: string | undefined, exists: (p: string) => boolean): string {
  const candidates = installRoot
    ? ['antigravity.png', 'Antigravity.png', 'resources/antigravity.png', 'resources/app/resources/linux/code.png'].map((f) => path.posix.join(installRoot, f))
    : [];
  candidates.push('/usr/share/pixmaps/antigravity.png');
  return candidates.find(exists) ?? 'antigravity';
}

// ── 寫入／移除 ────────────────────────────────────────────

/** 固定的 PowerShell 腳本：所有值都從環境變數讀取 */
export const LNK_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$dir = Split-Path -Parent $env:AGI18N_SC_FILE',
  'if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }',
  '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:AGI18N_SC_FILE)',
  '$s.TargetPath = $env:AGI18N_SC_TARGET',
  '$s.Arguments = $env:AGI18N_SC_ARGS',
  '$s.WorkingDirectory = $env:AGI18N_SC_CWD',
  'if ($env:AGI18N_SC_ICON) { $s.IconLocation = $env:AGI18N_SC_ICON }',
  '$s.Description = $env:AGI18N_SC_DESC',
  '$s.WindowStyle = 7',
  '$s.Save()',
].join('\n');

export const LNK_ENV_NAMES = ['AGI18N_SC_FILE', 'AGI18N_SC_TARGET', 'AGI18N_SC_ARGS', 'AGI18N_SC_CWD', 'AGI18N_SC_ICON', 'AGI18N_SC_DESC'] as const;

/** 產生執行 PowerShell 的指令列與環境變數（純函式，方便測試防注入） */
export function powershellInvocation(lnk: LnkSpec, env: ShortcutEnv): { cmd: string; args: string[]; env: NodeJS.ProcessEnv; cwd?: string } {
  const values: Record<(typeof LNK_ENV_NAMES)[number], string> = {
    AGI18N_SC_FILE: lnk.file,
    AGI18N_SC_TARGET: lnk.target,
    AGI18N_SC_ARGS: lnk.arguments,
    AGI18N_SC_CWD: lnk.workingDirectory,
    AGI18N_SC_ICON: lnk.icon ?? '',
    AGI18N_SC_DESC: lnk.description,
  };
  const childEnv: NodeJS.ProcessEnv = { ...env.env, ...values };
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(LNK_SCRIPT, 'utf16le').toString('base64')];
  if (env.platform === 'win32') {
    const sysRoot = env.env.SystemRoot || env.env.windir || 'C:\\Windows';
    const ps = path.win32.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return { cmd: env.exists(ps) ? ps : 'powershell.exe', args, env: childEnv };
  }
  // WSL：環境變數必須列在 WSLENV 才會傳給 Windows 行程（不做路徑轉換，值已是 Windows 形式）
  const prev = env.env.WSLENV ? `${env.env.WSLENV}:` : '';
  childEnv.WSLENV = `${prev}${LNK_ENV_NAMES.join(':')}`;
  const ps = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  return { cmd: env.exists(ps) ? ps : 'powershell.exe', args, env: childEnv, cwd: env.exists('/mnt/c') ? '/mnt/c' : undefined };
}

/** 檔案是否為本工具建立的捷徑 */
export function isManagedShortcut(file: string, kind: ShortcutKind): boolean {
  try {
    const buf = fs.readFileSync(file);
    if (kind === 'windows-lnk' || kind === 'wsl-lnk') {
      // WScript.Shell 以 UTF-16LE 儲存 Description
      return buf.includes(Buffer.from(SHORTCUT_MARKER, 'utf16le')) || buf.includes(Buffer.from(SHORTCUT_MARKER, 'latin1'));
    }
    const text = buf.toString('utf8');
    return text.includes(kind === 'macos-command' ? SCRIPT_MARKER : DESKTOP_MARKER);
  } catch {
    return false;
  }
}

export interface ShortcutResult {
  action: 'install' | 'remove' | 'status';
  kind: ShortcutKind;
  name: string;
  file: string;
  exists: boolean;
  managed: boolean;
  /** 捷徑執行的指令（顯示用） */
  command: string;
  removed?: boolean;
  warnings: string[];
}

function display(argv: string[], kind: ShortcutKind): string {
  return kind === 'windows-lnk' ? joinWindowsArgs(argv) : argv.map(quotePosixArg).join(' ');
}

function baseResult(action: ShortcutResult['action'], plan: ShortcutPlan, env: ShortcutEnv): ShortcutResult {
  const exists = env.exists(plan.file);
  return {
    action,
    kind: plan.kind,
    name: plan.name,
    file: plan.file,
    exists,
    managed: exists && isManagedShortcut(plan.file, plan.kind),
    command: display(plan.argv, plan.kind),
    warnings: [...plan.warnings],
  };
}

export function shortcutStatus(opts: ShortcutOptions, env: ShortcutEnv, installRoot?: string): ShortcutResult {
  return baseResult('status', planShortcut(opts, env, installRoot), env);
}

export function installShortcut(opts: ShortcutOptions, env: ShortcutEnv, installRoot?: string): ShortcutResult {
  const plan = planShortcut(opts, env, installRoot);
  const before = baseResult('install', plan, env);
  if (before.exists && !before.managed && !opts.force) {
    throw new ShortcutError(`${plan.file} 已存在且不是本工具建立的捷徑；確定要覆蓋請加上 --force`);
  }
  if (plan.lnk) {
    const inv = powershellInvocation(plan.lnk, env);
    const r = env.run(inv.cmd, inv.args, { env: inv.env, cwd: inv.cwd });
    if (r.error || r.status !== 0) {
      const detail = (r.error?.message ?? r.stderr ?? '').trim().split(/\r?\n/).slice(0, 3).join(' ');
      throw new ShortcutError(`PowerShell 建立捷徑失敗${detail ? `：${detail}` : ''}`);
    }
    if (!env.exists(plan.file)) throw new ShortcutError(`PowerShell 已執行，但找不到建立的捷徑：${plan.file}`);
  } else {
    atomicWrite(plan.file, plan.content ?? '');
    fs.chmodSync(plan.file, 0o755);
  }
  return { ...before, exists: true, managed: true };
}

export function removeShortcut(opts: ShortcutOptions, env: ShortcutEnv, installRoot?: string): ShortcutResult {
  const plan = planShortcut(opts, env, installRoot);
  const r = baseResult('remove', plan, env);
  if (!r.exists) return { ...r, removed: false };
  if (!r.managed && !opts.force) {
    throw new ShortcutError(`${plan.file} 不是本工具建立的捷徑，未移除；確定要移除請加上 --force`);
  }
  fs.rmSync(plan.file, { force: true });
  return { ...r, exists: false, managed: false, removed: true };
}
