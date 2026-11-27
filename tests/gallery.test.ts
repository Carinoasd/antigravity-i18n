import { IDBFactory } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { presetMeta } from '../src/core/presets.js';
import { HOOK_VERSION, PANEL_MAX_BYTES } from '../src/core/runtime.js';
import { applyBackground, type BackgroundPayload } from '../src/runtime/background.js';
import {
  CJK_FONT_STACK,
  GALLERY_MAX_ITEMS,
  GALLERY_MAX_TOTAL,
  PANEL_DB_VERSION,
  SLIDESHOW_MS,
  antigravityI18nPanel,
  type GalleryItem,
  type PanelHandle,
} from '../src/runtime/panel.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 與主行程掛鉤相同的組合方式 */
function panelScript(cli: BackgroundPayload | null = null): string {
  const cfg = { cli, presets: presetMeta(), maxBytes: PANEL_MAX_BYTES, version: HOOK_VERSION };
  return `(function(){var applyBackground=${applyBackground.toString()};(${antigravityI18nPanel.toString()})(applyBackground,${JSON.stringify(cfg)});})();`;
}

type Win = JSDOM['window'] & { __ANTIGRAVITY_I18N_PANEL__: PanelHandle; indexedDB?: IDBFactory };

interface Booted {
  win: Win;
  doc: Document;
  panel: PanelHandle;
  $: (sel: string) => HTMLElement;
  bg: () => string;
  msg: () => string;
}

