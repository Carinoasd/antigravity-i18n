import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bgClearCommand,
  bgPresetCommand,
  bgPresetsCommand,
  bgSetCommand,
  bgStatusCommand,
  bgToggleCommand,
  hookHint,
} from '../src/commands/bg.js';
import { writeManifest, manifestPathFor } from '../src/core/backup.js';
import {
  BACKGROUND_DEFAULTS,
  IMAGE_MIME,
  MAX_IMAGE_BYTES,
  backgroundStatus,
  clearBackground,
  mirrorHome,
  parseBlur,
  parseMode,
  parseOpacity,
  parsePosition,
  parseSize,
  parseTint,
  presetNames,
  readBackgroundConfig,
  resolveWindowsHome,
  setBackground,
  setBackgroundEnabled,
  setPreset,
  sniffImage,
  validateImage,
  windowsToWslPath,
  wslToWindowsPath,
  type WslContext,
} from '../src/core/background.js';
import { BACKGROUND_PRESETS, presetImages } from '../src/core/presets.js';
import { HOOK_VERSION, RUNTIME_FILE_NAME, buildRuntimeScript, injectHook } from '../src/core/runtime.js';
import { applyBackground, readBackgroundPayload, type BackgroundPayload } from '../src/runtime/background.js';
import type { Manifest } from '../src/types.js';
import { rm, tmpDir, write } from './helpers.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const NO_WSL = { wsl: null } as const;

let dir: string;
let home: string;
beforeEach(() => {
  dir = tmpDir();
  home = path.join(dir, 'tool-home');
});
afterEach(() => {
  rm(dir);
  vi.restoreAllMocks();
});

const image = (name = 'bg.png', data: Buffer = PNG): string => write(path.join(dir, 'pics', name), data);

