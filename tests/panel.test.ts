import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPreset } from '../src/core/background.js';
import { BACKGROUND_PRESETS, presetMeta } from '../src/core/presets.js';
import { HOOK_VERSION, PANEL_MAX_BYTES, RUNTIME_FILE_NAME, buildRuntimeScript, injectHook } from '../src/core/runtime.js';
import { applyBackground, type BackgroundPayload } from '../src/runtime/background.js';
import { I18N_DISABLED_KEY, type OverlayHandle } from '../src/runtime/overlay.js';
import { antigravityI18nPanel, type PanelHandle } from '../src/runtime/panel.js';
import { rm, tmpDir, write } from './helpers.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const CLI_IMAGE: BackgroundPayload = {
  kind: 'image',
  image: `url("data:image/png;base64,${PNG.toString('base64')}")`,
  opacity: 0.3,
  blur: 0,
  size: 'cover',
  position: 'center',
  mode: 'overlay',
};

/** 與主行程掛鉤相同的組合方式 */
function panelScript(cli: BackgroundPayload | null, maxBytes = PANEL_MAX_BYTES): string {
  const cfg = { cli, presets: presetMeta(), maxBytes, version: HOOK_VERSION };
  return `(function(){var applyBackground=${applyBackground.toString()};(${antigravityI18nPanel.toString()})(applyBackground,${JSON.stringify(cfg)});})();`;
}

type Win = JSDOM['window'] & { __ANTIGRAVITY_I18N_PANEL__: PanelHandle; __ANTIGRAVITY_I18N__?: OverlayHandle; indexedDB?: IDBFactory };

interface Booted {
  win: Win;
  doc: Document;
  panel: PanelHandle;
  $: (sel: string) => HTMLElement;
  css: () => string;
}