async function boot(opts: { idb?: IDBFactory; cli?: BackgroundPayload | null; pre?: (w: Win) => void; html?: string } = {}): Promise<Booted> {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${opts.html ?? '<main id="app"></main>'}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window as unknown as Win;
  if (opts.idb) win.indexedDB = opts.idb;
  opts.pre?.(win);
  win.eval(panelScript(opts.cli ?? null));
  const panel = win.__ANTIGRAVITY_I18N_PANEL__;
  await panel.ready;
  const doc = win.document;
  const $ = (sel: string): HTMLElement => {
    const el = doc.querySelector(sel);
    if (!el) throw new Error(`not found: ${sel}`);
    return el as HTMLElement;
  };
  return {
    win,
    doc,
    panel,
    $,
    bg: () => doc.getElementById('antigravity-i18n-bg-style')?.textContent ?? '',
    msg: () => doc.querySelector('[data-agi18n="msg"]')?.textContent ?? '',
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 指定解碼後位元組數的合法 PNG data URL（內容不必是真的圖片：面板只驗證格式與大小） */
function dataUrl(bytes: number, fill = 'A'): string {
  const b64 = Math.ceil(bytes / 3) * 4;
  return `data:image/png;base64,${fill.repeat(b64)}`;
}

/** 直接寫入 IndexedDB（模擬先前存下的資料或被竄改的資料） */
function idbPut(idb: IDBFactory, store: string, value: unknown, key?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.open('antigravity-i18n');
    req.onsuccess = () => {
      const tx = req.result.transaction(store, 'readwrite');
      if (key === undefined) tx.objectStore(store).put(value);
      else tx.objectStore(store).put(value, key);
      tx.oncomplete = () => {
        req.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function idbGet(idb: IDBFactory, store: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = idb.open('antigravity-i18n');
    req.onsuccess = () => {
      const r = req.result.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = () => {
        req.result.close();
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
    };
    req.onerror = () => reject(req.error);
  });
}

const item = (n: number, bytes = 64, fill = 'B'): GalleryItem => ({
  id: `g${(1_000_000 + n).toString(36)}abcdef`,
  dataUrl: dataUrl(bytes, fill),
  hash: n.toString(16).padStart(8, '0'),
  addedAt: new Date(2026, 0, n).toISOString(),
});

function chooseImage(b: Booted, url: string): Promise<void> {
  const raw = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  const file = new b.win.File([raw], 'wall.png', { type: 'image/png' });
  const input = b.$('[data-agi18n="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new b.win.Event('change', { bubbles: true }));
  return sleep(30);
}

const thumbs = (b: Booted): string[] => Array.from(b.doc.querySelectorAll('[data-agi18n-gallery]')).map((n) => n.getAttribute('data-agi18n-gallery')!);

// ─────────────────────────────────────────────────────────────

describe('桌布收藏夾：IndexedDB schema', () => {
  it('v1 → v2 升級保留舊的 settings，新增 gallery store', async () => {
    const idb = new IDBFactory();
    // 建立舊版（v1）資料庫：只有 settings，裡面有一筆預設背景
    await new Promise<void>((resolve, reject) => {
      const req = idb.open('antigravity-i18n', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('settings');
      req.onsuccess = () => {
        const tx = req.result.transaction('settings', 'readwrite');
        tx.objectStore('settings').put({ enabled: true, source: 'preset', preset: 'midnight', opacity: 0.3, blur: 0, position: 'center', size: 'cover', tint: '', mode: 'overlay' }, 'background');
        tx.oncomplete = () => (req.result.close(), resolve());
      };
      req.onerror = () => reject(req.error);
    });
    const b = await boot({ idb });
    expect(PANEL_DB_VERSION).toBe(2);
    expect(b.panel.persistent).toBe(true);
    expect(b.panel.settings()).toMatchObject({ source: 'preset', preset: 'midnight', opacity: 0.3 });
    expect(b.doc.getElementById('antigravity-i18n-bg')!.getAttribute('data-preset')).toBe('midnight');
    const names = await new Promise<string[]>((resolve) => {
      const req = idb.open('antigravity-i18n');
      req.onsuccess = () => {
        resolve(Array.from(req.result.objectStoreNames));
        req.result.close();
      };
    });
    expect(names.sort()).toEqual(['gallery', 'settings']);
    expect(await b.panel.gallery()).toEqual([]);
  });

  it('沒有 IndexedDB 時收藏夾停用並提示，不拋錯', async () => {
    const b = await boot();
    expect((b.$('[data-agi18n="gallery-add"]') as HTMLButtonElement).disabled).toBe(true);
    expect(await b.panel.addToGallery()).toBeNull();
    expect(b.msg()).toContain('IndexedDB');
    expect(await b.panel.next()).toBe(false);
  });
});

describe('桌布收藏夾：加入、切換、刪除', () => {
  it('加入目前圖片：設定改為引用收藏（不重複存放圖片），面板開啟時才載入縮圖', async () => {
    const idb = new IDBFactory();
    const b = await boot({ idb });
    const img = dataUrl(300);
    await chooseImage(b, img);
    expect(b.panel.settings()).toMatchObject({ source: 'image' });

    const id = await b.panel.addToGallery();
    expect(id).toMatch(/^g[a-z0-9]{6,32}$/);
    expect(b.panel.settings()).toMatchObject({ source: 'gallery', galleryId: id });
    expect(b.panel.settings()!.dataUrl).toBeUndefined();
    expect(b.bg()).toContain(img);
    await sleep(200);
    const stored = (await idbGet(idb, 'settings', 'background')) as Record<string, unknown>;
    expect(stored.source).toBe('gallery');
    expect(stored.dataUrl).toBeUndefined();

    // 面板關閉時不保留縮圖
    expect(thumbs(b)).toEqual([]);
    b.panel.open();
    await sleep(30);
    expect(thumbs(b)).toEqual([id]);
    expect(b.$('[data-agi18n="gallery-quota"]').textContent).toBe('1/12 張．0.0/30.0 MB');
    expect(b.$(`[data-agi18n-gallery="${id}"]`).getAttribute('aria-pressed')).toBe('true');
    b.panel.close();
    expect(thumbs(b)).toEqual([]);

    // 同一張圖片不重複加入
    expect(await b.panel.addToGallery()).toBe(id);
    expect(b.msg()).toContain('已在收藏夾中');
    expect(await b.panel.gallery()).toHaveLength(1);

    // 重新開啟視窗：從收藏讀回圖片
    const again = await boot({ idb });
    expect(again.bg()).toContain(img);
  });

  it('CLI 的圖片也能加入收藏；不是圖片時提示', async () => {
    const idb = new IDBFactory();
    const cliImg = dataUrl(90, 'C');
    const b = await boot({ idb, cli: { kind: 'image', image: `url("${cliImg}")`, opacity: 0.2, blur: 0, size: 'cover', position: 'center', mode: 'overlay' } });
    expect(await b.panel.addToGallery()).not.toBeNull();
    expect((await b.panel.gallery())[0]!.size).toBe(90);

    const p = await boot({ idb: new IDBFactory() });
    (p.$('[data-agi18n-preset="aurora"]') as HTMLButtonElement).click();
    expect(await p.panel.addToGallery()).toBeNull();
    expect(p.msg()).toContain('目前的背景不是圖片');
  });

  it('點縮圖一鍵切換；刪除目前的桌布時改回 CLI 設定', async () => {
    const idb = new IDBFactory();
    await boot({ idb });
    const a = item(1, 60, 'D');
    const c = item(2, 60, 'E');
    await idbPut(idb, 'gallery', a);
    await idbPut(idb, 'gallery', c);
    const b = await boot({ idb });
    b.panel.open();
    await sleep(30);
    expect(thumbs(b)).toEqual([a.id, c.id]);
    (b.$(`[data-agi18n-gallery="${c.id}"]`) as HTMLButtonElement).click();
    await sleep(30);
    expect(b.panel.settings()).toMatchObject({ source: 'gallery', galleryId: c.id });
    expect(b.bg()).toContain(c.dataUrl);

    (b.$(`[data-agi18n-gallery-del="${c.id}"]`) as HTMLButtonElement).click();
    await sleep(30);
    expect(thumbs(b)).toEqual([a.id]);
    expect(b.panel.settings()).toMatchObject({ source: 'cli' });
    expect(b.doc.getElementById('antigravity-i18n-bg')).toBeNull();
  });
});

describe('桌布收藏夾：低記憶體容量上限', () => {
  it(`最多 ${GALLERY_MAX_ITEMS} 張`, async () => {
    const idb = new IDBFactory();
    await boot({ idb });
    for (let i = 1; i <= GALLERY_MAX_ITEMS; i++) await idbPut(idb, 'gallery', item(i));
    const b = await boot({ idb });
    await chooseImage(b, dataUrl(120, 'Z'));
    expect(await b.panel.addToGallery()).toBeNull();
    expect(b.msg()).toContain(`最多 ${GALLERY_MAX_ITEMS} 張`);
    expect(await b.panel.gallery()).toHaveLength(GALLERY_MAX_ITEMS);
  });

  it('總容量上限 30 MB；單張超過 10 MB 一律拒絕', async () => {
    expect(GALLERY_MAX_TOTAL).toBe(30 * 1024 * 1024);
    const idb = new IDBFactory();
    await boot({ idb });
    // 三張 9.5 MB = 28.5 MB
    for (let i = 1; i <= 3; i++) await idbPut(idb, 'gallery', item(i, 9.5 * 1024 * 1024, 'ABCD'[i]!));
    const b = await boot({ idb });
    b.panel.open();
    await b.panel.gallery();
    expect(b.$('[data-agi18n="gallery-quota"]').textContent).toBe('3/12 張．28.5/30.0 MB');
    // 沒有縮圖的大圖顯示編號，不把 9.5 MB 的字串放進 DOM
    expect(Array.from(b.doc.querySelectorAll('[data-agi18n-gallery]')).map((n) => [n.textContent, (n as HTMLElement).style.backgroundImage])).toEqual([
      ['1', ''],
      ['2', ''],
      ['3', ''],
    ]);
    await chooseImage(b, dataUrl(2 * 1024 * 1024, 'Q'));
    expect(await b.panel.addToGallery()).toBeNull();
    expect(b.msg()).toMatch(/總容量上限 30\.0 MB.*已用 28\.5 MB/);
    expect(await b.panel.gallery()).toHaveLength(3);
  });

  it('被竄改或超過上限的收藏不會被讀取或套用', async () => {
    const idb = new IDBFactory();
    await boot({ idb });
    const good = item(1, 60, 'G');
    await idbPut(idb, 'gallery', good);
    await idbPut(idb, 'gallery', { ...item(2), dataUrl: 'javascript:alert(1)' });
    await idbPut(idb, 'gallery', { ...item(3), id: 'g"onerror=1' });
    await idbPut(idb, 'gallery', { ...item(4), dataUrl: dataUrl(PANEL_MAX_BYTES + 3) });
    await idbPut(idb, 'gallery', { ...item(5, 60, 'H'), thumb: 'data:image/png;base64,AA")};*{display:none' });
    await idbPut(idb, 'settings', { enabled: true, source: 'gallery', galleryId: item(2).id, opacity: 0.2 }, 'background');
    const b = await boot({ idb });
    // 指向損毀收藏的設定：改回 CLI，不套用
    expect(b.panel.settings()).toMatchObject({ source: 'cli' });
    expect(b.doc.getElementById('antigravity-i18n-bg')).toBeNull();
    const list = await b.panel.gallery();
    expect(list.map((m) => m.id)).toEqual([good.id, item(5).id]);
    // 不合法的縮圖改用原圖顯示，絕不放進 CSS
    expect(list[1]!.thumb).toBe(item(5, 60, 'H').dataUrl);
    expect(await b.panel.selectGallery(item(2).id)).toBe(false);
    expect(await b.panel.selectGallery('g"x')).toBe(false);
  });
});

describe('桌布收藏夾：自動輪播', () => {
  it('on-launch：每次開啟視窗換下一張（循環）', async () => {
    const idb = new IDBFactory();
    await boot({ idb });
    const a = item(1, 60, 'J');
    const c = item(2, 60, 'K');
    await idbPut(idb, 'gallery', a);
    await idbPut(idb, 'gallery', c);
    await idbPut(idb, 'settings', { cjkFont: false, glass: false, slideshow: 'on-launch' }, 'prefs');

    const w1 = await boot({ idb });
    expect(w1.panel.settings()).toMatchObject({ galleryId: a.id });
    await sleep(200);
    const w2 = await boot({ idb });
    expect(w2.panel.settings()).toMatchObject({ galleryId: c.id });
    expect(w2.bg()).toContain(c.dataUrl);
    await sleep(200);
    const w3 = await boot({ idb });
    expect(w3.panel.settings()).toMatchObject({ galleryId: a.id });
  });

  it('定時輪播：同一時間只有一個 interval，切換模式先清除舊的；「下一張」可手動切換', async () => {
    const idb = new IDBFactory();
    await boot({ idb });
    const a = item(1, 60, 'L');
    const c = item(2, 60, 'M');
    await idbPut(idb, 'gallery', a);
    await idbPut(idb, 'gallery', c);

    let seq = 0;
    const active = new Map<number, { fn: () => void; ms: number }>();
    const cleared: number[] = [];
    const b = await boot({
      idb,
      pre: (w) => {
        (w as unknown as { setInterval: unknown }).setInterval = (fn: () => void, ms: number) => {
          const id = ++seq;
          active.set(id, { fn, ms });
          return id;
        };
        (w as unknown as { clearInterval: unknown }).clearInterval = (id: number) => {
          cleared.push(id);
          active.delete(id);
        };
      },
    });
    expect(active.size).toBe(0);

    b.panel.setPrefs({ slideshow: '15m' });
    expect([...active.values()].map((t) => t.ms)).toEqual([SLIDESHOW_MS['15m']]);
    b.panel.setPrefs({ slideshow: '30m' });
    expect(cleared).toEqual([1]);
    expect([...active.values()].map((t) => t.ms)).toEqual([30 * 60_000]);
    b.panel.setPrefs({ slideshow: '60m' });
    expect([...active.values()].map((t) => t.ms)).toEqual([60 * 60_000]);

    // 計時器觸發：換下一張
    [...active.values()][0]!.fn();
    await sleep(30);
    expect(b.panel.settings()).toMatchObject({ galleryId: a.id });
    [...active.values()][0]!.fn();
    await sleep(30);
    expect(b.panel.settings()).toMatchObject({ galleryId: c.id });

    // 手動下一張
    b.panel.open();
    (b.$('[data-agi18n="gallery-next"]') as HTMLButtonElement).click();
    await sleep(30);
    expect(b.panel.settings()).toMatchObject({ galleryId: a.id });

    // 重複注入同一份文件：不會多排一個 interval
    b.win.eval(panelScript(null));
    expect(active.size).toBe(1);

    b.panel.setPrefs({ slideshow: 'off' });
    expect(active.size).toBe(0);
    await sleep(200);
    expect(await idbGet(idb, 'settings', 'prefs')).toEqual({ cjkFont: false, glass: false, slideshow: 'off' });
  });

  it('輪播設定從面板選單變更並持久化；不合法的值改為關閉', async () => {
    const idb = new IDBFactory();
    const b = await boot({ idb });
    const sel = b.$('[data-agi18n="slideshow"]') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['off', 'on-launch', '15m', '30m', '60m']);
    sel.value = '30m';
    sel.dispatchEvent(new b.win.Event('change'));
    expect(b.panel.prefs().slideshow).toBe('30m');
    await sleep(200);
    expect((await boot({ idb })).panel.prefs().slideshow).toBe('30m');
    await idbPut(idb, 'settings', { slideshow: '1ms', cjkFont: 'yes', glass: 1 }, 'prefs');
    expect((await boot({ idb })).panel.prefs()).toEqual({ cjkFont: false, glass: false, slideshow: 'off' });
  });
});

describe('外觀微調：CJK 字型與毛玻璃', () => {
  it('預設皆關閉；開關立即注入／移除獨立的 <style>，並持久化', async () => {
    const idb = new IDBFactory();
    const b = await boot({ idb });
    expect(b.panel.prefs()).toEqual({ cjkFont: false, glass: false, slideshow: 'off' });
    expect(b.doc.getElementById('antigravity-i18n-font')).toBeNull();
    expect(b.doc.getElementById('antigravity-i18n-glass')).toBeNull();

    const font = b.$('[data-agi18n="cjk-font"]') as HTMLInputElement;
    font.checked = true;
    font.dispatchEvent(new b.win.Event('change'));
    const fs = b.doc.getElementById('antigravity-i18n-font')!;
    expect(fs.parentElement).toBe(b.doc.head);
    expect(fs.hasAttribute('data-antigravity-i18n-skip')).toBe(true);
    expect(fs.textContent).toContain(`font-family:${CJK_FONT_STACK}`);
    for (const name of ['PingFang TC', 'Microsoft JhengHei UI', 'Noto Sans CJK TC', 'Hiragino Sans', 'Malgun Gothic']) expect(fs.textContent).toContain(`"${name}"`);
    // 程式碼、編輯器、終端機與 mono 類別一律排除
    for (const sel of ['code', 'pre', 'kbd', 'samp', '.monaco-editor', '.xterm', '[class*="mono"]']) expect(fs.textContent).toContain(`${sel} *`);
    expect(fs.textContent).not.toMatch(/(^|[{},])\s*code\s*\{/);
    expect(fs.textContent).not.toContain('!important');

    const glass = b.$('[data-agi18n="glass"]') as HTMLInputElement;
    glass.checked = true;
    glass.dispatchEvent(new b.win.Event('change'));
    const gs = b.doc.getElementById('antigravity-i18n-glass')!;
    expect(gs.hasAttribute('data-antigravity-i18n-skip')).toBe(true);
    expect(gs.textContent).toContain('backdrop-filter:blur(10px)');
    expect(gs.textContent).toContain('[role="dialog"]');
    expect(gs.textContent).toContain(':not([data-antigravity-i18n-skip])');

    await sleep(200);
    const again = await boot({ idb });
    expect(again.panel.prefs()).toMatchObject({ cjkFont: true, glass: true });
    expect(again.doc.getElementById('antigravity-i18n-font')).not.toBeNull();
    expect(again.doc.getElementById('antigravity-i18n-glass')).not.toBeNull();
    expect((again.$('[data-agi18n="cjk-font"]') as HTMLInputElement).checked).toBe(true);

    again.panel.setPrefs({ cjkFont: false });
    expect(again.doc.getElementById('antigravity-i18n-font')).toBeNull();
    expect(again.doc.getElementById('antigravity-i18n-glass')).not.toBeNull();
    again.panel.setPrefs({ glass: false });
    expect(again.doc.getElementById('antigravity-i18n-glass')).toBeNull();
  });

  it('字型只作用在一般介面：body 與一般按鈕使用 CJK 字型，<code> 與編輯器內的控制項不受影響', async () => {
    const b = await boot({ html: '<main id="app"><button id="btn">OK</button><div class="monaco-editor"><textarea id="ta"></textarea></div><div class="font-mono"><button id="mono">x</button></div><code id="c">x</code></main>' });
    const style = b.doc.createElement('style');
    style.textContent = 'code{font-family:monospace}';
    b.doc.head.prepend(style);
    b.panel.setPrefs({ cjkFont: true });
    const ff = (sel: string): string => b.win.getComputedStyle(b.$(sel)).fontFamily;
    expect(ff('body')).toBe(CJK_FONT_STACK);
    expect(ff('#btn')).toBe(CJK_FONT_STACK);
    expect(ff('#ta')).toBe('');
    expect(ff('#mono')).toBe('');
    expect(ff('#c')).toBe('monospace');
    b.panel.setPrefs({ cjkFont: false });
    expect(ff('body')).toBe('');
  });

  it('框架重繪 <head> 時補回已啟用的樣式', async () => {
    const b = await boot();
    b.panel.setPrefs({ cjkFont: true, glass: true });
    b.doc.getElementById('antigravity-i18n-font')!.remove();
    b.doc.getElementById('antigravity-i18n-glass')!.remove();
    await sleep(30);
    expect(b.doc.getElementById('antigravity-i18n-font')).not.toBeNull();
    expect(b.doc.getElementById('antigravity-i18n-glass')).not.toBeNull();
  });
});