/** 建立指定大小的檔案（sparse，不實際佔用磁碟） */
function sized(name: string, bytes: number): string {
  const p = path.join(dir, 'pics', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const fd = fs.openSync(p, 'w');
  fs.ftruncateSync(fd, bytes);
  fs.closeSync(fd);
  return p;
}

describe('參數驗證', () => {
  it('opacity：0.01 ~ 1', () => {
    expect(parseOpacity(undefined)).toBe(0.12);
    expect(parseOpacity('0.01')).toBe(0.01);
    expect(parseOpacity('1')).toBe(1);
    for (const bad of ['0', '0.001', '1.5', '-1', 'abc', '']) expect(() => parseOpacity(bad)).toThrow(/--opacity/);
  });

  it('blur：0 ~ 100 px，接受 px 後綴', () => {
    expect(parseBlur(undefined)).toBe(0);
    expect(parseBlur('4')).toBe(4);
    expect(parseBlur('8px')).toBe(8);
    for (const bad of ['-1', '101', 'x', '']) expect(() => parseBlur(bad)).toThrow(/--blur/);
  });

  it('size / mode', () => {
    expect(parseSize(undefined)).toBe('cover');
    expect(parseSize('Contain')).toBe('contain');
    expect(() => parseSize('fill')).toThrow(/--size/);
    expect(parseMode(undefined)).toBe('overlay');
    expect(parseMode('underlay')).toBe('underlay');
    expect(() => parseMode('behind')).toThrow(/--mode/);
  });

  it('position 只接受安全的 CSS 值（防止 CSS 注入）', () => {
    expect(parsePosition(undefined)).toBe('center');
    expect(parsePosition('top  right')).toBe('top right');
    expect(parsePosition('50% 20%')).toBe('50% 20%');
    expect(parsePosition('-10px 0')).toBe('-10px 0');
    for (const bad of ['red;} body{display:none', 'url(x)', 'center"', 'a'.repeat(65)]) {
      expect(() => parsePosition(bad)).toThrow(/--position/);
    }
  });
});

describe('圖片格式與大小', () => {
  it.each(Object.keys(IMAGE_MIME))('允許 %s（不分大小寫）', (ext) => {
    const p = image(`a${ext.toUpperCase()}`);
    expect(validateImage(p).mime).toBe(IMAGE_MIME[ext]);
  });

  it.each(['a.svg', 'a.bmp', 'a.txt', 'noext'])('拒絕 %s', (name) => {
    const p = image(name);
    expect(() => validateImage(p)).toThrow(/不支援的圖片格式/);
  });

  it('上限 10 MB：剛好 10 MB 可以，多 1 byte 拒絕', () => {
    expect(validateImage(sized('max.png', MAX_IMAGE_BYTES)).size).toBe(MAX_IMAGE_BYTES);
    expect(() => validateImage(sized('big.png', MAX_IMAGE_BYTES + 1))).toThrow(/超過上限 10 MB/);
  });

  it('找不到、目錄、空檔案', () => {
    expect(() => validateImage(path.join(dir, 'missing.png'))).toThrow(/找不到圖片/);
    fs.mkdirSync(path.join(dir, 'folder.png'));
    expect(() => validateImage(path.join(dir, 'folder.png'))).toThrow(/不是檔案/);
    expect(() => validateImage(image('empty.png', Buffer.alloc(0)))).toThrow(/空檔案/);
  });

  it('相對路徑正規化為絕對路徑', () => {
    image('rel.png');
    expect(validateImage('pics/rel.png', dir).absPath).toBe(path.join(dir, 'pics', 'rel.png'));
  });
});

describe('WSL 路徑轉換', () => {
  it('/mnt/<drive>/... → <DRIVE>:\\...', () => {
    expect(wslToWindowsPath('/mnt/c/Users/Alice/Pictures/bg.png')).toBe('C:\\Users\\Alice\\Pictures\\bg.png');
    expect(wslToWindowsPath('/mnt/d/wall papers/a.jpg')).toBe('D:\\wall papers\\a.jpg');
    expect(wslToWindowsPath('/mnt/c')).toBe('C:\\');
  });

  it('WSL 檔案系統路徑轉為 \\\\wsl.localhost UNC 路徑', () => {
    expect(wslToWindowsPath('/home/u/bg.png', 'Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\u\\bg.png');
    expect(wslToWindowsPath('/home/u/bg.png')).toBeNull();
  });

  it('Windows 路徑 → WSL 路徑', () => {
    expect(windowsToWslPath('C:\\Users\\Alice')).toBe('/mnt/c/Users/Alice');
    expect(windowsToWslPath('D:/Pictures/')).toBe('/mnt/d/Pictures');
    expect(windowsToWslPath('/home/u')).toBeNull();
  });

  it('resolveWindowsHome：環境變數 → cmd.exe → 唯一使用者', () => {
    const pe = (env: NodeJS.ProcessEnv, users?: string[]) => ({ platform: 'linux' as const, home: '/home/u', env, wslWindowsUsers: users });
    const fail = (): string => {
      throw new Error('no interop');
    };
    const yes = (): boolean => true;
    expect(resolveWindowsHome(pe({ ANTIGRAVITY_I18N_WIN_HOME: 'C:\\Users\\Me' }), fail)).toBe('/mnt/c/Users/Me');
    expect(resolveWindowsHome(pe({}), () => 'C:\\Users\\Bob\r\n', yes)).toBe('/mnt/c/Users/Bob');
    expect(resolveWindowsHome(pe({}, ['Solo']), fail)).toBe('/mnt/c/Users/Solo');
    expect(resolveWindowsHome(pe({}, ['A', 'B']), fail)).toBeNull();
  });

  it('WSL 中設定時記錄 Windows 路徑，並鏡像到 Windows 家目錄', () => {
    const winHome = path.join(dir, 'winhome');
    const wsl: WslContext = { distro: 'Ubuntu', windowsHome: winHome };
    const p = image();
    const r = setBackground(home, p, { wsl });
    // POSIX 暫存路徑會轉成 UNC 路徑；在 Windows runner 上暫存目錄本身就是 C:\...，
    // 不是 WSL 會出現的路徑，此時不應記錄 windowsPath
    const expected = wslToWindowsPath(p, 'Ubuntu');
    if (expected) expect(r.config.windowsPath).toBe(expected);
    else expect(r.config.windowsPath).toBeUndefined();
    expect(r.mirror).toBe(path.join(winHome, '.antigravity-i18n', 'background.json'));
    expect(fs.readFileSync(r.mirror!, 'utf8')).toBe(fs.readFileSync(r.file, 'utf8'));
    // 圖片在 WSL 檔案系統時提醒改放 Windows 磁碟
    expect(r.warnings.some((w) => w.includes('/mnt/c'))).toBe(true);

    setBackgroundEnabled(home, false, { wsl });
    expect(JSON.parse(fs.readFileSync(r.mirror!, 'utf8')).enabled).toBe(false);
    expect(backgroundStatus(home, { wsl }).mirrorInSync).toBe(true);
    expect(clearBackground(home, { wsl })).toEqual([r.file, r.mirror]);
  });

  it('非 WSL 不記錄 Windows 路徑也不鏡像；找不到 Windows 家目錄時警告', () => {
    const r = setBackground(home, image(), NO_WSL);
    expect(r.config.windowsPath).toBeUndefined();
    expect(r.mirror).toBeUndefined();
    const r2 = setBackground(home, image(), { wsl: { windowsHome: null } });
    expect(r2.warnings.some((w) => w.includes('ANTIGRAVITY_I18N_WIN_HOME'))).toBe(true);
    expect(mirrorHome({ windowsHome: path.dirname(home) }, path.join(path.dirname(home), '.antigravity-i18n'))).toBeNull();
  });
});

describe('設定檔', () => {
  it('set 寫入預設值；on / off 保留設定；clear 刪除', () => {
    const p = image();
    const r = setBackground(home, p, { ...NO_WSL, now: new Date(0) });
    expect(r.file).toBe(path.join(home, 'background.json'));
    expect(readBackgroundConfig(home)).toEqual({
      schemaVersion: 1,
      enabled: true,
      kind: 'image',
      imagePath: p,
      mime: 'image/png',
      ...BACKGROUND_DEFAULTS,
      updatedAt: new Date(0).toISOString(),
    });
    setBackground(home, p, { ...NO_WSL, opacity: '0.5', blur: '3', size: 'contain', position: 'top', mode: 'underlay' });
    setBackgroundEnabled(home, false, NO_WSL);
    expect(readBackgroundConfig(home)).toMatchObject({ enabled: false, opacity: 0.5, blur: 3, size: 'contain', position: 'top', mode: 'underlay' });
    setBackgroundEnabled(home, true, NO_WSL);
    expect(readBackgroundConfig(home)?.enabled).toBe(true);
    expect(clearBackground(home, NO_WSL)).toHaveLength(1);
    expect(readBackgroundConfig(home)).toBeNull();
    expect(() => setBackgroundEnabled(home, true, NO_WSL)).toThrow(/尚未設定背景圖/);
  });

  it('驗證失敗時不寫入設定檔', () => {
    expect(() => setBackground(home, image('x.txt'), NO_WSL)).toThrow();
    expect(() => setBackground(home, image(), { ...NO_WSL, opacity: '9' })).toThrow();
    expect(fs.existsSync(path.join(home, 'background.json'))).toBe(false);
  });

  it('status 回報圖片是否存在', () => {
    const p = image();
    setBackground(home, p, NO_WSL);
    expect(backgroundStatus(home, NO_WSL)).toMatchObject({ imageExists: true, imageSize: PNG.length });
    fs.rmSync(p);
    expect(backgroundStatus(home, NO_WSL).imageExists).toBe(false);
  });
});

describe('bg 指令', () => {
  let lines: string[];
  let prevHome: string | undefined;
  let prevWinHome: string | undefined;
  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ').replace(/\x1b\[[0-9;]*m/g, '')));
    prevHome = process.env.ANTIGRAVITY_I18N_HOME;
    prevWinHome = process.env.ANTIGRAVITY_I18N_WIN_HOME;
    process.env.ANTIGRAVITY_I18N_HOME = home;
    // 在 WSL 中執行測試時，鏡像設定檔改寫到暫存目錄，不碰使用者真實的 Windows 家目錄
    process.env.ANTIGRAVITY_I18N_WIN_HOME = path.posix.join('/', ...path.join(dir, 'winhome').split(path.sep).filter(Boolean));
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.ANTIGRAVITY_I18N_HOME;
    else process.env.ANTIGRAVITY_I18N_HOME = prevHome;
    if (prevWinHome === undefined) delete process.env.ANTIGRAVITY_I18N_WIN_HOME;
    else process.env.ANTIGRAVITY_I18N_WIN_HOME = prevWinHome;
  });

  const manifest = (runtime?: Manifest['runtime']): void => {
    const m: Manifest = {
      schemaVersion: 1,
      tool: 'antigravity-i18n',
      toolVersion: '0',
      target: 'app',
      lang: 'zh-TW',
      kind: 'asar',
      installRoot: '/opt/Antigravity',
      appliedAt: '',
      backupDir: '',
      files: [],
      stats: { totalKeys: 0, matchedKeys: 0, totalHits: 0, coverage: 0 },
      runtime,
    };
    writeManifest(manifestPathFor(home, { id: 'app', installRoot: m.installRoot }), m);
  };

  it('set / status / off / on / clear 的完整流程（遵守 ANTIGRAVITY_I18N_HOME）', async () => {
    const p = image();
    expect(await bgSetCommand(p, { opacity: '0.3', mode: 'underlay' })).toBe(0);
    expect(fs.existsSync(path.join(home, 'background.json'))).toBe(true);
    expect(lines.join('\n')).toContain('尚未對 App 套用中文化');

    lines.length = 0;
    expect(await bgStatusCommand()).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('背景圖：已啟用');
    expect(out).toContain(`圖片：${p}（存在`);
    expect(out).toContain('不透明度：0.3');
    expect(out).toContain('模式：underlay');

    expect(await bgToggleCommand(false)).toBe(0);
    lines.length = 0;
    await bgStatusCommand();
    expect(lines.join('\n')).toContain('已停用（設定保留）');
    expect(await bgToggleCommand(true)).toBe(0);
    expect(await bgClearCommand()).toBe(0);
    expect(fs.existsSync(path.join(home, 'background.json'))).toBe(false);
  });

  it('無效參數回報錯誤', async () => {
    await expect(bgSetCommand(image('x.gifv'), {})).rejects.toThrow(/不支援的圖片格式/);
    await expect(bgSetCommand(image(), { blur: '-3' })).rejects.toThrow(/--blur/);
  });

  it('hookHint：依 App 的套用狀態提示', () => {
    expect(hookHint(home)).toMatch(/尚未對 App 套用/);
    manifest(undefined);
    expect(hookHint(home)).toMatch(/--no-runtime/);
    manifest({ entries: 1, mainEntry: 'dist/main.js', runtimeFile: 'dist/x.js' });
    expect(hookHint(home)).toMatch(/舊版/);
    manifest({ entries: 1, mainEntry: 'dist/main.js', runtimeFile: 'dist/x.js', hookVersion: HOOK_VERSION });
    expect(hookHint(home)).toBeNull();
  });
});

