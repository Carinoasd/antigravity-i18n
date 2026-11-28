import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import * as asar from '@electron/asar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../src/commands/common.js';
import { launchCommand } from '../src/commands/launch.js';
import { detectTarget } from '../src/config/paths.js';
import { manifestPathFor, readManifest, sha256File, writeManifest } from '../src/core/backup.js';
import { FileLockError } from '../src/core/errors.js';
import {
  LAUNCH_STATE_FILE,
  LaunchError,
  cachedSha256,
  checkReapply,
  findWindowsExe,
  launchCommandFor,
  resolveLaunchTarget,
  smartLaunch,
  spawnDetached,
  type ChildLike,
  type LaunchDeps,
  type LaunchEnv,
  type Spawn,
  type SpawnOptionsLike,
} from '../src/core/launcher.js';
import { applyTarget, restoreManifest } from '../src/core/patcher.js';
import { HOOK_VERSION } from '../src/core/runtime.js';
import type { Manifest } from '../src/types.js';
import { packAsar, rm, tmpDir, write } from './helpers.js';

let dir: string;
let home: string;
beforeEach(() => {
  dir = tmpDir('agi18n-launch-');
  home = path.join(dir, 'tool-home');
});
afterEach(() => {
  vi.restoreAllMocks();
  rm(dir);
});

const DICT = { Settings: '設定', 'Check for Updates': '檢查更新' };
const DICT_CN = { Settings: '设置', 'Check for Updates': '检查更新' };

/** 模擬 Linux 版 Antigravity：<root>/antigravity 執行檔 + <root>/resources/app.asar */
async function makeApp(version = '1.0.0'): Promise<{ root: string; asarPath: string }> {
  const src = path.join(dir, `src-${version}`);
  rm(src);
  write(path.join(src, 'package.json'), JSON.stringify({ name: 'antigravity', version, main: 'dist/main.js' }));
  write(path.join(src, 'dist', 'main.js'), `'use strict';\nconst { app } = require('electron');\n// ${version}\n`);
  write(path.join(src, 'dist', 'menu.js'), `Menu.buildFromTemplate([{label:"Settings"},{label:"Check for Updates"}]); // ${version}`);
  const root = path.join(dir, 'Antigravity');
  write(path.join(root, EXE), '#!/bin/sh\n');
  const asarPath = path.join(root, 'resources', 'app.asar');
  fs.mkdirSync(path.dirname(asarPath), { recursive: true });
  // 模擬官方更新：先寫到暫存檔再改名（新的 inode）
  const tmp = `${asarPath}.new`;
  await packAsar(src, tmp, {});
  fs.renameSync(tmp, asarPath);
  asar.uncacheAll();
  return { root, asarPath };
}

interface SpawnCall {
  cmd: string;
  args: string[];
  opts: SpawnOptionsLike;
  unref: number;
}

/** 假的 spawn：記錄呼叫，下一個 tick 發出 spawn（或 error）事件 */
function mockSpawn(fail?: Error): { spawn: Spawn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: Spawn = (cmd, args, opts) => {
    const call: SpawnCall = { cmd, args, opts, unref: 0 };
    calls.push(call);
    const child = new EventEmitter() as EventEmitter & ChildLike;
    child.unref = () => void call.unref++;
    process.nextTick(() => (fail ? child.emit('error', fail) : child.emit('spawn')));
    return child;
  };
  return { spawn, calls };
}

/** Windows CI 上以 Windows 規則尋找 Antigravity.exe，其他平台以 Linux 規則尋找 antigravity */
const TEST_PLATFORM: NodeJS.Platform = process.platform === 'win32' ? 'win32' : 'linux';
const EXE = TEST_PLATFORM === 'win32' ? 'Antigravity.exe' : 'antigravity';
const linuxEnv: LaunchEnv = { platform: TEST_PLATFORM, wsl: false, exists: (p) => fs.existsSync(p) };

function deps(root: string, extra: Partial<LaunchDeps> = {}): LaunchDeps & { calls: SpawnCall[] } {
  const { spawn, calls } = mockSpawn();
  return {
    toolHome: home,
    toolVersion: '9.9.9',
    // 只認得測試建立的路徑，絕不偵測真實安裝
    detect: (customPath) => detectTarget('app', { customPath: customPath ?? root }),
    loadDict: (lang) => (lang === 'zh-CN' ? DICT_CN : DICT),
    env: linuxEnv,
    spawn,
    calls,
    ...extra,
  };
}

