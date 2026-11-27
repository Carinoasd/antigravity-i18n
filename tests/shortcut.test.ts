import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../src/commands/common.js';
import { shortcutCommand, type ShortcutCommandDeps } from '../src/commands/shortcut.js';
import { detectTarget } from '../src/config/paths.js';
import {
  DEFAULT_SHORTCUT_NAME,
  LINUX_DESKTOP_FILE,
  LNK_ENV_NAMES,
  LNK_SCRIPT,
  SHORTCUT_MARKER,
  ShortcutError,
  cleanShortcutName,
  installShortcut,
  isManagedShortcut,
  planShortcut,
  powershellInvocation,
  quoteDesktopArg,
  quotePosixArg,
  quoteWindowsArg,
  removeShortcut,
  selfCommandFor,
  shortcutFileName,
  shortcutStatus,
  type RunResult,
  type ShortcutEnv,
} from '../src/core/shortcut.js';
import type { Detect } from '../src/ui/actions.js';
import { UI_TEXT } from '../src/ui/html.js';
import { UI_HOST, startUiServer, type UiServer } from '../src/ui/server.js';
import { rm, tmpDir, write } from './helpers.js';

let dir: string;
beforeEach(() => {
  dir = tmpDir('agi18n-shortcut-');
});
afterEach(() => {
  vi.restoreAllMocks();
  rm(dir);
});

/** 依 CommandLineToArgvW 規則解析（驗證 quoteWindowsArg 的往返結果） */
function parseWindowsArgs(cmdline: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < cmdline.length) {
    while (cmdline[i] === ' ' || cmdline[i] === '\t') i++;
    if (i >= cmdline.length) break;
    let arg = '';
    let quoted = false;
    for (; i < cmdline.length; i++) {
      const c = cmdline[i]!;
      if (c === '\\') {
        let n = 0;
        while (cmdline[i] === '\\') {
          n++;
          i++;
        }
        if (cmdline[i] === '"') {
          arg += '\\'.repeat(Math.floor(n / 2));
          if (n % 2 === 1) arg += '"';
          else quoted = !quoted;
        } else {
          arg += '\\'.repeat(n);
          i--;
        }
      } else if (c === '"') {
        quoted = !quoted;
      } else if ((c === ' ' || c === '\t') && !quoted) {
        break;
      } else {
        arg += c;
      }
    }
    out.push(arg);
  }
  return out;
}