describe('主行程：readBackgroundPayload', () => {
  const env = (): Record<string, string> => ({ ANTIGRAVITY_I18N_HOME: home });
  const read = (e = env(), platform = process.platform): BackgroundPayload | null =>
    readBackgroundPayload(fs, path, os, e, platform);

  it('讀取設定並轉成 data URL', () => {
    setBackground(home, image('w.webp'), { ...NO_WSL, opacity: '0.4', blur: '2', position: 'top left' });
    expect(read()).toEqual({
      kind: 'image',
      image: `url("data:image/webp;base64,${PNG.toString('base64')}")`,
      opacity: 0.4,
      blur: 2,
      size: 'cover',
      position: 'top left',
      mode: 'overlay',
    });
  });

  it('未設定、已停用、ANTIGRAVITY_I18N_NO_BG=1 時回傳 null', () => {
    expect(read()).toBeNull();
    setBackground(home, image(), NO_WSL);
    expect(read({ ...env(), ANTIGRAVITY_I18N_NO_BG: '1' })).toBeNull();
    setBackgroundEnabled(home, false, NO_WSL);
    expect(read()).toBeNull();
  });

  it('未設定 ANTIGRAVITY_I18N_HOME 時讀取 ~/.antigravity-i18n', () => {
    const fakeHome = path.join(dir, 'userhome');
    setBackground(path.join(fakeHome, '.antigravity-i18n'), image(), NO_WSL);
    expect(readBackgroundPayload(fs, path, { homedir: () => fakeHome }, {}, 'linux')?.mode).toBe('overlay');
  });

  it('Windows 主行程優先使用 windowsPath', () => {
    const real = image('real.png');
    write(path.join(home, 'background.json'), JSON.stringify({ enabled: true, imagePath: '/mnt/c/nope.png', windowsPath: real }));
    expect(read(env(), 'win32')?.image).toMatch(/^url\("data:image\/png;base64,/);
    expect(read(env(), 'linux')).toBeNull();
  });

  it('圖片遺失、格式錯誤、超過 10 MB、JSON 損壞時只警告並回傳 null', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cfg = (o: object): void => void write(path.join(home, 'background.json'), JSON.stringify({ enabled: true, ...o }));
    cfg({ imagePath: path.join(dir, 'missing.png') });
    expect(read()).toBeNull();
    cfg({ imagePath: image('a.svg') });
    expect(read()).toBeNull();
    cfg({ imagePath: sized('huge.png', MAX_IMAGE_BYTES + 1) });
    expect(read()).toBeNull();
    write(path.join(home, 'background.json'), '{ not json');
    expect(read()).toBeNull();
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('找不到圖片'),
      expect.stringContaining('不支援的圖片格式'),
      expect.stringContaining('超過 10 MB'),
      expect.stringContaining('無法解析'),
    ]);
  });

  it('手動編輯的設定檔會被重新驗證', () => {
    write(
      path.join(home, 'background.json'),
      JSON.stringify({ enabled: true, imagePath: image(), opacity: 50, blur: -4, size: 'fill', position: 'x;}*{display:none', mode: 'weird' }),
    );
    expect(read()).toMatchObject({ opacity: 1, blur: 0, size: 'cover', position: 'center', mode: 'overlay' });
  });

  it('圖片與設定都沒變時使用快取', () => {
    setBackground(home, image(), NO_WSL);
    const cache = {};
    const spy = vi.spyOn(fs, 'readFileSync');
    const a = readBackgroundPayload(fs, path, os, env(), 'linux', cache);
    const reads = spy.mock.calls.length;
    const b = readBackgroundPayload(fs, path, os, env(), 'linux', cache);
    expect(b).toBe(a);
    // 第二次只讀設定檔，不再讀圖片
    expect(spy.mock.calls.length - reads).toBe(1);
  });
});