async function applyOnce(root: string, lang: 'zh-TW' | 'zh-CN' = 'zh-TW'): Promise<Manifest> {
  const t = detectTarget('app', { customPath: root })!;
  const r = await applyTarget(t, { lang, dict: lang === 'zh-CN' ? DICT_CN : DICT, toolHome: home, toolVersion: '9.9.9' });
  expect(r.status).toBe('applied');
  return readManifest(r.manifestPath)!;
}

const readMenu = (asarPath: string): string => {
  asar.uncacheAll();
  return asar.extractFile(asarPath, path.join('dist', 'menu.js')).toString('utf8');
};

// ─────────────────────────────────────────────────────────────

describe('launch：平台啟動指令（純函式）', () => {
  const has = (...files: string[]) => (p: string) => files.includes(p);

  it('Windows：<installRoot>\\Antigravity.exe；以 --path 指向 resources 時往上一層找', () => {
    const root = 'C:\\Users\\me\\AppData\\Local\\Programs\\Antigravity';
    const exe = `${root}\\Antigravity.exe`;
    expect(launchCommandFor(root, { platform: 'win32', wsl: false, exists: has(exe) })).toEqual({ cmd: exe, args: [], display: exe });
    expect(launchCommandFor(`${root}\\resources`, { platform: 'win32', wsl: false, exists: has(exe) }).cmd).toBe(exe);
    expect(findWindowsExe(root, () => false)).toEqual({ exe, found: false });
    expect(() => launchCommandFor(root, { platform: 'win32', wsl: false, exists: () => false })).toThrow(LaunchError);
  });

  it('macOS：open -a <installRoot>（等待包裝程式結束）', () => {
    const c = launchCommandFor('/Applications/Antigravity App.app', { platform: 'darwin', wsl: false, exists: () => false });
    expect(c.cmd).toBe('open');
    expect(c.args).toEqual(['-a', '/Applications/Antigravity App.app']);
    expect(c.waitForExit).toBe(true);
  });

  it('Linux：偵測 antigravity / Antigravity 執行檔', () => {
    expect(launchCommandFor('/opt/Antigravity', { platform: 'linux', wsl: false, exists: has('/opt/Antigravity/Antigravity') }).cmd).toBe('/opt/Antigravity/Antigravity');
    expect(launchCommandFor('/opt/ag', { platform: 'linux', wsl: false, exists: has('/opt/ag/antigravity') }).cmd).toBe('/opt/ag/antigravity');
    expect(() => launchCommandFor('/opt/ag', { platform: 'linux', wsl: false, exists: () => false })).toThrow(/找不到 antigravity 執行檔/);
  });

  it('WSL：/mnt/c 下的安裝轉成 Windows 路徑，以 cmd.exe /c start "" 啟動並等待 cmd.exe 結束', () => {
    const root = '/mnt/c/Users/me/AppData/Local/Programs/Antigravity';
    const env: LaunchEnv = { platform: 'linux', wsl: true, exists: has(`${root}/Antigravity.exe`, '/mnt/c/Windows/System32/cmd.exe', '/mnt/c') };
    const c = launchCommandFor(root, env);
    expect(c.cmd).toBe('/mnt/c/Windows/System32/cmd.exe');
    expect(c.args).toEqual(['/d', '/c', 'start', '', 'C:\\Users\\me\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe']);
    expect(c.cwd).toBe('/mnt/c');
    expect(c.waitForExit).toBe(true);
    // 非 WSL 的 Linux 不會走 cmd.exe
    expect(() => launchCommandFor(root, { ...env, wsl: false })).toThrow(LaunchError);
  });

  it('WSL：路徑含 cmd.exe 特殊字元時拒絕啟動（防止指令注入）', () => {
    for (const user of ['a&calc', 'a|b', 'a^b', 'a%PATH%', 'a>b']) {
      const root = `/mnt/c/Users/${user}/Antigravity`;
      expect(() => launchCommandFor(root, { platform: 'linux', wsl: true, exists: has(`${root}/Antigravity.exe`) })).toThrow(/特殊字元/);
    }
  });

  it('spawnDetached：直接執行本體採 detached + unref；waitForExit（WSL / macOS）等待 exit 並檢查狀態碼', async () => {
    const ok = mockSpawn();
    await spawnDetached({ cmd: '/x/antigravity', args: ['--a'], display: '' }, ok.spawn);
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]).toMatchObject({ cmd: '/x/antigravity', args: ['--a'], opts: { detached: true, stdio: 'ignore' }, unref: 1 });
    const bad = mockSpawn(new Error('ENOENT'));
    await expect(spawnDetached({ cmd: '/nope', args: [], display: '' }, bad.spawn)).rejects.toThrow('ENOENT');

    // waitForExit：不在 spawn 就提早結束，而是等 exit(0)；非 0 則拋出 LaunchError
    const waitCalls: SpawnCall[] = [];
    const waitSpawn = (code: number | null): Spawn => (cmd, args, opts) => {
      const call: SpawnCall = { cmd, args, opts, unref: 0 };
      waitCalls.push(call);
      const child = new EventEmitter() as EventEmitter & ChildLike;
      child.unref = () => void call.unref++;
      process.nextTick(() => {
        child.emit('spawn');
        setTimeout(() => child.emit('exit', code, null), 10);
      });
      return child;
    };
    let resolvedEarly = false;
    const p = spawnDetached({ cmd: '/mnt/c/Windows/System32/cmd.exe', args: ['/d', '/c', 'start', '', 'C:\\app.exe'], display: 'cmd', waitForExit: true }, waitSpawn(0)).then(() => {
      resolvedEarly = true;
    });
    await new Promise((r) => setTimeout(r, 2));
    expect(resolvedEarly).toBe(false);
    await p;
    expect(resolvedEarly).toBe(true);
    expect(waitCalls[0]).toMatchObject({ opts: { detached: false, stdio: 'ignore', windowsHide: true }, unref: 0 });
    await expect(spawnDetached({ cmd: 'cmd.exe', args: [], display: 'cmd', waitForExit: true }, waitSpawn(1))).rejects.toThrow(LaunchError);
  });
});

