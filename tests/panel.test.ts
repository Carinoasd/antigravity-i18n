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
import { I18N_DISABLED_KEY, I18N_LANG_KEY, antigravityI18nOverlay, type OverlayHandle } from '../src/runtime/overlay.js';
import { MISSING_TRANSLATION_URL, SCAN_MAX_LEN, antigravityI18nPanel, type PanelHandle } from '../src/runtime/panel.js';
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
        // 不指定版本：開啟面板升級後的目前版本（v2）
        const req = idb.open('antigravity-i18n');
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
    ['翻譯後（日文）', '<h1>外観</h1>'],
    ['翻譯後（韓文）', '<h1>모양</h1>'],
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

describe('介面語言：五語即時切換', () => {
  /** 四語 runtime（與 apply 產生的格式相同） */
  const FOUR = {
    'zh-CN': { Settings: '设置', Appearance: '外观' },
    ja: { Settings: '設定', Appearance: '外観' },
    ko: { Settings: '설정', Appearance: '모양' },
  };

  async function bootFour(opts: { pre?: (win: Win) => void; html?: string } = {}): Promise<Booted> {
    const dom = new JSDOM(`<!doctype html><html><head></head><body>${opts.html ?? '<main id="app"><button id="btn">Settings</button></main>'}</body></html>`, {
      runScripts: 'outside-only',
      url: 'http://localhost:5173/',
    });
    const win = dom.window as unknown as Win;
    opts.pre?.(win);
    win.eval(buildRuntimeScript({ Settings: '設定', Appearance: '外觀' }, { lang: 'zh-TW', version: '0' }, FOUR));
    win.eval(panelScript(null));
    const panel = win.__ANTIGRAVITY_I18N_PANEL__;
    await panel.ready;
    const doc = win.document;
    const $ = (sel: string): HTMLElement => {
      const el = doc.querySelector(sel);
      if (!el) throw new Error(`not found: ${sel}`);
      return el as HTMLElement;
    };
    return { win, doc, panel, $, css: () => '' };
  }

  it('選單列出 runtime 內有譯文的語系與英文原文，切換立即生效並記住選擇', async () => {
    const b = await bootFour();
    const sel = b.$('[data-agi18n="i18n"]') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => [o.value, o.textContent])).toEqual([
      ['zh-TW', '繁體中文'],
      ['zh-CN', '简体中文'],
      ['ja', '日本語'],
      ['ko', '한국어'],
      ['en', 'English（原文）'],
    ]);
    expect(sel.value).toBe('zh-TW');
    expect(b.$('#btn').textContent).toBe('設定');

    setValue(b, '[data-agi18n="i18n"]', 'ko', 'change');
    expect(b.$('#btn').textContent).toBe('설정');
    expect(b.win.localStorage.getItem(I18N_LANG_KEY)).toBe('ko');
    expect(msg(b)).toContain('한국어');

    setValue(b, '[data-agi18n="i18n"]', 'en', 'change');
    expect(b.$('#btn').textContent).toBe('Settings');
    expect(b.win.__ANTIGRAVITY_I18N__!.enabled).toBe(false);
    expect(b.win.localStorage.getItem(I18N_LANG_KEY)).toBe('en');
    // 同步維護舊旗標
    expect(b.win.localStorage.getItem(I18N_DISABLED_KEY)).toBe('1');
    const added = b.doc.createElement('button');
    added.textContent = 'Settings';
    b.$('#app').appendChild(added);
    await sleep(0);
    expect(added.textContent).toBe('Settings');

    setValue(b, '[data-agi18n="i18n"]', 'zh-CN', 'change');
    expect(b.$('#btn').textContent).toBe('设置');
    expect(added.textContent).toBe('设置');
    expect(b.win.localStorage.getItem(I18N_DISABLED_KEY)).toBeNull();
    expect(sel.value).toBe('zh-CN');
  });

  it('重新開啟視窗時套用記住的語系；handle.setLang 與選單同步', async () => {
    const b = await bootFour({ pre: (w) => (w.localStorage.setItem(I18N_LANG_KEY, 'ja'), w.localStorage.setItem('antigravity-i18n:lang-base', 'zh-TW')) });
    expect(b.$('#btn').textContent).toBe('設定');
    expect(b.win.__ANTIGRAVITY_I18N__!.lang).toBe('ja');
    expect((b.$('[data-agi18n="i18n"]') as HTMLSelectElement).value).toBe('ja');
    b.panel.setLang('ko');
    expect(b.$('#btn').textContent).toBe('설정');
    expect((b.$('[data-agi18n="i18n"]') as HTMLSelectElement).value).toBe('ko');
  });

  it('舊版旗標相容：只有 i18n-disabled=1 時以英文原文載入，選回中文後清除旗標', async () => {
    const b = await bootFour({ pre: (w) => w.localStorage.setItem(I18N_DISABLED_KEY, '1') });
    expect(b.$('#btn').textContent).toBe('Settings');
    expect((b.$('[data-agi18n="i18n"]') as HTMLSelectElement).value).toBe('en');
    setValue(b, '[data-agi18n="i18n"]', 'zh-TW', 'change');
    expect(b.$('#btn').textContent).toBe('設定');
    expect(b.win.localStorage.getItem(I18N_DISABLED_KEY)).toBeNull();
  });

  it('單一語系 runtime：只列出該語系與英文；沒有翻譯 runtime 時選單停用', async () => {
    const b = await boot({ i18n: true });
    expect(Array.from((b.$('[data-agi18n="i18n"]') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['zh-TW', 'en']);
    const none = await boot();
    expect((none.$('[data-agi18n="i18n"]') as HTMLSelectElement).disabled).toBe(true);
  });

  it('語系偏好的 localStorage key 在 overlay、面板與 runtime 腳本中一致', () => {
    expect(I18N_LANG_KEY).toBe('antigravity-i18n:lang');
    const literal = (k: string): RegExp => new RegExp(`["']${k}["']`);
    expect(antigravityI18nOverlay.toString()).toMatch(literal(I18N_LANG_KEY));
    expect(antigravityI18nOverlay.toString()).toMatch(literal(I18N_DISABLED_KEY));
    expect(antigravityI18nPanel.toString()).toMatch(literal(I18N_DISABLED_KEY));
    const script = buildRuntimeScript({}, { lang: 'zh-TW', version: '0' });
    expect(script).toContain(I18N_LANG_KEY);
    expect(script).toContain(I18N_DISABLED_KEY);
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

// ─────────────────────────────────────────────────────────────
// 掃描本頁未翻譯英文
// ─────────────────────────────────────────────────────────────

describe('介面面板：掃描未翻譯英文', () => {
  const PAGE = `
    <main id="app">
      <h1>Settings</h1>
      <button id="new" title="Open the agent manager" aria-label="Start a new conversation">Start new chat</button>
      <span>Start new chat</span>
      <p>   Build   me a   web app   </p>
      <div>已翻譯的 Agent 設定</div>
      <div>12,345.67 %</div>
      <div>x</div>
      <div>https://antigravity.google/docs</div>
      <div>someone@example.com</div>
      <div>C:\\Users\\me\\Pictures\\bg.png</div>
      <div>/home/me/project/src/main.ts</div>
      <div>src/core/runtime.ts</div>
      <div>package.json</div>
      <div>Ctrl+Alt+B</div>
      <div>Accept/Reject</div>
      <div>${'Long sentence '.repeat(10)}</div>
      <div hidden>Hidden by attribute</div>
      <div style="display:none">Hidden by style</div>
      <div aria-hidden="true">Decorative text</div>
      <code>const fooBar = 1</code>
      <pre>npm run build</pre>
      <kbd>Shift</kbd><samp>Sample output</samp>
      <svg><text>Svg label</text></svg>
      <div class="monaco-editor"><span>editor line</span></div>
      <div class="xterm"><span>terminal prompt</span></div>
      <div contenteditable="true">user draft text</div>
      <div contenteditable="false">Not editable label</div>
      <div role="textbox">textbox content</div>
      <div class="markdown"><p>Markdown answer</p></div>
      <div class="markdown-body"><p>Body answer</p></div>
      <div class="prose"><p>Prose answer</p></div>
      <div class="ChatMarkdownRenderer"><p>Renderer answer</p></div>
      <div data-antigravity-i18n-skip><p>Skipped area</p></div>
      <input value="Typed secret value" placeholder="Search files by name" title="Search box">
      <textarea placeholder="Type a message">Draft message body</textarea>
      <select aria-label="Choose model"><option>Gemini Pro option</option></select>
    </main>`;

  it('只列出可見、未翻譯的英文介面字串與提示屬性（去重、排序），跳過保護區與表單內容', async () => {
    const b = await boot({ i18n: true, html: PAGE });
    const found = b.panel.scan();
    expect(found).toEqual(
      [
        'Accept/Reject',
        'Build me a web app',
        'Choose model',
        'Not editable label',
        'Open the agent manager',
        'Search box',
        'Search files by name',
        'Start a new conversation',
        'Start new chat',
        'Type a message',
      ].sort(),
    );
    // 已翻譯（含中日韓文字）的字串不列入
    expect(found.join('\n')).not.toMatch(/Settings|Agent 設定/);
  });

  it('詞庫已有對應（translate 不為 null）的英文不列入，即使尚未被 overlay 替換', async () => {
    const b = await boot({ i18n: true, html: '<main id="app"></main>' });
    const span = b.doc.createElement('span');
    span.textContent = 'Appearance';
    const other = b.doc.createElement('span');
    other.textContent = 'Brand new label';
    b.$('#app').append(span, other);
    // 同步掃描：MutationObserver 尚未翻譯新節點
    expect(span.textContent).toBe('Appearance');
    expect(b.panel.scan()).toEqual(['Brand new label']);
  });

  it('與 overlay.ts 的保護區清單逐字相同', () => {
    const extract = (src: string): string => {
      const m = /const PROTECTED = \[([\s\S]*?)\]\.join\(/.exec(src);
      if (!m?.[1]) throw new Error('PROTECTED not found');
      return m[1].replace(/\s+/g, '');
    };
    expect(extract(antigravityI18nPanel.toString())).toBe(extract(antigravityI18nOverlay.toString()));
    for (const sel of ['code', 'pre', 'kbd', 'samp', 'script', 'style', 'svg', '.monaco-editor', '.xterm', '[contenteditable]', '[role="textbox"]', '.markdown', '.markdown-body', '.prose', '[class*="markdown"]', '[class*="Markdown"]', '[data-antigravity-i18n-skip]']) {
      expect(extract(antigravityI18nPanel.toString())).toContain(sel.replace(/\s+/g, ''));
    }
  });

  it('面板按鈕：顯示筆數與預覽、複製 JSON（navigator.clipboard），GitHub 回報連結安全開新視窗', async () => {
    const b = await boot({ i18n: true, html: '<main id="app"><button>Run all tests</button><span>Open <b>in</b> editor</span></main>' });
    const writes: string[] = [];
    Object.defineProperty(b.win.navigator, 'clipboard', { value: { writeText: vi.fn(async (t: string) => void writes.push(t)) }, configurable: true });
    key(b, ctrlAltB);
    const copy = b.$('[data-agi18n="scan-copy"]') as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    b.$('[data-agi18n="scan"]').click();
    expect(b.$('[data-agi18n="scan-count"]').textContent).toBe('找到 4 筆');
    const items = Array.from(b.doc.querySelectorAll('[data-agi18n="scan-list"] li')).map((li) => li.textContent);
    expect(items).toEqual(['Open', 'Run all tests', 'editor', 'in']);
    // 預覽一律以 textContent 寫入
    expect(b.$('[data-agi18n="scan-list"]').innerHTML).not.toContain('<b>');
    expect(copy.disabled).toBe(false);
    copy.click();
    await sleep(0);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toEqual({ Open: '', 'Run all tests': '', editor: '', in: '' });
    expect(b.panel.scanJson()).toBe(writes[0]);
    expect(b.$('[data-agi18n="msg"]').textContent).toContain('已複製 4 筆');

    const link = b.$('[data-agi18n="scan-report"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(MISSING_TRANSLATION_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // 面板自己的文字不會被掃描到
    expect(b.panel.scan()).not.toContain('掃描本頁');
  });

  it('剪貼簿 API 失敗時改用 textarea + execCommand，失敗也不拋錯', async () => {
    const b = await boot({ i18n: true, html: '<main id="app"><button>Deploy now</button></main>' });
    Object.defineProperty(b.win.navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    let copied = '';
    (b.doc as unknown as { execCommand: (c: string) => boolean }).execCommand = (c: string) => {
      copied = (b.doc.activeElement as HTMLTextAreaElement | null)?.value ?? '';
      return c === 'copy';
    };
    key(b, ctrlAltB);
    b.$('[data-agi18n="scan"]').click();
    b.$('[data-agi18n="scan-copy"]').click();
    await sleep(0);
    expect(JSON.parse(copied)).toEqual({ 'Deploy now': '' });
    expect(b.doc.querySelector('textarea')).toBeNull();
    expect(b.$('[data-agi18n="msg"]').textContent).toContain('已複製 1 筆');

    (b.doc as unknown as { execCommand: () => boolean }).execCommand = () => {
      throw new Error('nope');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    b.$('[data-agi18n="scan-copy"]').click();
    await sleep(0);
    expect(b.$('[data-agi18n="msg"]').textContent).toContain('無法存取剪貼簿');
    expect(warn).toHaveBeenCalled();
  });

  it('僅背景模式（沒有翻譯層）：列出本頁所有英文並提示', async () => {
    const b = await boot({ html: '<main id="app"><h1>Settings</h1><p>Agent Manager</p></main>' });
    key(b, ctrlAltB);
    b.$('[data-agi18n="scan"]').click();
    expect(b.panel.scan()).toEqual(['Agent Manager', 'Settings']);
    expect(b.$('[data-agi18n="msg"]').textContent).toContain('僅背景模式');
  });

  it('掛鉤內嵌的面板含掃描工具；常數與面板內的字面值一致', () => {
    const src = antigravityI18nPanel.toString();
    expect(src).toContain(MISSING_TRANSLATION_URL);
    expect(src).toContain(`MAX_LEN = ${SCAN_MAX_LEN}`);
    expect(HOOK_VERSION).toBe(7);
  });
});