describe('renderer：applyBackground（jsdom）', () => {
  const payload = (o: Partial<BackgroundPayload> = {}): BackgroundPayload => ({
    kind: 'image',
    image: `url("data:image/png;base64,${PNG.toString('base64')}")`,
    opacity: 0.12,
    blur: 0,
    size: 'cover',
    position: 'center',
    mode: 'overlay',
    ...o,
  });

  /** 以掛鉤實際使用的方式（序列化後執行）注入 */
  function inject(p: BackgroundPayload, html = '<div id="root"><button>Settings</button></div>'): Document {
    const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { runScripts: 'outside-only' });
    dom.window.eval(`(${applyBackground.toString()})(${JSON.stringify(p)});`);
    return dom.window.document;
  }

  it('overlay：注入樣式與不擋點擊的固定圖層', () => {
    const doc = inject(payload({ opacity: 0.3, blur: 5, size: 'contain', position: 'top right' }));
    const style = doc.getElementById('antigravity-i18n-bg-style')!;
    const layer = doc.getElementById('antigravity-i18n-bg')!;
    expect(style.tagName).toBe('STYLE');
    expect(style.parentElement?.tagName).toBe('HEAD');
    expect(layer.hasAttribute('data-antigravity-i18n-skip')).toBe(true);
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    const css = style.textContent!;
    for (const rule of [
      'position:fixed',
      // blur 5px → 向外延伸 10px，消除四邊虛邊
      'inset:-10px',
      'top:-10px',
      'left:-10px',
      'pointer-events:none',
      'z-index:99999',
      'opacity:0.3',
      'filter:blur(5px)',
      'background-size:contain',
      'background-position:top right',
      `url("data:image/png;base64,${PNG.toString('base64')}")`,
    ]) {
      expect(css).toContain(rule);
    }
    expect(css).not.toContain('transparent');
    // 圖層的計算樣式也確實不攔截滑鼠事件
    expect(doc.defaultView!.getComputedStyle(layer).pointerEvents).toBe('none');
  });

  it('underlay：位於介面底層並讓根背景透明', () => {
    const css = inject(payload({ mode: 'underlay' })).getElementById('antigravity-i18n-bg-style')!.textContent!;
    expect(css).toContain('z-index:-1');
    expect(css).toContain('html,body{background-color:transparent !important;}');
    expect(css).toContain('filter:none');
  });

  it('重複注入只保留一份；圖層被移除時自動補回', async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only' });
    const run = (p: BackgroundPayload): void => {
      dom.window.eval(`(${applyBackground.toString()})(${JSON.stringify(p)});`);
    };
    run(payload());
    run(payload({ opacity: 0.5 }));
    const doc = dom.window.document;
    expect(doc.querySelectorAll('#antigravity-i18n-bg')).toHaveLength(1);
    expect(doc.querySelectorAll('#antigravity-i18n-bg-style')).toHaveLength(1);
    expect(doc.getElementById('antigravity-i18n-bg-style')!.textContent).toContain('opacity:0.5');
    doc.body.innerHTML = '<main>re-rendered</main>';
    await new Promise((r) => setTimeout(r, 0));
    expect(doc.getElementById('antigravity-i18n-bg')).not.toBeNull();
  });

  it('不合法的 payload 不注入任何東西', () => {
    for (const bad of [
      { ...payload(), image: 'url("javascript:alert(1)")' },
      { ...payload(), image: 'url(https://evil.example/x.png)' },
      { ...payload(), kind: 'preset' as const, image: 'linear-gradient(red, blue);}*{display:none' },
      { ...payload(), kind: 'preset' as const, image: 'url("data:image/png;base64,AAAA")' },
    ]) {
      expect(inject(bad).getElementById('antigravity-i18n-bg')).toBeNull();
    }
  });

  it('與翻譯 runtime 共存：背景圖層被跳過，介面照常翻譯', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body><button id="b">Settings</button></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(buildRuntimeScript({ Settings: '設定' }, { lang: 'zh-TW', version: '0' }));
    dom.window.eval(`(${applyBackground.toString()})(${JSON.stringify(payload())});`);
    const doc = dom.window.document;
    expect(doc.getElementById('b')!.textContent).toBe('設定');
    expect(doc.getElementById('antigravity-i18n-bg')!.closest('[data-antigravity-i18n-skip]')).not.toBeNull();
  });
});