describe('launch：判斷是否需要重新套用', () => {
  const manifest = (over: Partial<Manifest> = {}): Manifest => ({
    schemaVersion: 1,
    tool: 'antigravity-i18n',
    toolVersion: '0',
    target: 'app',
    lang: 'zh-TW',
    kind: 'asar',
    installRoot: '/opt/ag',
    appliedAt: '',
    backupDir: '',
    files: [{ path: '/opt/ag/resources/app.asar', role: 'content', originalSha256: 'o', patchedSha256: 'p', backupPath: '', hits: 1 }],
    stats: { totalKeys: 0, matchedKeys: 0, totalHits: 0, coverage: 0 },
    runtime: { entries: 1, mainEntry: 'dist/main.js', hookVersion: HOOK_VERSION, translation: true },
    ...over,
  });
  const asarPath = '/opt/ag/resources/app.asar';

  it('雜湊相同、掛鉤最新 → 不需要', () => {
    expect(checkReapply(manifest(), asarPath, 'p')).toEqual({ needed: false, reasons: [], lang: 'zh-TW' });
  });
  it('雜湊不同（官方更新）、舊版掛鉤、指定不同語系', () => {
    expect(checkReapply(manifest(), asarPath, 'new').reasons).toEqual(['updated']);
    expect(checkReapply(manifest({ runtime: { entries: 1, mainEntry: 'm', hookVersion: HOOK_VERSION - 1 } }), asarPath, 'p').reasons).toEqual(['old-hook']);
    expect(checkReapply(manifest({ runtime: { entries: 1, mainEntry: 'm' } }), asarPath, 'p').reasons).toEqual(['old-hook']);
    expect(checkReapply(manifest(), asarPath, 'p', 'zh-CN')).toEqual({ needed: true, reasons: ['lang-changed'], lang: 'zh-CN' });
    expect(checkReapply(manifest(), asarPath, 'p', 'zh-TW').needed).toBe(false);
  });
  it('--no-runtime 套用的 manifest 不視為舊版掛鉤', () => {
    expect(checkReapply(manifest({ runtime: undefined }), asarPath, 'p').needed).toBe(false);
  });
});