async function boot(opts: { cli?: BackgroundPayload | null; idb?: IDBFactory; html?: string; url?: string; i18n?: boolean } = {}): Promise<Booted> {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${opts.html ?? '<main id="app"><button id="btn">Settings</button></main>'}</body></html>`, {
    runScripts: 'outside-only',
    url: opts.url ?? 'http://localhost:5173/',
  });
  const win = dom.window as unknown as Win;
  if (opts.idb) win.indexedDB = opts.idb;
  if (opts.i18n) win.eval(buildRuntimeScript({ Settings: '設定', Appearance: '外觀' }, { lang: 'zh-TW', version: '0' }));
  win.eval(panelScript(opts.cli === undefined ? null : opts.cli));
  const panel = win.__ANTIGRAVITY_I18N_PANEL__;
  await panel.ready;
  const doc = win.document;
  const $ = (sel: string): HTMLElement => {
    const el = doc.querySelector(sel);
    if (!el) throw new Error(`not found: ${sel}`);
    return el as HTMLElement;
  };
  return { win, doc, panel, $, css: () => doc.getElementById('antigravity-i18n-bg-style')?.textContent ?? '' };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function key(b: Booted, init: KeyboardEventInit): void {
  b.doc.body.dispatchEvent(new b.win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}
const ctrlAltB = { key: 'b', code: 'KeyB', ctrlKey: true, altKey: true };

function setValue(b: Booted, sel: string, value: string, type: 'input' | 'change'): void {
  const el = b.$(sel) as HTMLInputElement | HTMLSelectElement;
  el.value = value;
  el.dispatchEvent(new b.win.Event(type, { bubbles: true }));
}

function chooseFile(b: Booted, file: unknown): void {
  const input = b.$('[data-agi18n="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new b.win.Event('change', { bubbles: true }));
}

const msg = (b: Booted): string => b.$('[data-agi18n="msg"]').textContent ?? '';

afterEach(() => vi.restoreAllMocks());

describe('序列化', () => {
  it('面板腳本自足、零依賴，在沒有 DOM 的環境也不會拋錯', () => {
    const js = panelScript(null);
    expect(js).not.toMatch(/\brequire\(|\bimport\s|__vite|__name\(/);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => vm.runInNewContext(js, { console })).not.toThrow();
    warn.mockRestore();
  });

  it('overlay 的停用旗標名稱與面板一致', () => {
    expect(I18N_DISABLED_KEY).toBe('antigravity-i18n:i18n-disabled');
    // 兩個函式都會被序列化，無法共用常數，只能各寫一份：確認字串完全相同
    expect(antigravityI18nPanel.toString()).toContain(I18N_DISABLED_KEY);
    expect(buildRuntimeScript({}, { lang: 'zh-TW', version: '0' })).toContain(I18N_DISABLED_KEY);
  });
});

describe('開關面板', () => {
  it('預設關閉；具備 data-antigravity-i18n-skip，不被翻譯 runtime 掃描', async () => {
    const b = await boot({ i18n: true });
    const p = b.$('#antigravity-i18n-panel');
    expect(p.hidden).toBe(true);
    expect(p.hasAttribute('data-antigravity-i18n-skip')).toBe(true);
    expect(b.$('#antigravity-i18n-bg-launcher').hasAttribute('data-antigravity-i18n-skip')).toBe(true);
    expect(p.getAttribute('role')).toBe('dialog');
    // 介面本身照常翻譯
    expect(b.$('#btn').textContent).toBe('設定');
  });

  it('Ctrl+Alt+B 開關、macOS Cmd+Option+B、Esc 關閉', async () => {
    const b = await boot();
    const p = b.$('#antigravity-i18n-panel');
    key(b, ctrlAltB);
    expect(p.hidden).toBe(false);
    expect(b.panel.isOpen).toBe(true);
    key(b, ctrlAltB);
    expect(p.hidden).toBe(true);
    // macOS：Option+B 會輸出「∫」，以 code 判斷
    key(b, { key: '∫', code: 'KeyB', metaKey: true, altKey: true });
    expect(p.hidden).toBe(false);
    key(b, { key: 'Escape', code: 'Escape' });
    expect(p.hidden).toBe(true);
  });

  it('其他組合鍵不會觸發；面板關閉時 Esc 不攔截', async () => {
    const b = await boot();
    const p = b.$('#antigravity-i18n-panel');
    key(b, { key: 'b', code: 'KeyB', ctrlKey: true });
    key(b, { key: 'B', code: 'KeyB', ctrlKey: true, altKey: true, shiftKey: true });
    key(b, { key: 'b', code: 'KeyB', altKey: true });
    expect(p.hidden).toBe(true);
    const esc = new b.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    b.doc.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
  });

  it('點面板外關閉，點面板內不關閉；關閉按鈕', async () => {
    const b = await boot();
    const p = b.$('#antigravity-i18n-panel');
    b.panel.open();
    b.$('[data-agi18n="opacity"]').dispatchEvent(new b.win.MouseEvent('mousedown', { bubbles: true }));
    expect(p.hidden).toBe(false);
    b.$('#btn').dispatchEvent(new b.win.MouseEvent('mousedown', { bubbles: true }));
    expect(p.hidden).toBe(true);
    b.panel.open();
    (b.$('[data-agi18n="close"]') as HTMLButtonElement).click();
    expect(p.hidden).toBe(true);
  });
});

describe('即時操作（0 秒生效）', () => {
  it('一鍵切換 5 款內建預設', async () => {
    const b = await boot();
    const buttons = b.doc.querySelectorAll('[data-agi18n-preset]');
    expect([...buttons].map((x) => x.textContent)).toEqual(['極光', '星雲', '霓虹夕陽', '深夜藍', '靜謐森林']);
    for (const [name, p] of Object.entries(BACKGROUND_PRESETS)) {
      (b.$(`[data-agi18n-preset="${name}"]`) as HTMLButtonElement).click();
      expect(b.css()).toContain(`background-image:${p.image};`);
      expect(b.$('#antigravity-i18n-bg').getAttribute('data-preset')).toBe(name);
      expect(b.$(`[data-agi18n-preset="${name}"]`).getAttribute('aria-pressed')).toBe('true');
    }
    expect(b.doc.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  });

  it('拉桿與選單即時更新 #antigravity-i18n-bg-style', async () => {
    const b = await boot({ cli: CLI_IMAGE });
    setValue(b, '[data-agi18n="opacity"]', '0.55', 'input');
    expect(b.css()).toContain('opacity:0.55;');
    expect(b.$('[data-agi18n-value="opacity"]').textContent).toBe('0.55');
    setValue(b, '[data-agi18n="blur"]', '8', 'input');
    expect(b.css()).toContain('filter:blur(8px);');
    expect(b.css()).toContain('inset:-16px;');
    setValue(b, '[data-agi18n="position"]', 'top', 'change');
    expect(b.css()).toContain('background-position:top;');
    setValue(b, '[data-agi18n="size"]', 'contain', 'change');
    expect(b.css()).toContain('background-size:contain;');
    setValue(b, '[data-agi18n="tint"]', 'rgba(0,0,0,0.45)', 'change');
    expect(b.css()).toContain('linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url("data:image/png;base64,');
    setValue(b, '[data-agi18n="mode"]', 'underlay', 'change');
    expect(b.css()).toContain('z-index:-1;');
    // 調整參數時沿用 CLI 的圖片
    expect(b.panel.settings()).toMatchObject({ source: 'cli', opacity: 0.55, blur: 8, position: 'top', size: 'contain', mode: 'underlay' });
  });

  it('拉桿範圍：不透明度 0.01 ~ 1、模糊 0 ~ 32px', async () => {
    const b = await boot();
    const op = b.$('[data-agi18n="opacity"]') as HTMLInputElement;
    const bl = b.$('[data-agi18n="blur"]') as HTMLInputElement;
    expect([op.min, op.max, op.step]).toEqual(['0.01', '1', '0.01']);
    expect([bl.min, bl.max]).toEqual(['0', '32']);
    const tints = [...(b.$('[data-agi18n="tint"]') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(tints).toEqual(['無', '暗色 25%', '深暗 45%', '深藍 35%']);
    const positions = [...(b.$('[data-agi18n="position"]') as HTMLSelectElement).options].map((o) => o.value);
    expect(positions).toEqual(['center', 'top', 'bottom', 'left', 'right']);
  });

  it('啟用／停用背景開關', async () => {
    const b = await boot({ cli: CLI_IMAGE });
    expect(b.doc.getElementById('antigravity-i18n-bg')).not.toBeNull();
    const box = b.$('[data-agi18n="enabled"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new b.win.Event('change'));
    expect(b.doc.getElementById('antigravity-i18n-bg')).toBeNull();
    box.checked = true;
    box.dispatchEvent(new b.win.Event('change'));
    expect(b.doc.getElementById('antigravity-i18n-bg')).not.toBeNull();
  });

  it('本機選圖：讀成 data URL 並立即套用', async () => {
    const b = await boot();
    chooseFile(b, new b.win.File([PNG], 'wall.png', { type: 'image/png' }));
    await sleep(30);
    expect(b.css()).toContain(`url("data:image/png;base64,${PNG.toString('base64')}")`);
    expect(b.panel.settings()).toMatchObject({ source: 'image', enabled: true });
    expect(msg(b)).toContain('wall.png');
    expect((b.$('[data-agi18n="file"]') as HTMLInputElement).accept).toBe('image/png,image/jpeg,image/webp,image/gif');
  });

  it('超過 10 MB 的圖片以中文提示並拒絕', async () => {
    const b = await boot({ cli: CLI_IMAGE });
    const before = b.css();
    chooseFile(b, { name: 'huge.png', type: 'image/png', size: PANEL_MAX_BYTES + 1 });
    await sleep(10);
    expect(msg(b)).toMatch(/超過上限 10 MB/);
    expect(b.$('[data-agi18n="msg"]').hasAttribute('data-warn')).toBe(true);
    expect(b.css()).toBe(before);
    expect(b.panel.settings()).toBeNull();
  });

  it('剛好 10 MB 可以；不支援的格式拒絕', async () => {
    const b = await boot();
    chooseFile(b, { name: 'x.svg', type: 'image/svg+xml', size: 100 });
    expect(msg(b)).toContain('只支援 PNG、JPEG、WebP、GIF');
    // 剛好 10 MB 不會被大小檢查擋下（以真實 File 驗證會通過大小檢查並開始讀取）
    const big = new b.win.File([new Uint8Array(PANEL_MAX_BYTES)], 'max.png', { type: 'image/png' });
    chooseFile(b, big);
    expect(msg(b)).not.toMatch(/超過上限/);
  });
});

describe('持久化（IndexedDB）', () => {
  it('介面設定存進 IndexedDB，重開後自動套用，且優先於 CLI 設定', async () => {
    const idb = new IDBFactory();
    const a = await boot({ idb, cli: CLI_IMAGE });
    expect(a.panel.persistent).toBe(true);
    (a.$('[data-agi18n-preset="nebula"]') as HTMLButtonElement).click();
    setValue(a, '[data-agi18n="opacity"]', '0.4', 'input');
    setValue(a, '[data-agi18n="tint"]', 'rgba(10,25,60,0.35)', 'change');
    await sleep(250);

    // 「重開 Antigravity」：新視窗、同一份 IndexedDB
    const b = await boot({ idb, cli: CLI_IMAGE });
    expect(b.$('#antigravity-i18n-bg').getAttribute('data-preset')).toBe('nebula');
    expect(b.css()).toContain('opacity:0.4;');
    expect(b.css()).toContain('linear-gradient(rgba(10,25,60,0.35), rgba(10,25,60,0.35))');
    expect(b.css()).not.toContain('url(');
    expect(b.panel.settings()).toMatchObject({ source: 'preset', preset: 'nebula', opacity: 0.4 });
  });

  it('介面選的圖片也會保存（不受 localStorage 5MB 限制）', async () => {
    const idb = new IDBFactory();
    const a = await boot({ idb });
    chooseFile(a, new a.win.File([PNG], 'saved.png', { type: 'image/png' }));
    await sleep(250);
    const b = await boot({ idb });
    expect(b.css()).toContain(`url("data:image/png;base64,${PNG.toString('base64')}")`);
  });

  it('重設：清除介面設定，改回 CLI 設定；沒有 CLI 設定時關閉背景', async () => {
    const idb = new IDBFactory();
    const a = await boot({ idb, cli: CLI_IMAGE });
    (a.$('[data-agi18n-preset="forest"]') as HTMLButtonElement).click();
    await sleep(250);
    (a.$('[data-agi18n="reset"]') as HTMLButtonElement).click();
    expect(a.css()).toContain('url("data:image/png;base64,');
    expect(a.css()).toContain('opacity:0.3;');
    expect(msg(a)).toContain('已改回 CLI 設定');
    await sleep(50);
    const b = await boot({ idb, cli: CLI_IMAGE });
    expect(b.panel.settings()).toBeNull();
    expect(b.css()).toContain('url("data:image/png;base64,');

    const c = await boot({ idb, cli: null });
    (c.$('[data-agi18n-preset="aurora"]') as HTMLButtonElement).click();
    (c.$('[data-agi18n="reset"]') as HTMLButtonElement).click();
    expect(c.doc.getElementById('antigravity-i18n-bg')).toBeNull();
    expect(msg(c)).toContain('背景已關閉');
  });

  it('IndexedDB 內被竄改的資料不會被套用', async () => {
    const idb = new IDBFactory();
    await boot({ idb });
    const put = (value: unknown): Promise<void> =>
      new Promise((resolve, reject) => {
        const req = idb.open('antigravity-i18n', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('settings', 'readwrite');
          tx.objectStore('settings').put(value, 'background');
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

    await put({ enabled: true, source: 'image', dataUrl: 'javascript:alert(1)' });
    expect((await boot({ idb, cli: CLI_IMAGE })).panel.settings()).toBeNull();

    await put({ enabled: true, source: 'preset', preset: '__proto__' });
    expect((await boot({ idb, cli: null })).doc.getElementById('antigravity-i18n-bg')).toBeNull();

    await put({ enabled: true, source: 'preset', preset: 'midnight', tint: 'red;}*{display:none', opacity: 99, blur: -5, mode: 'evil', position: 'x;y' });
    const b = await boot({ idb });
    expect(b.panel.settings()).toMatchObject({ tint: '', opacity: 1, blur: 0, mode: 'overlay', position: 'center' });
    expect(b.css()).not.toContain('display:none');
  });

  it('沒有 IndexedDB 時安全降級為「僅目前視窗生效」並提示', async () => {
    const b = await boot({ cli: CLI_IMAGE });
    expect(b.panel.persistent).toBe(false);
    expect(msg(b)).toContain('無法使用 IndexedDB');
    expect(b.css()).toContain('url("data:image/png;base64,');
    (b.$('[data-agi18n-preset="sunset"]') as HTMLButtonElement).click();
    expect(b.$('#antigravity-i18n-bg').getAttribute('data-preset')).toBe('sunset');
    expect(msg(b)).toContain('只在目前視窗生效');
  });

  it('IndexedDB 開啟失敗或拋錯時同樣降級，不影響背景', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const throwing = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const b = await boot({ idb: throwing, cli: CLI_IMAGE });
    expect(b.panel.persistent).toBe(false);
    expect(b.doc.getElementById('antigravity-i18n-bg')).not.toBeNull();

    const failing = {
      open: () => {
        const req: Record<string, unknown> = {};
        setTimeout(() => (req.onerror as () => void)?.(), 0);
        return req;
      },
    } as unknown as IDBFactory;
    const c = await boot({ idb: failing });
    expect(c.panel.persistent).toBe(false);
    warn.mockRestore();
  });
});

describe('CLI 設定', () => {
  it('沒有介面設定時套用 CLI 設定（含自訂 tint）；沒有 CLI 設定時不顯示背景', async () => {
    const b = await boot({ cli: { ...CLI_IMAGE, tint: '#11223344' } });
    expect(b.css()).toContain('linear-gradient(#11223344, #11223344)');
    const c = await boot({ cli: null });
    expect(c.doc.getElementById('antigravity-i18n-bg')).toBeNull();
  });

  it('重複注入只安裝一次，並更新 CLI 設定', async () => {
    const b = await boot({ cli: null });
    b.win.eval(panelScript(CLI_IMAGE));
    expect(b.doc.querySelectorAll('#antigravity-i18n-panel')).toHaveLength(1);
    expect(b.css()).toContain('url("data:image/png;base64,');
  });
});

describe('「設定 → 外觀」頁面的小按鈕', () => {
  it.each([
    ['英文標題', '<h2>Appearance</h2>'],
    ['翻譯後（繁中）', '<h1>外觀</h1>'],
    ['翻譯後（簡中）', '<div role="heading">外观</div>'],
    ['側邊欄選取狀態', '<nav><a aria-current="page">Appearance</a></nav>'],
  ])('%s：出現時顯示，離開即隱藏', async (_name, html) => {
    const b = await boot();
    const launcher = b.$('#antigravity-i18n-bg-launcher');
    expect(launcher.hidden).toBe(true);
    const page = b.doc.createElement('section');
    page.innerHTML = html;
    b.$('#app').appendChild(page);
    await sleep(320);
    expect(launcher.hidden).toBe(false);
    launcher.click();
    expect(b.panel.isOpen).toBe(true);
    page.remove();
    await sleep(320);
    expect(launcher.hidden).toBe(true);
  });

  it('一般對話頁或只是文字中提到 Appearance 時不顯示', async () => {
    const b = await boot({ html: '<main id="app"><p>Change the Appearance in settings</p><span>Appearance</span></main>' });
    await sleep(320);
    expect(b.$('#antigravity-i18n-bg-launcher').hidden).toBe(true);
  });
});

describe('中／英文切換', () => {
  it('停用翻譯：記住選擇並提示重新整理才會恢復原文；重新啟用立即翻譯', async () => {
    const b = await boot({ i18n: true });
    const box = b.$('[data-agi18n="i18n"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);

    box.checked = false;
    box.dispatchEvent(new b.win.Event('change'));
    expect(b.win.localStorage.getItem(I18N_DISABLED_KEY)).toBe('1');
    expect(b.win.__ANTIGRAVITY_I18N__!.enabled).toBe(false);
    expect(msg(b)).toContain('重新整理頁面');
    const added = b.doc.createElement('button');
    added.textContent = 'Settings';
    b.$('#app').appendChild(added);
    await sleep(0);
    expect(added.textContent).toBe('Settings');

    box.checked = true;
    box.dispatchEvent(new b.win.Event('change'));
    expect(b.win.localStorage.getItem(I18N_DISABLED_KEY)).toBeNull();
    expect(added.textContent).toBe('設定');
    expect(msg(b)).toContain('已重新啟用');
  });

  it('停用狀態下重新整理：頁面維持英文原文', async () => {
    const dom = new JSDOM('<!doctype html><html><body><button id="b">Settings</button></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
    dom.window.localStorage.setItem(I18N_DISABLED_KEY, '1');
    dom.window.eval(buildRuntimeScript({ Settings: '設定' }, { lang: 'zh-TW', version: '0' }));
    expect(dom.window.document.getElementById('b')!.textContent).toBe('Settings');
    const handle = (dom.window as unknown as { __ANTIGRAVITY_I18N__: OverlayHandle }).__ANTIGRAVITY_I18N__;
    expect(handle.enabled).toBe(false);
    handle.resume();
    expect(dom.window.document.getElementById('b')!.textContent).toBe('設定');
  });

  it('沒有翻譯 runtime 時開關停用', async () => {
    const b = await boot();
    expect((b.$('[data-agi18n="i18n"]') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('端對端：模擬 Electron 掛鉤注入面板', () => {
  let dir: string;
  let app: EventEmitter;
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = tmpDir();
    app = new EventEmitter();
    g.__fakeElectronApp = app;
    delete g.__ANTIGRAVITY_I18N_HOOK__;
    for (const k of ['ANTIGRAVITY_I18N_HOME', 'ANTIGRAVITY_I18N_NO_BG', 'ANTIGRAVITY_I18N_NO_PANEL']) saved[k] = process.env[k];
    process.env.ANTIGRAVITY_I18N_HOME = path.join(dir, 'tool-home');
    delete process.env.ANTIGRAVITY_I18N_NO_BG;
    delete process.env.ANTIGRAVITY_I18N_NO_PANEL;
  });
  afterEach(() => {
    rm(dir);
    delete g.__fakeElectronApp;
    delete g.__ANTIGRAVITY_I18N_HOOK__;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function loadHook(): string[] {
    const appDir = path.join(dir, 'app');
    write(path.join(appDir, 'node_modules', 'electron', 'index.js'), 'module.exports = { app: globalThis.__fakeElectronApp };');
    write(path.join(appDir, 'dist', RUNTIME_FILE_NAME), buildRuntimeScript({ Settings: '設定' }, { lang: 'zh-TW', version: '0' }));
    const main = write(path.join(appDir, 'dist', 'main.js'), injectHook(`'use strict';\n`, 'cjs'));
    createRequire(main)(main);
    const injected: string[] = [];
    const wc = Object.assign(new EventEmitter(), {
      getType: () => 'window',
      getURL: () => 'file:///app/index.html',
      executeJavaScript: (code: string) => {
        injected.push(code);
        return Promise.resolve();
      },
    });
    app.emit('web-contents-created', {}, wc);
    wc.emit('dom-ready');
    return injected;
  }

  it('注入的腳本在頁面中提供完整面板：CLI 預設 → Ctrl+Alt+B → 換預設 → 拉桿', async () => {
    setPreset(process.env.ANTIGRAVITY_I18N_HOME!, 'midnight', { wsl: null, opacity: '0.2' });
    const injected = loadHook();
    expect(injected).toHaveLength(2);
    expect(injected[1]).toContain('__ANTIGRAVITY_I18N_PANEL__');

    const dom = new JSDOM('<!doctype html><html><head></head><body><button id="b">Settings</button></body></html>', { runScripts: 'outside-only' });
    for (const js of injected) dom.window.eval(js);
    const win = dom.window as unknown as Win;
    await win.__ANTIGRAVITY_I18N_PANEL__.ready;
    const doc = win.document;
    const css = (): string => doc.getElementById('antigravity-i18n-bg-style')!.textContent!;
    expect(doc.getElementById('b')!.textContent).toBe('設定');
    expect(doc.getElementById('antigravity-i18n-bg')!.getAttribute('data-preset')).toBe('midnight');
    expect(css()).toContain('opacity:0.2;');

    doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { ...ctrlAltB, bubbles: true }));
    expect((doc.getElementById('antigravity-i18n-panel') as HTMLElement).hidden).toBe(false);
    (doc.querySelector('[data-agi18n-preset="aurora"]') as HTMLButtonElement).click();
    expect(css()).toContain(`background-image:${BACKGROUND_PRESETS.aurora!.image};`);
    const op = doc.querySelector('[data-agi18n="opacity"]') as HTMLInputElement;
    op.value = '0.66';
    op.dispatchEvent(new win.Event('input'));
    expect(css()).toContain('opacity:0.66;');
  });

  it('沒有任何 CLI 背景設定時也注入面板，讓使用者在介面中設定', async () => {
    const injected = loadHook();
    expect(injected[1]).toContain('"cli":null');
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only' });
    for (const js of injected) dom.window.eval(js);
    const win = dom.window as unknown as Win;
    await win.__ANTIGRAVITY_I18N_PANEL__.ready;
    expect(win.document.getElementById('antigravity-i18n-bg')).toBeNull();
    (win.document.querySelector('[data-agi18n-preset="forest"]') as HTMLButtonElement).click();
    expect(win.document.getElementById('antigravity-i18n-bg')!.getAttribute('data-preset')).toBe('forest');
  });
});