describe('主行程掛鉤：在模擬的 Electron 中載入背景圖', () => {
  type FakeWc = EventEmitter & { url: string; injected: string[] };
  let app: EventEmitter;
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    app = new EventEmitter();
    g.__fakeElectronApp = app;
    delete g.__ANTIGRAVITY_I18N_HOOK__;
    for (const k of ['ANTIGRAVITY_I18N_HOME', 'ANTIGRAVITY_I18N_NO_BG', 'ANTIGRAVITY_I18N_DISABLE']) saved[k] = process.env[k];
    process.env.ANTIGRAVITY_I18N_HOME = home;
    delete process.env.ANTIGRAVITY_I18N_NO_BG;
    delete process.env.ANTIGRAVITY_I18N_DISABLE;
  });
  afterEach(() => {
    delete g.__fakeElectronApp;
    delete g.__ANTIGRAVITY_I18N_HOOK__;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function loadMain(withRuntime = true): void {
    const appDir = path.join(dir, 'app');
    write(path.join(appDir, 'node_modules', 'electron', 'index.js'), 'module.exports = { app: globalThis.__fakeElectronApp };');
    if (withRuntime) write(path.join(appDir, 'dist', RUNTIME_FILE_NAME), '/* runtime */');
    const main = write(path.join(appDir, 'dist', 'main.js'), injectHook(`'use strict';\n`, 'cjs'));
    createRequire(main)(main);
  }

  const open = (url = 'file:///app/index.html'): FakeWc => {
    const wc = Object.assign(new EventEmitter(), { url, injected: [] as string[] }) as FakeWc;
    Object.assign(wc, {
      getType: () => 'window',
      getURL: () => wc.url,
      executeJavaScript: (code: string) => {
        wc.injected.push(code);
        return Promise.resolve();
      },
    });
    app.emit('web-contents-created', {}, wc);
    wc.emit('dom-ready');
    return wc;
  };

  it('dom-ready 時注入翻譯 runtime 與背景圖；換圖後下次載入即生效（不需重新打包）', () => {
    setBackground(home, image('a.png'), NO_WSL);
    loadMain();
    const wc = open();
    expect(wc.injected).toHaveLength(2);
    expect(wc.injected[0]).toBe('/* runtime */');
    expect(wc.injected[1]).toContain('antigravity-i18n-bg');
    expect(wc.injected[1]).toContain(`data:image/png;base64,${PNG.toString('base64')}`);

    const other = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);
    setBackground(home, image('b.png', other), { ...NO_WSL, opacity: '0.9' });
    wc.emit('dom-ready');
    expect(wc.injected[3]).toContain(other.toString('base64'));
    expect(wc.injected[3]).toContain('"opacity":0.9');
  });

  it('外部網站不注入背景圖', () => {
    setBackground(home, image(), NO_WSL);
    loadMain();
    expect(open('https://example.com/').injected).toEqual([]);
  });

  it('ANTIGRAVITY_I18N_NO_BG=1 時完全不注入背景與面板；bg off 時面板仍可用但沒有 CLI 背景', () => {
    setBackground(home, image(), NO_WSL);
    process.env.ANTIGRAVITY_I18N_NO_BG = '1';
    loadMain();
    expect(open().injected).toEqual(['/* runtime */']);
    delete process.env.ANTIGRAVITY_I18N_NO_BG;
    setBackgroundEnabled(home, false, NO_WSL);
    const off = open().injected;
    expect(off[0]).toBe('/* runtime */');
    expect(off).toHaveLength(2);
    expect(off[1]).toContain('__ANTIGRAVITY_I18N_PANEL__');
    expect(off[1]).toContain('"cli":null');
  });

  it('ANTIGRAVITY_I18N_NO_PANEL=1 時只套用 CLI 背景，不注入面板', () => {
    setBackground(home, image(), NO_WSL);
    process.env.ANTIGRAVITY_I18N_NO_PANEL = '1';
    try {
      loadMain();
      const js = open().injected;
      expect(js).toHaveLength(2);
      expect(js[1]).not.toContain('__ANTIGRAVITY_I18N_PANEL__');
      expect(js[1]).toContain(`data:image/png;base64,${PNG.toString('base64')}`);
    } finally {
      delete process.env.ANTIGRAVITY_I18N_NO_PANEL;
    }
  });

  it('背景設定損壞時只警告，翻譯 runtime 照常注入', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    write(path.join(home, 'background.json'), '{ broken');
    loadMain();
    const js = open().injected;
    expect(js[0]).toBe('/* runtime */');
    // 面板照常注入，但沒有 CLI 背景
    expect(js[1]).toContain('"cli":null');
    expect(warn).toHaveBeenCalled();
  });

  it('翻譯 runtime 遺失時背景圖仍可運作，且不影響 App 啟動', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setBackground(home, image(), NO_WSL);
    expect(() => loadMain(false)).not.toThrow();
    const wc = open();
    expect(wc.injected).toHaveLength(1);
    expect(wc.injected[0]).toContain('antigravity-i18n-bg');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('runtime not loaded'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 內建預設、可讀性遮罩、blur 邊緣修正、向下相容（HOOK_VERSION 3）
// ─────────────────────────────────────────────────────────────

const TINT_OK = [
  'rgba(0,0,0,0.25)',
  'rgba(0, 0, 0, .25)',
  'rgb(0 0 0 / 25%)',
  'rgb(255,255,255)',
  'hsl(220deg 50% 10% / 0.3)',
  'hsla(220, 50%, 10%, 0.3)',
  'hsl(0.5turn 40% 20%)',
  '#000',
  '#0008',
  '#00000040',
  '#1E1E1E',
  'transparent',
  'black',
  'WHITE',
];
const TINT_BAD = [
  'red;} body{display:none',
  'rgba(0,0,0,0.25);}*{display:none}',
  'rgba(0,0,0,0.25)) , url(x)',
  'url(https://evil.example/x.png)',
  'var(--x)',
  'expression(alert(1))',
  'rgb()',
  'rgba(0,0,0',
  'rgb(calc(1),0,0)',
  '#12345',
  '#ggg',
  'red',
  'blue !important',
  '"#000"',
  `rgba(${'1,'.repeat(40)}1)`,
];

describe('內建漸層預設', () => {
  it('至少 5 款，皆有中文名稱與說明', () => {
    expect(presetNames()).toEqual(expect.arrayContaining(['aurora', 'nebula', 'sunset', 'midnight', 'forest']));
    expect(presetNames().length).toBeGreaterThanOrEqual(5);
    expect(BACKGROUND_PRESETS.aurora!.label).toBe('極光');
    expect(BACKGROUND_PRESETS.nebula!.label).toBe('星雲');
    expect(BACKGROUND_PRESETS.sunset!.label).toBe('霓虹夕陽');
    expect(BACKGROUND_PRESETS.midnight!.label).toBe('深夜藍');
    expect(BACKGROUND_PRESETS.forest!.label).toBe('靜謐森林');
  });

  it.each(Object.entries(BACKGROUND_PRESETS))('%s：純 CSS 漸層、只含安全字元、無外部資源', (_name, p) => {
    expect(p.description.length).toBeGreaterThan(4);
    expect(p.image).toMatch(/^[A-Za-z0-9#%.,()\s-]+$/);
    expect(p.image).toMatch(/gradient\(/);
    expect(p.image).not.toMatch(/url\(|var\(|;|\{|\}|"|'/);
  });

  it('presetImages 與預設表一致', () => {
    expect(Object.keys(presetImages())).toEqual(presetNames());
    for (const [n, img] of Object.entries(presetImages())) expect(img).toBe(BACKGROUND_PRESETS[n]!.image);
  });

  it('setPreset 寫入同一份 background.json（不含圖片欄位）', () => {
    const r = setPreset(home, 'Aurora', { ...NO_WSL, opacity: '0.3', blur: '6', tint: 'rgba(0,0,0,0.25)', mode: 'underlay', now: new Date(0) });
    expect(r.file).toBe(path.join(home, 'background.json'));
    expect(readBackgroundConfig(home)).toEqual({
      schemaVersion: 1,
      enabled: true,
      kind: 'preset',
      preset: 'aurora',
      opacity: 0.3,
      blur: 6,
      size: 'cover',
      position: 'center',
      mode: 'underlay',
      tint: 'rgba(0,0,0,0.25)',
      updatedAt: new Date(0).toISOString(),
    });
    expect(backgroundStatus(home, NO_WSL)).toMatchObject({ presetKnown: true, imageExists: false });
  });

  it('未知的預設與無效參數會被拒絕，且不寫入設定檔', () => {
    expect(() => setPreset(home, 'rainbow', NO_WSL)).toThrow(/未知的預設「rainbow」.*aurora/);
    expect(() => setPreset(home, '__proto__', NO_WSL)).toThrow(/未知的預設/);
    expect(() => setPreset(home, 'aurora', { ...NO_WSL, opacity: '3' })).toThrow(/--opacity/);
    expect(() => setPreset(home, 'aurora', { ...NO_WSL, tint: 'red;}' })).toThrow(/--tint/);
    expect(fs.existsSync(path.join(home, 'background.json'))).toBe(false);
  });

  it('在圖片與預設之間切換', () => {
    setBackground(home, image(), NO_WSL);
    setPreset(home, 'forest', NO_WSL);
    const cfg = readBackgroundConfig(home)!;
    expect(cfg.kind).toBe('preset');
    expect(cfg.imagePath).toBeUndefined();
    setBackground(home, image(), NO_WSL);
    expect(readBackgroundConfig(home)).toMatchObject({ kind: 'image', imagePath: expect.any(String) });
    expect(readBackgroundConfig(home)!.preset).toBeUndefined();
  });

  it('WSL：預設同樣鏡像到 Windows 家目錄', () => {
    const wsl: WslContext = { distro: 'Ubuntu', windowsHome: path.join(dir, 'winhome') };
    const r = setPreset(home, 'nebula', { wsl });
    expect(r.mirror).toBeDefined();
    expect(fs.readFileSync(r.mirror!, 'utf8')).toBe(fs.readFileSync(r.file, 'utf8'));
    expect(JSON.parse(fs.readFileSync(r.mirror!, 'utf8')).preset).toBe('nebula');
  });
});

describe('可讀性遮罩 --tint', () => {
  it.each(TINT_OK)('接受：%s', (v) => {
    expect(parseTint(v)).toBe(v.trim());
  });

  it.each(TINT_BAD)('拒絕（防 CSS 注入）：%s', (v) => {
    expect(() => parseTint(v)).toThrow(/--tint/);
  });

  it('未提供或 none 表示不套用', () => {
    expect(parseTint(undefined)).toBeUndefined();
    expect(parseTint('none')).toBeUndefined();
    expect(parseTint(' NONE ')).toBeUndefined();
  });

  it('bg set --tint 寫入設定；--tint none 清除', () => {
    setBackground(home, image(), { ...NO_WSL, tint: '#00000040' });
    expect(readBackgroundConfig(home)!.tint).toBe('#00000040');
    setBackground(home, image(), { ...NO_WSL, tint: 'none' });
    expect('tint' in readBackgroundConfig(home)!).toBe(false);
  });

  it('CLI、主行程、renderer 三端的 tint 驗證規則一致', () => {
    const env = { ANTIGRAVITY_I18N_HOME: home };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const v of [...TINT_OK, ...TINT_BAD]) {
      let cli = true;
      try {
        parseTint(v);
      } catch {
        cli = false;
      }
      // 主行程：直接寫入（模擬手動編輯的設定檔）
      write(path.join(home, 'background.json'), JSON.stringify({ enabled: true, kind: 'preset', preset: 'midnight', tint: v }));
      const main = readBackgroundPayload(fs, path, os, env, 'linux', undefined, presetImages())?.tint === v;
      // renderer：直接收到含該 tint 的 payload
      const dom = new JSDOM('<html><head></head><body></body></html>', { runScripts: 'outside-only' });
      const payload = { kind: 'preset', image: BACKGROUND_PRESETS.midnight!.image, tint: v, opacity: 0.2, blur: 0, size: 'cover', position: 'center', mode: 'overlay' };
      dom.window.eval(`(${applyBackground.toString()})(${JSON.stringify(payload)});`);
      const renderer = dom.window.document.getElementById('antigravity-i18n-bg-style')!.textContent!.includes(`linear-gradient(${v}, ${v})`);
      expect([v, main, renderer]).toEqual([v, cli, cli]);
    }
    warn.mockRestore();
  });
});

describe('向下相容：PR #2 版本寫入的 background.json（沒有 kind 欄位）', () => {
  /** 與 PR #2 版本 setBackground() 輸出的格式完全相同 */
  const legacy = (imagePath: string): string =>
    `${JSON.stringify(
      {
        schemaVersion: 1,
        enabled: true,
        imagePath,
        mime: 'image/png',
        opacity: 0.2,
        blur: 4,
        size: 'contain',
        position: 'top right',
        mode: 'overlay',
        updatedAt: '2026-11-27T15:15:21.389Z',
      },
      null,
      2,
    )}\n`;

  it('CLI 讀取為圖片設定', () => {
    const p = image();
    write(path.join(home, 'background.json'), legacy(p));
    expect(readBackgroundConfig(home)).toMatchObject({ kind: 'image', imagePath: p, opacity: 0.2, blur: 4 });
    expect(backgroundStatus(home, NO_WSL)).toMatchObject({ imageExists: true });
  });

  it('主行程照常載入圖片，參數完全保留', () => {
    const p = image();
    write(path.join(home, 'background.json'), legacy(p));
    expect(readBackgroundPayload(fs, path, os, { ANTIGRAVITY_I18N_HOME: home }, 'linux', undefined, presetImages())).toEqual({
      kind: 'image',
      image: `url("data:image/png;base64,${PNG.toString('base64')}")`,
      opacity: 0.2,
      blur: 4,
      size: 'contain',
      position: 'top right',
      mode: 'overlay',
      tint: undefined,
    });
  });

  it('bg off / on 保留舊設定的所有欄位', () => {
    const p = image();
    write(path.join(home, 'background.json'), legacy(p));
    setBackgroundEnabled(home, false, NO_WSL);
    setBackgroundEnabled(home, true, NO_WSL);
    expect(readBackgroundConfig(home)).toMatchObject({ enabled: true, imagePath: p, size: 'contain', position: 'top right', blur: 4 });
  });
});

describe('主行程：預設與 tint', () => {
  const read = (presets: Record<string, string> | null = presetImages()): BackgroundPayload | null =>
    readBackgroundPayload(fs, path, os, { ANTIGRAVITY_I18N_HOME: home }, 'linux', undefined, presets ?? undefined);

  it('依名稱查內建漸層表', () => {
    setPreset(home, 'sunset', { ...NO_WSL, opacity: '0.25', tint: 'rgba(0,0,0,0.3)' });
    expect(read()).toEqual({
      kind: 'preset',
      image: BACKGROUND_PRESETS.sunset!.image,
      preset: 'sunset',
      tint: 'rgba(0,0,0,0.3)',
      opacity: 0.25,
      blur: 0,
      size: 'cover',
      position: 'center',
      mode: 'overlay',
    });
  });

  it('未知預設、或掛鉤內沒有預設表（舊版掛鉤）時只警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    write(path.join(home, 'background.json'), JSON.stringify({ enabled: true, kind: 'preset', preset: 'rainbow' }));
    expect(read()).toBeNull();
    setPreset(home, 'aurora', NO_WSL);
    expect(read(null)).toBeNull();
    write(path.join(home, 'background.json'), JSON.stringify({ enabled: true, kind: 'preset', preset: 'toString' }));
    expect(read()).toBeNull();
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('未知的預設「rainbow」'),
      expect.stringContaining('apply --force'),
      expect.stringContaining('未知的預設「toString」'),
    ]);
  });

  it('預設表被竄改成不安全的 CSS 時拒絕', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setPreset(home, 'aurora', NO_WSL);
    expect(read({ aurora: 'linear-gradient(red, blue);}*{display:none' })).toBeNull();
    expect(read({ aurora: 'url(https://evil.example/x.png)' })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('手動寫入不安全的 tint 時忽略遮罩，背景照常顯示', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    write(path.join(home, 'background.json'), JSON.stringify({ enabled: true, kind: 'preset', preset: 'forest', tint: 'red;}*{display:none' }));
    const p = read()!;
    expect(p.preset).toBe('forest');
    expect(p.tint).toBeUndefined();
    expect(String(warn.mock.calls[0]?.[0])).toContain('不安全的 tint');
  });
});

describe('renderer：預設、tint 與 blur 邊緣修正（jsdom）', () => {
  const run = (p: Partial<BackgroundPayload>): { doc: Document; css: string } => {
    const full = { kind: 'preset', image: BACKGROUND_PRESETS.aurora!.image, preset: 'aurora', opacity: 0.2, blur: 0, size: 'cover', position: 'center', mode: 'overlay', ...p };
    const dom = new JSDOM('<html><head></head><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(`(${applyBackground.toString()})(${JSON.stringify(full)});`);
    const doc = dom.window.document;
    return { doc, css: doc.getElementById('antigravity-i18n-bg-style')?.textContent ?? '' };
  };

  it('預設：注入漸層，圖層帶 data-preset 與保護屬性', () => {
    const { doc, css } = run({});
    const layer = doc.getElementById('antigravity-i18n-bg')!;
    expect(layer.getAttribute('data-preset')).toBe('aurora');
    expect(layer.hasAttribute('data-antigravity-i18n-skip')).toBe(true);
    expect(css).toContain(`background-image:${BACKGROUND_PRESETS.aurora!.image};`);
    expect(css).toContain('pointer-events:none');
    expect(css).not.toContain('url(');
  });

  it('tint：以單色漸層疊在背景之上，尺寸與位置一一對應', () => {
    const { css } = run({ tint: 'rgba(0,0,0,0.25)' });
    expect(css).toContain(`background-image:linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.25)), ${BACKGROUND_PRESETS.aurora!.image};`);
    expect(css).toContain('background-size:100% 100%, cover;');
    expect(css).toContain('background-position:center, center;');
  });

  it('沒有 tint 時不加遮罩層', () => {
    expect(run({}).css).not.toContain('100% 100%');
    // renderer 也會拒絕不安全的 tint，只顯示背景
    const { css } = run({ tint: 'red;}*{display:none' });
    expect(css).not.toContain('display:none');
    expect(css).toContain(`background-image:${BACKGROUND_PRESETS.aurora!.image};`);
  });

  it.each([
    [0, '0'],
    [1, '-2px'],
    [8, '-16px'],
    [100, '-200px'],
  ])('blur %ipx → 圖層向外延伸 %s，消除四邊虛邊', (blur, edge) => {
    const { css } = run({ blur });
    expect(css).toContain(`inset:${edge};top:${edge};right:${edge};bottom:${edge};left:${edge};`);
    expect(css).toContain(blur > 0 ? `filter:blur(${blur}px)` : 'filter:none');
  });

  it('blur 超過 100 時以 100 計算', () => {
    expect(run({ blur: 999 }).css).toContain('inset:-200px');
  });
});

describe('resolveWindowsHome：非 UTF-8 中文 Windows', () => {
  const pe = (users?: string[]) => ({ platform: 'linux' as const, home: '/home/u', env: {}, wslWindowsUsers: users });

  it('先切換 UTF-8 codepage 再查詢 %USERPROFILE%', () => {
    const calls: string[][] = [];
    const out = resolveWindowsHome(
      pe(),
      (cmd, args) => {
        calls.push([cmd, ...args]);
        return 'C:\\Users\\王小明\r\n';
      },
      (p) => p === '/mnt/c/Users/王小明',
    );
    expect(calls).toEqual([['cmd.exe', '/d', '/c', 'chcp 65001 >nul & echo %USERPROFILE%']]);
    expect(out).toBe('/mnt/c/Users/王小明');
  });

  it('轉換後的目錄不存在（例如亂碼）時不採用，改用唯一使用者', () => {
    const garbled = (): string => 'C:\\Users\\���p��\r\n';
    expect(resolveWindowsHome(pe(['王小明']), garbled, () => false)).toBe('/mnt/c/Users/王小明');
    expect(resolveWindowsHome(pe(['A', 'B']), garbled, () => false)).toBeNull();
  });
});

describe('bg preset / presets 指令與掛鉤升級提示', () => {
  let lines: string[];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ').replace(/\x1b\[[0-9;]*m/g, '')));
    for (const k of ['ANTIGRAVITY_I18N_HOME', 'ANTIGRAVITY_I18N_WIN_HOME']) saved[k] = process.env[k];
    process.env.ANTIGRAVITY_I18N_HOME = home;
    process.env.ANTIGRAVITY_I18N_WIN_HOME = path.posix.join('/', ...path.join(dir, 'winhome').split(path.sep).filter(Boolean));
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('bg presets 列出所有預設與中文說明', async () => {
    expect(await bgPresetsCommand()).toBe(0);
    const out = lines.join('\n');
    for (const [name, p] of Object.entries(BACKGROUND_PRESETS)) {
      expect(out).toContain(name);
      expect(out).toContain(p.label);
      expect(out).toContain(p.description);
    }
  });

  it('bg preset 寫入設定，bg status 顯示預設與遮罩', async () => {
    expect(await bgPresetCommand('midnight', { opacity: '0.18', tint: '#00000040', mode: 'overlay' })).toBe(0);
    expect(lines.join('\n')).toContain('已套用背景預設：midnight（深夜藍）');
    lines.length = 0;
    await bgStatusCommand();
    const out = lines.join('\n');
    expect(out).toContain('預設：midnight（深夜藍）');
    expect(out).toContain('遮罩：#00000040');
    expect(out).not.toContain('圖片：');
    await expect(bgPresetCommand('nope', {})).rejects.toThrow(/未知的預設/);
  });

  it('v2 掛鉤提示升級以支援預設與遮罩', () => {
    const m: Manifest = {
      schemaVersion: 1,
      tool: 'antigravity-i18n',
      toolVersion: '0',
      target: 'app',
      lang: 'zh-TW',
      kind: 'asar',
      installRoot: '/opt/Antigravity',
      appliedAt: '',
      backupDir: '',
      files: [],
      stats: { totalKeys: 0, matchedKeys: 0, totalHits: 0, coverage: 0 },
      runtime: { entries: 1, mainEntry: 'dist/main.js', runtimeFile: 'dist/x.js', hookVersion: 2 },
    };
    writeManifest(manifestPathFor(home, { id: 'app', installRoot: m.installRoot }), m);
    expect(HOOK_VERSION).toBe(5);
    expect(hookHint(home)).toMatch(/v2.*v5.*bg preset.*--tint.*Ctrl\+Alt\+B.*--force/);
    // v4 只缺少「掃描未翻譯英文」工具
    writeManifest(manifestPathFor(home, { id: 'app', installRoot: m.installRoot }), { ...m, runtime: { ...m.runtime!, hookVersion: 4 } });
    expect(hookHint(home)).toMatch(/v4.*v5.*掃描未翻譯英文.*--force/);
  });
});

describe('上傳圖片的格式判斷', () => {
  it('以魔術位元組辨識 PNG / JPEG / GIF / WebP', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ ext: 'png', mime: 'image/png' });
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    expect(sniffImage(Buffer.from('GIF89a....', 'latin1'))).toEqual({ ext: 'gif', mime: 'image/gif' });
    expect(sniffImage(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toEqual({ ext: 'webp', mime: 'image/webp' });
  });

  it('其他內容一律拒絕', () => {
    for (const bad of ['<svg/>', 'GIF90a', 'RIFF0000WAVE', '\x89PNG', '']) expect(sniffImage(Buffer.from(bad, 'latin1'))).toBeNull();
  });
});