/** 依 freedesktop 規範解析 Exec（先處理字串值的 \\ 跳脫，再處理引號） */
function parseDesktopExec(value: string): string[] {
  const unescaped = value.replace(/\\(.)/g, (_m, c: string) => (c === 's' ? ' ' : c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
  const out: string[] = [];
  let i = 0;
  while (i < unescaped.length) {
    while (unescaped[i] === ' ') i++;
    if (i >= unescaped.length) break;
    let arg = '';
    if (unescaped[i] === '"') {
      i++;
      while (i < unescaped.length && unescaped[i] !== '"') {
        if (unescaped[i] === '\\' && i + 1 < unescaped.length) i++;
        arg += unescaped[i];
        i++;
      }
      i++;
    } else {
      while (i < unescaped.length && unescaped[i] !== ' ') arg += unescaped[i++];
    }
    out.push(arg.replace(/%%/g, '%'));
  }
  return out;
}

const NASTY = ['plain', 'with space', 'quote"inside', 'trailing\\', 'back\\slash\\"q', "it's", '$(rm -rf ~)', '`id`', 'a;b&c|d', '100%', '', '中文 路徑'];

function fakeRun(onRun?: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => void): { run: ShortcutEnv['run']; calls: { cmd: string; args: string[]; env: NodeJS.ProcessEnv; cwd?: string }[] } {
  const calls: { cmd: string; args: string[]; env: NodeJS.ProcessEnv; cwd?: string }[] = [];
  const run = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd?: string }): RunResult => {
    calls.push({ cmd, args, env: opts.env, cwd: opts.cwd });
    onRun?.(cmd, args, opts.env);
    return { status: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

/** 模擬 WScript.Shell 寫出的 .lnk：Description 以 UTF-16LE 儲存 */
function fakeLnk(file: string, desc: string): void {
  write(file, Buffer.concat([Buffer.from([0x4c, 0, 0, 0]), Buffer.from(desc, 'utf16le')]));
}

function env(over: Partial<ShortcutEnv> = {}): ShortcutEnv {
  return {
    platform: 'linux',
    wsl: false,
    home: path.join(dir, 'home'),
    env: {},
    exists: (p) => fs.existsSync(p),
    self: { exe: '/usr/bin/node', args: ['/opt/agi18n/dist/cli.js'] },
    run: fakeRun().run,
    windowsHome: () => null,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────

describe('shortcut：引號處理', () => {
  it('Windows：CommandLineToArgvW 往返完全一致', () => {
    const cmdline = NASTY.map(quoteWindowsArg).join(' ');
    expect(parseWindowsArgs(cmdline)).toEqual(NASTY);
    expect(quoteWindowsArg('C:\\Program Files\\node.exe')).toBe('"C:\\Program Files\\node.exe"');
    expect(quoteWindowsArg('launch')).toBe('launch');
  });

  it.skipIf(process.platform === 'win32')('POSIX：交給 sh 解析後完全一致（不會執行 $() 或反引號）', () => {
    const r = spawnSync('sh', ['-c', `printf '%s\\0' ${NASTY.map(quotePosixArg).join(' ')}`], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.split('\0').slice(0, -1)).toEqual(NASTY);
  });

  it('.desktop Exec：依規範解析後完全一致', () => {
    expect(parseDesktopExec(NASTY.map(quoteDesktopArg).join(' '))).toEqual(NASTY);
    expect(quoteDesktopArg('100%')).toBe('100%%');
  });

  it('拒絕換行與控制字元', () => {
    for (const q of [quoteWindowsArg, quotePosixArg, quoteDesktopArg]) expect(() => q('a\nb')).toThrow(ShortcutError);
    expect(() => cleanShortcutName('a\r\nExec=evil')).toThrow(ShortcutError);
    expect(() => cleanShortcutName('  ')).toThrow(ShortcutError);
    expect(cleanShortcutName(undefined)).toBe(DEFAULT_SHORTCUT_NAME);
    expect(shortcutFileName('a/b\\c:d*e?"f<g>h|')).toBe('a-b-c-d-e--f-g-h-');
    expect(shortcutFileName('..')).toBe('Antigravity-i18n');
  });
});

describe('shortcut：本工具的執行方式', () => {
  it('一般模式帶上 cli 路徑；單檔執行檔只用執行檔本身；esbuild bundle 帶上 bundle 路徑', () => {
    const node = path.resolve('/usr/bin/node');
    expect(selfCommandFor(node, '/usr/lib/node_modules/antigravity-i18n/dist/cli.js', false)).toEqual({ exe: node, args: [path.resolve('/usr/lib/node_modules/antigravity-i18n/dist/cli.js')] });
    // npm 全域安裝的 bin 連結沒有副檔名
    expect(selfCommandFor(node, '/usr/local/bin/antigravity-i18n', false).args).toEqual([path.resolve('/usr/local/bin/antigravity-i18n')]);
    const sea = path.resolve('/opt/antigravity-i18n-linux-x64');
    expect(selfCommandFor(sea, sea, true)).toEqual({ exe: sea, args: [] });
    expect(selfCommandFor(sea, undefined, true)).toEqual({ exe: sea, args: [] });
    expect(selfCommandFor(node, '/tmp/dist-sea/antigravity-i18n.cjs', true).args).toEqual([path.resolve('/tmp/dist-sea/antigravity-i18n.cjs')]);
    expect(() => selfCommandFor(node, undefined, false)).toThrow(ShortcutError);
  });
});

describe('shortcut：Windows .lnk（PowerShell WScript.Shell）', () => {
  const home = 'C:\\Users\\me';
  const root = 'C:\\Users\\me\\AppData\\Local\\Programs\\Antigravity';
  const winEnv = (over: Partial<ShortcutEnv> = {}): ShortcutEnv =>
    env({
      platform: 'win32',
      home,
      env: { SystemRoot: 'C:\\Windows' },
      exists: (p) => p === `${root}\\Antigravity.exe` || p === `${home}\\Desktop`,
      self: { exe: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\antigravity-i18n\\dist\\cli.js'] },
      ...over,
    });

  it('桌面 .lnk：Antigravity.exe,0 圖示、WindowStyle 7、參數依 Windows 規則加引號', () => {
    const plan = planShortcut({ lang: 'zh-TW' }, winEnv(), root);
    expect(plan.kind).toBe('windows-lnk');
    expect(plan.file).toBe('C:\\Users\\me\\Desktop\\Antigravity (i18n).lnk');
    expect(plan.lnk).toMatchObject({
      target: 'C:\\Program Files\\nodejs\\node.exe',
      icon: `${root}\\Antigravity.exe,0`,
      workingDirectory: 'C:\\Program Files\\nodejs',
    });
    expect(parseWindowsArgs(plan.lnk!.arguments)).toEqual([
      'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\antigravity-i18n\\dist\\cli.js',
      'launch',
      '--lang',
      'zh-TW',
    ]);
    expect(plan.lnk!.description).toContain(SHORTCUT_MARKER);
    expect(LNK_SCRIPT).toContain('$s.WindowStyle = 7');
  });

  it('單檔執行檔模式：目標直接是 .exe；OneDrive 桌面', () => {
    const e = winEnv({
      self: { exe: 'D:\\Tools\\antigravity-i18n-win-x64.exe', args: [] },
      exists: (p) => p === `${home}\\OneDrive\\Desktop`,
    });
    const plan = planShortcut({}, e, root);
    expect(plan.file).toBe('C:\\Users\\me\\OneDrive\\Desktop\\Antigravity (i18n).lnk');
    expect(plan.lnk!.target).toBe('D:\\Tools\\antigravity-i18n-win-x64.exe');
    expect(plan.lnk!.arguments).toBe('launch');
    expect(plan.lnk!.icon).toBeUndefined();
  });

  it('防 PowerShell 注入：腳本是固定字串，所有值只透過環境變數傳入', () => {
    const evil = `x'; Remove-Item -Recurse C:\\ ; $(calc) "`;
    const plan = planShortcut({ name: evil, path: 'C:\\a\'b$(c)' }, winEnv(), root);
    const inv = powershellInvocation(plan.lnk!, winEnv());
    expect(inv.cmd).toBe('powershell.exe');
    const encoded = inv.args[inv.args.indexOf('-EncodedCommand') + 1]!;
    // 解碼後就是固定的腳本，和使用者輸入無關
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(LNK_SCRIPT);
    expect(inv.args.join(' ')).not.toContain('Remove-Item');
    expect(LNK_SCRIPT).not.toContain('Remove-Item');
    for (const name of LNK_ENV_NAMES) expect(LNK_SCRIPT).toContain(`$env:${name}`);
    expect(inv.env.AGI18N_SC_DESC).toContain(evil);
    expect(inv.env.AGI18N_SC_FILE).toBe(`C:\\Users\\me\\Desktop\\${shortcutFileName(evil)}.lnk`);
    expect(parseWindowsArgs(inv.env.AGI18N_SC_ARGS!)).toContain("C:\\a'b$(c)");
    expect(inv.env.WSLENV).toBeUndefined();
  });

  it('install：執行 PowerShell 一次，完成後確認 .lnk 存在（不寫入任何實體檔案）', () => {
    let created = false;
    const { run, calls } = fakeRun(() => void (created = true));
    const e = winEnv({ exists: (p) => (p === 'C:\\Users\\me\\Desktop\\Antigravity (i18n).lnk' ? created : p === `${home}\\Desktop`), run });
    const r = installShortcut({}, e, root);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.env.AGI18N_SC_FILE).toBe('C:\\Users\\me\\Desktop\\Antigravity (i18n).lnk');
    expect(r).toMatchObject({ kind: 'windows-lnk', exists: true, managed: true });
  });

  it('辨識本工具建立的 .lnk（Description 以 UTF-16LE 儲存）', () => {
    const mine = path.join(dir, 'mine.lnk');
    fakeLnk(mine, `Antigravity (i18n) — ${SHORTCUT_MARKER}`);
    const other = write(path.join(dir, 'other.lnk'), Buffer.from('someone else', 'utf16le'));
    expect(isManagedShortcut(mine, 'windows-lnk')).toBe(true);
    expect(isManagedShortcut(mine, 'wsl-lnk')).toBe(true);
    expect(isManagedShortcut(other, 'windows-lnk')).toBe(false);
    expect(isManagedShortcut(path.join(dir, 'missing.lnk'), 'windows-lnk')).toBe(false);
  });

  // 實體檔案路徑必須是 Windows 路徑：只在 Windows 上實際寫入暫存目錄
  it.runIf(process.platform === 'win32')('install → status → remove（假的 PowerShell 寫出 .lnk），只移除自己建立的捷徑', () => {
    const desktop = path.join(dir, 'Desktop');
    const { run, calls } = fakeRun((_cmd, _args, e) => fakeLnk(e.AGI18N_SC_FILE!, e.AGI18N_SC_DESC!));
    const e = winEnv({ exists: (p) => fs.existsSync(p), run });
    const r = installShortcut({ dir: desktop }, e, root);
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ kind: 'windows-lnk', exists: true, managed: true });
    expect(isManagedShortcut(r.file, 'windows-lnk')).toBe(true);
    expect(shortcutStatus({ dir: desktop }, e, root)).toMatchObject({ exists: true, managed: true });
    expect(removeShortcut({ dir: desktop }, e, root)).toMatchObject({ removed: true });
    expect(fs.existsSync(r.file)).toBe(false);

    // 同名但不是本工具建立的捷徑：不覆蓋、不移除（除非 --force）
    write(r.file, Buffer.from('someone else', 'utf16le'));
    expect(() => installShortcut({ dir: desktop }, e, root)).toThrow(/--force/);
    expect(() => removeShortcut({ dir: desktop }, e, root)).toThrow(/--force/);
    expect(removeShortcut({ dir: desktop, force: true }, e, root).removed).toBe(true);
  });

  it('PowerShell 失敗時回報錯誤', () => {
    const e = winEnv({ exists: () => false, run: () => ({ status: 1, stdout: '', stderr: 'Access denied\nmore' }) });
    expect(() => installShortcut({}, e, root)).toThrow(/PowerShell 建立捷徑失敗：Access denied/);
    const e2 = winEnv({ exists: () => false, run: () => ({ status: 0, stdout: '', stderr: '' }) });
    expect(() => installShortcut({}, e2, root)).toThrow(/找不到建立的捷徑/);
  });
});

describe('shortcut：WSL（Windows 桌面 .lnk → wsl.exe）', () => {
  const root = '/mnt/c/Users/me/AppData/Local/Programs/Antigravity';
  const wslEnv = (over: Partial<ShortcutEnv> = {}): ShortcutEnv =>
    env({
      platform: 'linux',
      wsl: true,
      home: '/home/me',
      env: { WSL_DISTRO_NAME: 'Ubuntu-24.04', WSLENV: 'USERPROFILE/p' },
      exists: (p) => [`${root}/Antigravity.exe`, '/mnt/c/Users/me/Desktop', '/mnt/c'].includes(p),
      self: { exe: '/usr/bin/node', args: ["/home/me/it's here/dist/cli.js"] },
      windowsHome: () => '/mnt/c/Users/me',
      ...over,
    });

  it('在 Windows 桌面建立 .lnk，目標為 wsl.exe -d <distro> -- … launch', () => {
    const plan = planShortcut({ lang: 'ja' }, wslEnv(), root);
    expect(plan.kind).toBe('wsl-lnk');
    expect(plan.file).toBe('/mnt/c/Users/me/Desktop/Antigravity (i18n).lnk');
    expect(plan.lnk).toMatchObject({
      file: 'C:\\Users\\me\\Desktop\\Antigravity (i18n).lnk',
      target: 'C:\\Windows\\System32\\wsl.exe',
      icon: 'C:\\Users\\me\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe,0',
      workingDirectory: 'C:\\Users\\me',
    });
    expect(plan.lnk!.arguments).toBe(`-d Ubuntu-24.04 -- /usr/bin/node '/home/me/it'\\''s here/dist/cli.js' launch --lang ja`);
    expect(plan.argv).toEqual(['wsl.exe', '-d', 'Ubuntu-24.04', '--', '/usr/bin/node', "/home/me/it's here/dist/cli.js", 'launch', '--lang', 'ja']);
  });

  it('環境變數透過 WSLENV 傳給 Windows 的 PowerShell', () => {
    const plan = planShortcut({}, wslEnv(), root);
    const inv = powershellInvocation(plan.lnk!, wslEnv());
    expect(inv.env.WSLENV).toBe(`USERPROFILE/p:${LNK_ENV_NAMES.join(':')}`);
    expect(inv.cwd).toBe('/mnt/c');
    expect(Buffer.from(inv.args.at(-1)!, 'base64').toString('utf16le')).toBe(LNK_SCRIPT);
  });

  it('拒絕不合法的發行版名稱、雙引號參數，以及非 Windows 磁碟的目錄', () => {
    expect(() => planShortcut({}, wslEnv({ env: { WSL_DISTRO_NAME: 'a b"; calc' } }), root)).toThrow(/WSL_DISTRO_NAME/);
    expect(() => planShortcut({}, wslEnv({ env: {} }), root)).toThrow(/WSL_DISTRO_NAME/);
    expect(() => planShortcut({}, wslEnv({ self: { exe: '/usr/bin/node', args: ['/a"b/cli.js'] } }), root)).toThrow(/雙引號/);
    expect(() => planShortcut({ dir: '/home/me/Desktop' }, wslEnv(), root)).toThrow(/Windows 磁碟/);
    expect(() => planShortcut({}, wslEnv({ windowsHome: () => null }), root)).toThrow(/ANTIGRAVITY_I18N_WIN_HOME/);
  });

  it('沒有偵測到 Windows 側 Antigravity 時改用 Linux .desktop', () => {
    expect(planShortcut({}, wslEnv(), '/opt/Antigravity').kind).toBe('linux-desktop');
    expect(planShortcut({}, wslEnv(), undefined).kind).toBe('linux-desktop');
  });
});

describe('shortcut：macOS .command', () => {
  it('~/Desktop/<名稱>.command（0755），內容只執行 launch', () => {
    const e = env({ platform: 'darwin', self: { exe: '/opt/homebrew/bin/node', args: ['/Users/me/my tools/cli.js'] } });
    const r = installShortcut({ lang: 'zh-CN', path: '/Applications/Antigravity App.app' }, e, '/Applications/Antigravity App.app');
    expect(r.kind).toBe('macos-command');
    expect(r.file).toBe(path.posix.join(e.home, 'Desktop', 'Antigravity (i18n).command'));
    const text = fs.readFileSync(r.file, 'utf8');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain(`exec /opt/homebrew/bin/node '/Users/me/my tools/cli.js' launch --lang zh-CN --path '/Applications/Antigravity App.app'`);
    if (process.platform !== 'win32') expect(fs.statSync(r.file).mode & 0o777).toBe(0o755);
    expect(shortcutStatus({}, e).managed).toBe(true);
    expect(removeShortcut({}, e).removed).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('實際以 sh 執行產生的腳本：參數原樣傳給本工具，不會被 shell 解讀', () => {
    const out = path.join(dir, 'argv.txt');
    const recorder = write(path.join(dir, 'bin', 'record'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done > ${quotePosixArg(out)}\n`);
    fs.chmodSync(recorder, 0o755);
    const evilPath = path.join(dir, '$(touch pwned) `id` it\'s');
    const e = env({ platform: 'darwin', self: { exe: recorder, args: ['--flag'] } });
    const r = installShortcut({ lang: 'ko', path: evilPath }, e);
    const run = spawnSync('sh', [r.file], { encoding: 'utf8', cwd: dir });
    expect(run.status).toBe(0);
    expect(fs.readFileSync(out, 'utf8').split('\0').slice(0, -1)).toEqual(['--flag', 'launch', '--lang', 'ko', '--path', evilPath]);
    expect(fs.existsSync(path.join(dir, 'pwned'))).toBe(false);
  });
});

describe('shortcut：Linux .desktop', () => {
  it('~/.local/share/applications/antigravity-i18n.desktop', () => {
    const root = path.join(dir, 'Antigravity');
    write(path.join(root, 'antigravity.png'), 'png');
    const e = env({ self: { exe: '/usr/bin/node', args: ['/home/me/a b/cli.js'] } });
    const r = installShortcut({ name: 'Antigravity 中文' }, e, root);
    expect(r.kind).toBe('linux-desktop');
    expect(r.file).toBe(path.posix.join(e.home, '.local', 'share', 'applications', LINUX_DESKTOP_FILE));
    const text = fs.readFileSync(r.file, 'utf8');
    expect(text).toContain('[Desktop Entry]\nType=Application\n');
    expect(text).toContain('Name=Antigravity 中文\n');
    expect(text).toContain('Terminal=false\n');
    expect(text).toContain(`Icon=${path.posix.join(root, 'antigravity.png').replace(/\\/g, '\\\\')}\n`);
    const exec = /^Exec=(.*)$/m.exec(text)![1]!;
    expect(parseDesktopExec(exec)).toEqual(['/usr/bin/node', '/home/me/a b/cli.js', 'launch']);
    expect(shortcutStatus({}, e, root)).toMatchObject({ exists: true, managed: true });
  });

  it('名稱不能注入額外的 desktop 欄位；沒有圖示時使用主題圖示名稱', () => {
    const e = env();
    expect(() => installShortcut({ name: 'x\nExec=rm -rf ~' }, e)).toThrow(ShortcutError);
    const plan = planShortcut({}, e);
    expect(plan.content).toContain('Icon=antigravity\n');
    expect(plan.warnings.join()).toMatch(/尚未偵測到/);
  });

  it('npx 暫存路徑提示改用全域安裝或單檔執行檔', () => {
    const plan = planShortcut({}, env({ self: { exe: '/usr/bin/node', args: ['/home/me/.npm/_npx/abc/node_modules/antigravity-i18n/dist/cli.js'] } }), '/opt/ag');
    expect(plan.warnings.join()).toMatch(/npx/);
  });
});

describe('shortcut 指令（CLI）', () => {
  it('install / status / remove，並把錯誤轉成 CliError', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ').replace(/\x1b\[[0-9;]*m/g, '')));
    const deps: ShortcutCommandDeps = { env: env(), installRoot: () => '/opt/ag' };
    expect(await shortcutCommand('install', { lang: 'zh-TW' }, deps)).toBe(0);
    expect(lines.join('\n')).toMatch(/已建立捷徑.*\n.*Linux 應用程式選單項目/);
    expect(lines.join('\n')).toContain('launch --lang zh-TW');
    lines.length = 0;
    expect(await shortcutCommand('status', {}, deps)).toBe(0);
    expect(lines.join('\n')).toContain('已建立');
    expect(await shortcutCommand('remove', {}, deps)).toBe(0);
    expect(fs.existsSync(path.posix.join(deps.env.home, '.local', 'share', 'applications', LINUX_DESKTOP_FILE))).toBe(false);
    await expect(shortcutCommand('install', { lang: 'fr' }, deps)).rejects.toBeInstanceOf(CliError);
    await expect(shortcutCommand('install', { name: '' }, deps)).rejects.toBeInstanceOf(CliError);
    await expect(shortcutCommand('explode', {}, deps)).rejects.toBeInstanceOf(CliError);
  });
});

// ─────────────────────────────────────────────────────────────
// 控制台 API
// ─────────────────────────────────────────────────────────────

interface Res {
  status: number;
  json: Record<string, unknown>;
}

function request(srv: UiServer, opts: { method?: string; path: string; body?: unknown; token?: string | null; host?: string; origin?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { Host: opts.host ?? `${UI_HOST}:${srv.port}` };
    if (opts.token !== null) headers['X-AGI18N-Token'] = opts.token ?? srv.token;
    if (opts.origin) headers.Origin = opts.origin;
    if (data !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data));
    }
    const req = http.request({ host: UI_HOST, port: srv.port, method: opts.method ?? 'GET', path: opts.path, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        } catch {
          /* html */
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

describe('控制台：桌面捷徑 API', () => {
  let srv: UiServer;
  let scEnv: ShortcutEnv;
  const onlyCustom: Detect = (id, customPath) => (customPath ? detectTarget(id, { customPath }) : null);
  const desktopFile = (): string => path.posix.join(scEnv.home, '.local', 'share', 'applications', LINUX_DESKTOP_FILE);

  beforeEach(async () => {
    scEnv = env();
    srv = await startUiServer({
      toolHome: path.join(dir, 'tool-home'),
      userHome: path.join(dir, 'user-home'),
      toolVersion: '9.9.9',
      detect: onlyCustom,
      wsl: null,
      shortcutEnv: scEnv,
    });
  });
  afterEach(async () => {
    await srv.close();
  });

  it.each([
    ['GET', '/api/shortcut'],
    ['POST', '/api/shortcut/install'],
    ['POST', '/api/shortcut/remove'],
  ])('%s %s：缺少或錯誤 Token、錯誤 Host、跨站 Origin 一律 403', async (method, p) => {
    const body = method === 'GET' ? undefined : {};
    expect((await request(srv, { method, path: p, token: null, body })).status).toBe(403);
    expect((await request(srv, { method, path: p, token: 'a'.repeat(64), body })).status).toBe(403);
    expect((await request(srv, { method, path: p, body, host: `localhost:${srv.port}` })).status).toBe(403);
    expect((await request(srv, { method, path: p, body, host: 'evil.example' })).status).toBe(403);
    expect((await request(srv, { method, path: p, body, origin: 'https://evil.example' })).status).toBe(403);
    // 被拒絕的請求不會建立任何捷徑
    expect(fs.existsSync(desktopFile())).toBe(false);
  });

  it('install → GET 狀態 → remove（只寫入注入的暫存家目錄）', async () => {
    const st0 = await request(srv, { path: '/api/shortcut' });
    expect(st0.status).toBe(200);
    expect(st0.json.shortcut).toMatchObject({ action: 'status', kind: 'linux-desktop', exists: false });

    const r = await request(srv, { method: 'POST', path: '/api/shortcut/install', body: { name: 'AG', lang: 'zh-CN' }, origin: `http://127.0.0.1:${srv.port}` });
    expect(r.status).toBe(200);
    expect(r.json.shortcut).toMatchObject({ action: 'install', exists: true, managed: true, file: desktopFile() });
    expect(fs.readFileSync(desktopFile(), 'utf8')).toContain('Name=AG\n');
    expect(fs.readFileSync(desktopFile(), 'utf8')).toMatch(/Exec=.* launch --lang zh-CN\n/);

    expect((await request(srv, { path: '/api/shortcut' })).json.shortcut).toMatchObject({ exists: true, managed: true });
    const rm1 = await request(srv, { method: 'POST', path: '/api/shortcut/remove', body: {} });
    expect(rm1.json.shortcut).toMatchObject({ removed: true });
    expect(fs.existsSync(desktopFile())).toBe(false);
  });

  it('不合法的參數回傳 400；非本工具建立的同名檔案回傳 409', async () => {
    expect((await request(srv, { method: 'POST', path: '/api/shortcut/install', body: { lang: 'fr' } })).status).toBe(400);
    expect((await request(srv, { method: 'POST', path: '/api/shortcut/install', body: { name: 42 } })).status).toBe(400);
    const bad = await request(srv, { method: 'POST', path: '/api/shortcut/install', body: { name: 'a\nExec=evil' } });
    expect(bad.status).toBe(409);
    write(desktopFile(), '[Desktop Entry]\nName=mine\n');
    const r = await request(srv, { method: 'POST', path: '/api/shortcut/install', body: {} });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/--force/);
    expect(fs.readFileSync(desktopFile(), 'utf8')).toBe('[Desktop Entry]\nName=mine\n');
    expect((await request(srv, { method: 'POST', path: '/api/shortcut/remove', body: {} })).status).toBe(409);
  });

  it('首頁有捷徑操作區；介面文字五語齊全', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http
        .get({ host: UI_HOST, port: srv.port, path: '/', headers: { Host: `${UI_HOST}:${srv.port}` }, agent: false }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        })
        .on('error', reject);
    });
    expect(html).toContain('id="shortcut-card"');
    expect(html).toContain('data-act="sc-install"');
    expect(html).toContain('data-act="sc-remove"');
    expect(html).toContain("'/api/shortcut/install'");
    for (const lang of ['zh-TW', 'zh-CN', 'ja', 'ko', 'en'] as const) {
      for (const k of ['sc.title', 'sc.install', 'sc.remove', 'sc.kind.windows-lnk', 'sc.kind.wsl-lnk', 'sc.kind.macos-command', 'sc.kind.linux-desktop']) {
        expect(UI_TEXT[lang][k], `${lang} ${k}`).toBeTruthy();
      }
    }
  });
});