describe('launch：雜湊快取（毫秒級跳過）', () => {
  it('stat 不變時命中快取，檔案被替換後重新計算', async () => {
    const f = write(path.join(dir, 'a.bin'), 'one');
    const first = await cachedSha256(f, home);
    expect(first).toEqual({ sha256: await sha256File(f), cached: false });
    expect(fs.existsSync(path.join(home, LAUNCH_STATE_FILE))).toBe(true);
    expect(await cachedSha256(f, home)).toEqual({ sha256: first.sha256, cached: true });
    const tmp = write(path.join(dir, 'b.bin'), 'two!');
    fs.renameSync(tmp, f);
    const again = await cachedSha256(f, home);
    expect(again.cached).toBe(false);
    expect(again.sha256).toBe(await sha256File(f));
  });

  it('損毀的快取檔不影響結果', async () => {
    const f = write(path.join(dir, 'a.bin'), 'one');
    write(path.join(home, LAUNCH_STATE_FILE), '{oops');
    expect((await cachedSha256(f, home)).sha256).toBe(await sha256File(f));
  });
});

describe('launch：智慧啟動流程', () => {
  it('已是最新修補狀態：不重新套用、直接啟動，第二次命中雜湊快取', async () => {
    const { root, asarPath } = await makeApp();
    await applyOnce(root);
    const patched = fs.readFileSync(asarPath);
    const apply = vi.fn(applyTarget);
    const d = deps(root, { apply });

    const r1 = await smartLaunch({}, d);
    expect(r1.status).toBe('up-to-date');
    expect(r1.launched).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]).toMatchObject({ cmd: path.join(root, EXE), args: [], opts: { detached: true, stdio: 'ignore' }, unref: 1 });

    const r2 = await smartLaunch({}, d);
    expect(r2).toMatchObject({ status: 'up-to-date', cached: true });
    expect(apply).not.toHaveBeenCalled();
    expect(fs.readFileSync(asarPath)).toEqual(patched);
  });

  it('官方自動更新覆蓋 app.asar：以上次的語系重新套用（備份新版原始檔），restore 還原成新版', async () => {
    const { root } = await makeApp('1.0.0');
    const before = await applyOnce(root);
    // 官方自動更新：整個 app.asar 被換成新版（未翻譯）
    const { asarPath } = await makeApp('2.0.0');
    const v2 = fs.readFileSync(asarPath);
    expect(readMenu(asarPath)).toContain('label:"Settings"');

    const d = deps(root);
    const r = await smartLaunch({}, d);
    expect(r.status).toBe('reapplied');
    expect(r.reasons).toEqual(['updated']);
    expect(r.lang).toBe('zh-TW');
    expect(d.calls).toHaveLength(1);
    expect(readMenu(asarPath)).toContain('label:"設定"');
    expect(readMenu(asarPath)).toContain('// 2.0.0');

    const m = readManifest(manifestPathFor(home, { id: 'app', installRoot: root }))!;
    expect(m.files[0]!.originalSha256).not.toBe(before.files[0]!.originalSha256);
    expect(m.files[0]!.patchedSha256).toBe(await sha256File(asarPath));
    // 重新套用後雜湊已記進快取：下一次啟動毫秒級跳過
    expect(await smartLaunch({}, d)).toMatchObject({ status: 'up-to-date', cached: true });

    // 還原的是「新版」原始檔，逐位元組相同
    await restoreManifest(manifestPathFor(home, { id: 'app', installRoot: root }), { toolHome: home });
    expect(fs.readFileSync(asarPath)).toEqual(v2);
  });

  it('舊版掛鉤：自動升級；--lang 可覆蓋上次的語系', async () => {
    const { root, asarPath } = await makeApp();
    await applyOnce(root);
    const file = manifestPathFor(home, { id: 'app', installRoot: root });
    const m = readManifest(file)!;
    writeManifest(file, { ...m, runtime: { ...m.runtime!, hookVersion: 3 } });

    const r = await smartLaunch({}, deps(root));
    expect(r).toMatchObject({ status: 'reapplied', reasons: ['old-hook'], lang: 'zh-TW' });
    expect(readManifest(file)!.runtime!.hookVersion).toBe(HOOK_VERSION);

    const r2 = await smartLaunch({ lang: 'zh-CN' }, deps(root));
    expect(r2).toMatchObject({ status: 'reapplied', reasons: ['lang-changed'], lang: 'zh-CN' });
    expect(readMenu(asarPath)).toContain('label:"设置"');
    expect(readManifest(file)!.lang).toBe('zh-CN');
  });

  it('Antigravity 執行中（檔案被鎖定）：不中斷啟動，略過本次重套用且不留下半套用狀態', async () => {
    const { root } = await makeApp('1.0.0');
    await applyOnce(root);
    const { asarPath } = await makeApp('2.0.0');
    const v2 = fs.readFileSync(asarPath);
    const file = manifestPathFor(home, { id: 'app', installRoot: root });
    const manifestBefore = fs.readFileSync(file);
    const realRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === asarPath) throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
      return realRename(from, to);
    });

    const d = deps(root);
    const r = await smartLaunch({}, d);
    expect(r.status).toBe('locked');
    expect(r.steps?.join('\n')).toMatch(/系統匣/);
    expect(r.launched).toBe(true);
    expect(d.calls).toHaveLength(1);
    expect(fs.readFileSync(asarPath)).toEqual(v2);
    expect(fs.readFileSync(file)).toEqual(manifestBefore);
  });

  it('CLI：鎖定時印出友善提示並回傳 0；其他錯誤仍會啟動但回傳 1', async () => {
    const { root } = await makeApp('1.0.0');
    await applyOnce(root);
    await makeApp('2.0.0');
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ').replace(/\x1b\[[0-9;]*m/g, '')));

    const locked = deps(root, {
      apply: async () => {
        throw new FileLockError('EBUSY', '/x/app.asar', { code: 'EBUSY', title: '檔案正被 Antigravity 使用中，無法寫入', steps: ['關閉'] });
      },
    });
    expect(await launchCommand({}, locked)).toBe(0);
    expect(lines.join('\n')).toMatch(/正在執行.*略過/);
    expect(lines.join('\n')).toContain('已啟動 Antigravity');
    expect(locked.calls).toHaveLength(1);

    lines.length = 0;
    const broken = deps(root, { apply: async () => Promise.reject(new Error('boom')) });
    expect(await launchCommand({}, broken)).toBe(1);
    expect(lines.join('\n')).toMatch(/重新套用失敗.*boom/);
    expect(broken.calls).toHaveLength(1);
  });

  it('尚未套用過：直接啟動，不寫入任何檔案；--no-reapply 完全不檢查', async () => {
    const { root, asarPath } = await makeApp();
    const original = fs.readFileSync(asarPath);
    const d = deps(root);
    expect((await smartLaunch({}, d)).status).toBe('not-applied');
    expect(fs.existsSync(home)).toBe(false);

    await applyOnce(root);
    await makeApp('2.0.0');
    const apply = vi.fn(applyTarget);
    const r = await smartLaunch({ reapply: false }, deps(root, { apply }));
    expect(r.status).toBe('disabled');
    expect(apply).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(home, LAUNCH_STATE_FILE))).toBe(false);
    expect(original.length).toBeGreaterThan(0);
  });

  it('找不到 App 或執行檔：拋出錯誤，不啟動也不寫入', async () => {
    const d = deps(dir, { detect: () => null });
    await expect(smartLaunch({}, d)).rejects.toThrow(/找不到 Antigravity App/);
    await expect(launchCommand({}, d)).rejects.toBeInstanceOf(CliError);
    const { root } = await makeApp();
    await applyOnce(root);
    fs.rmSync(path.join(root, EXE));
    await makeApp('2.0.0');
    fs.rmSync(path.join(root, EXE));
    const d2 = deps(root);
    const manifestBefore = fs.readFileSync(manifestPathFor(home, { id: 'app', installRoot: root }));
    await expect(smartLaunch({}, d2)).rejects.toThrow(/找不到 (antigravity|Antigravity) 執行檔/);
    expect(d2.calls).toHaveLength(0);
    expect(fs.readFileSync(manifestPathFor(home, { id: 'app', installRoot: root }))).toEqual(manifestBefore);
  });

  it('偵測不到時改用先前以 --path 套用的安裝位置', async () => {
    const { root } = await makeApp();
    await applyOnce(root);
    const detect = (p?: string) => (p ? detectTarget('app', { customPath: p }) : null);
    expect(resolveLaunchTarget({ toolHome: home, detect })?.installRoot).toBe(root);
    expect(resolveLaunchTarget({ toolHome: home, detect }, path.join(dir, 'nope'))).toBeNull();
    const r = await smartLaunch({}, deps(root, { detect }));
    expect(r.status).toBe('up-to-date');
  });
});
