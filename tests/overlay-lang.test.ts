import fs from 'node:fs';
import path from 'node:path';
import * as asar from '@electron/asar';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectTarget } from '../src/config/paths.js';
import { readManifest } from '../src/core/backup.js';
import { loadDictionary, loadRuntimeDicts } from '../src/core/locales.js';
import { applyTarget, restoreManifest } from '../src/core/patcher.js';
import { RUNTIME_FILE_NAME, buildRuntimePack, buildRuntimeScript, runtimeDictionary } from '../src/core/runtime.js';
import { I18N_DISABLED_KEY, I18N_LANG_BASE_KEY, I18N_LANG_KEY, antigravityI18nOverlay, type OverlayHandle } from '../src/runtime/overlay.js';
import { TARGET_MODULES } from '../src/types.js';
import { packAsar, rm, tmpDir, write } from './helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const TW = { Settings: '設定', 'Open Settings': '開啟設定', Run: '執行', 'Search files': '搜尋檔案', '{count} files changed': '已變更 {count} 個檔案' };
const EXTRA = {
  'zh-CN': { Settings: '设置', 'Open Settings': '打开设置', Run: '运行', 'Search files': '搜索文件', '{count} files changed': '已更改 {count} 个文件' },
  ja: { Settings: '設定', 'Open Settings': '設定を開く', Run: '実行', 'Search files': 'ファイルを検索', '{count} files changed': '{count} 個のファイルを変更' },
  ko: { Settings: '설정', 'Open Settings': '설정 열기', Run: '실행', 'Search files': '파일 검색', '{count} files changed': '파일 {count}개 변경됨' },
};

const PAGE = `
  <main id="app">
    <h1 id="h">  Settings  </h1>
    <button id="b" title="Open Settings" aria-label="Open Settings">Run</button>
    <input id="i" placeholder="Search files" value="Run">
    <span id="n">3 files changed</span>
    <code id="code">Run</code>
    <pre id="pre">Settings</pre>
    <div class="monaco-editor"><span id="ed">Run</span></div>
    <div class="xterm"><span id="term">Settings</span></div>
    <div class="markdown-body"><p id="md">Settings</p></div>
    <div contenteditable="true" id="ce">Run</div>
    <textarea id="ta">Settings</textarea>
  </main>`;

function load(opts: { pre?: (w: JSDOM['window']) => void; extra?: Partial<typeof EXTRA>; html?: string } = {}): { win: JSDOM['window']; doc: Document; h: OverlayHandle; $: (s: string) => HTMLElement } {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${opts.html ?? PAGE}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/' });
  opts.pre?.(dom.window);
  dom.window.eval(buildRuntimeScript(TW, { lang: 'zh-TW', version: '0' }, opts.extra ?? EXTRA));
  const doc = dom.window.document;
  return {
    win: dom.window,
    doc,
    h: (dom.window as unknown as { __ANTIGRAVITY_I18N__: OverlayHandle }).__ANTIGRAVITY_I18N__,
    $: (s) => doc.querySelector(s) as HTMLElement,
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 保護區與表單內容的快照：切換語系前後必須完全相同 */
const guarded = (doc: Document): string[] =>
  ['#code', '#pre', '#ed', '#term', '#md', '#ce'].map((s) => doc.querySelector(s)!.textContent!).concat([(doc.querySelector('#i') as HTMLInputElement).value, (doc.querySelector('#ta') as HTMLTextAreaElement).value]);

describe('多語系 runtime 詞庫（共享 key）', () => {
  it('四語共用一份 key 陣列，沒有譯文為 null，語系依固定順序排列', () => {
    const pack = buildRuntimePack({ ko: { Run: '실행' }, 'zh-TW': { Settings: '設定', Run: '執行', Same: 'Same' }, ja: { Settings: '設定' } });
    expect(pack.keys).toEqual(['Settings', 'Run']);
    expect(Object.keys(pack.langs)).toEqual(['zh-TW', 'ja', 'ko']);
    expect(pack.langs).toEqual({ 'zh-TW': ['設定', '執行'], ja: ['設定', null], ko: [null, '실행'] });
  });

  it('比四份獨立字典小：key 只出現一次（以實際的 app 詞庫量測）', () => {
    const dicts = loadRuntimeDicts(TARGET_MODULES.app);
    const separate = JSON.stringify(Object.fromEntries(Object.entries(dicts).map(([l, d]) => [l, runtimeDictionary(d)]))).length;
    const packed = JSON.stringify(buildRuntimePack(dicts)).length;
    expect(packed).toBeLessThan(separate * 0.8);
    const script = buildRuntimeScript(dicts['zh-TW'], { lang: 'zh-TW', version: '0' }, dicts);
    expect(script.length).toBeLessThan(separate);
  });

  it('沒有其他語系時只打包 apply 語系；可用語系由詞庫決定', () => {
    const { h } = load({ extra: {} });
    expect(h.availableLangs).toEqual(['zh-TW', 'en']);
    const two = load({ extra: { ja: EXTRA.ja } });
    expect(two.h.availableLangs).toEqual(['zh-TW', 'ja', 'en']);
  });

  it('仍接受舊的單一語系字典（直接呼叫 overlay 函式）', () => {
    const dom = new JSDOM('<!doctype html><html><body><b id="x">Settings</b></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(`(${antigravityI18nOverlay.toString()})(${JSON.stringify({ Settings: '設定' })}, {"lang":"zh-TW","version":"0"});`);
    expect(dom.window.document.getElementById('x')!.textContent).toBe('設定');
  });
});

describe('五語免重整即時切換（WeakMap 記住英文原文）', () => {
  it('zh-TW → zh-CN → ja → ko → en → zh-TW：文字、屬性與佔位符都正確，en 完全還原原文（含空白）', () => {
    const { h, $, doc } = load();
    const before = guarded(doc);
    expect(h.availableLangs).toEqual(['zh-TW', 'zh-CN', 'ja', 'ko', 'en']);
    expect(h.lang).toBe('zh-TW');
    expect($('#h').textContent).toBe('  設定  ');
    expect($('#b').textContent).toBe('執行');
    expect($('#b').getAttribute('title')).toBe('開啟設定');
    expect($('#i').getAttribute('placeholder')).toBe('搜尋檔案');
    expect($('#n').textContent).toBe('已變更 3 個檔案');

    const expected: Record<string, [string, string, string, string, string]> = {
      'zh-CN': ['  设置  ', '运行', '打开设置', '搜索文件', '已更改 3 个文件'],
      ja: ['  設定  ', '実行', '設定を開く', 'ファイルを検索', '3 個のファイルを変更'],
      ko: ['  설정  ', '실행', '설정 열기', '파일 검색', '파일 3개 변경됨'],
      en: ['  Settings  ', 'Run', 'Open Settings', 'Search files', '3 files changed'],
      'zh-TW': ['  設定  ', '執行', '開啟設定', '搜尋檔案', '已變更 3 個檔案'],
    };
    for (const lang of ['zh-CN', 'ja', 'ko', 'en', 'zh-TW', 'ko', 'en']) {
      h.setLang(lang);
      const [hh, bb, title, ph, n] = expected[lang]!;
      expect([$('#h').textContent, $('#b').textContent, $('#b').getAttribute('title'), $('#b').getAttribute('aria-label'), $('#i').getAttribute('placeholder'), $('#n').textContent], lang).toEqual([hh, bb, title, title, ph, n]);
      expect(h.lang).toBe(lang);
      expect(h.enabled).toBe(lang !== 'en');
      // 保護區（程式碼、編輯器、終端機、Markdown、可編輯區域）與表單內容一律不動
      expect(guarded(doc), lang).toEqual(before);
    }
  });

  it('切換後新加入的節點以新語系翻譯；en 時不翻譯，切回後補翻', async () => {
    const { h, $, doc } = load();
    h.setLang('ja');
    const a = doc.createElement('button');
    a.textContent = 'Open Settings';
    $('#app').append(a);
    await flush();
    expect(a.textContent).toBe('設定を開く');
    h.setLang('en');
    expect(a.textContent).toBe('Open Settings');
    const c = doc.createElement('button');
    c.textContent = 'Run';
    $('#app').append(c);
    await flush();
    expect(c.textContent).toBe('Run');
    h.setLang('ko');
    expect([a.textContent, c.textContent]).toEqual(['설정 열기', '실행']);
  });

  it('App 自己改了文字或屬性時，新的內容才是原文（不會被還原成舊字串）', async () => {
    const { h, $ } = load();
    expect($('#b').textContent).toBe('執行');
    // 框架把按鈕文字改成另一個英文字串
    $('#b').firstChild!.nodeValue = 'Open Settings';
    $('#b').setAttribute('title', 'Search files');
    await flush();
    expect($('#b').textContent).toBe('開啟設定');
    expect($('#b').getAttribute('title')).toBe('搜尋檔案');
    h.setLang('en');
    expect($('#b').textContent).toBe('Open Settings');
    expect($('#b').getAttribute('title')).toBe('Search files');
    h.setLang('zh-CN');
    expect($('#b').textContent).toBe('打开设置');
  });

  it('偏好寫入 localStorage，重新整理後沿用；以其他語系重新 apply 後舊偏好失效', () => {
    const first = load();
    first.h.setLang('ko');
    expect(first.win.localStorage.getItem(I18N_LANG_KEY)).toBe('ko');
    expect(first.win.localStorage.getItem(I18N_LANG_BASE_KEY)).toBe('zh-TW');
    const copy = (w: JSDOM['window']): void => {
      for (const k of [I18N_LANG_KEY, I18N_LANG_BASE_KEY]) w.localStorage.setItem(k, first.win.localStorage.getItem(k)!);
    };
    const reload = load({ pre: copy });
    expect(reload.h.lang).toBe('ko');
    expect(reload.$('#b').textContent).toBe('실행');

    // 以 zh-CN 重新 apply：base 不同，偏好不再套用
    const dom = new JSDOM(`<!doctype html><html><body>${PAGE}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/' });
    copy(dom.window);
    dom.window.eval(buildRuntimeScript(EXTRA['zh-CN'], { lang: 'zh-CN', version: '0' }, { 'zh-TW': TW, ja: EXTRA.ja, ko: EXTRA.ko }));
    expect(dom.window.document.getElementById('b')!.textContent).toBe('运行');
  });

  it('舊版 i18n-disabled 旗標：以英文原文載入；setLang 會同步維護兩個 key', () => {
    const { h, $, win } = load({ pre: (w) => w.localStorage.setItem(I18N_DISABLED_KEY, '1') });
    expect(h.enabled).toBe(false);
    expect(h.lang).toBe('en');
    expect($('#b').textContent).toBe('Run');
    h.setLang('zh-TW');
    expect($('#b').textContent).toBe('執行');
    expect(win.localStorage.getItem(I18N_DISABLED_KEY)).toBeNull();
    h.setLang('en');
    expect(win.localStorage.getItem(I18N_DISABLED_KEY)).toBe('1');
    expect(win.localStorage.getItem(I18N_LANG_KEY)).toBe('en');
  });

  it('stop() 還原原文、resume() 以原本的語系重譯；不合法的語系只警告不拋錯', () => {
    const { h, $ } = load();
    h.setLang('ja');
    h.stop();
    expect($('#b').textContent).toBe('Run');
    h.resume();
    expect($('#b').textContent).toBe('実行');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => h.setLang('fr')).not.toThrow();
    expect(() => h.setLang('<img>')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(h.lang).toBe('ja');
  });

  it('localStorage 無法使用時仍可切換（只是不記住）', () => {
    const { h, $ } = load({
      pre: (w) =>
        Object.defineProperty(w, 'localStorage', {
          get() {
            throw new Error('denied');
          },
        }),
    });
    h.setLang('ko');
    expect($('#b').textContent).toBe('실행');
  });

  it('原文以 WeakMap 保存（節點移除後可被回收），不在節點上留下額外屬性', () => {
    const src = antigravityI18nOverlay.toString();
    expect(src.match(/new WeakMap\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    const { $, h } = load();
    h.setLang('ko');
    const attrs = Array.from($('#b').attributes).map((a) => a.name).sort();
    expect(attrs).toEqual(['aria-label', 'id', 'title']);
  });
});

describe('patcher：四語打包進 app runtime', () => {
  it('runtime 檔含四語，manifest 記錄 langs；靜態層只用 apply 語系；restore 逐位元組還原', async () => {
    const dir = tmpDir('agi18n-multilang-');
    try {
      const src = path.join(dir, 'src');
      write(path.join(src, 'package.json'), '{"name":"antigravity","main":"dist/main.js"}');
      write(path.join(src, 'dist', 'main.js'), `'use strict';\nconst { app } = require('electron');\n`);
      write(path.join(src, 'dist', 'menu.js'), 'Menu.buildFromTemplate([{label:"Settings"}]);');
      const root = path.join(dir, 'Antigravity');
      const asarPath = path.join(root, 'resources', 'app.asar');
      fs.mkdirSync(path.dirname(asarPath), { recursive: true });
      await packAsar(src, asarPath, {});
      const original = fs.readFileSync(asarPath);
      const home = path.join(dir, 'home');
      const t = detectTarget('app', { customPath: root })!;
      const dicts = loadRuntimeDicts(TARGET_MODULES.app);
      const r = await applyTarget(t, { lang: 'ja', dict: loadDictionary('ja', TARGET_MODULES.app), toolHome: home, toolVersion: '0', runtimeDicts: dicts });
      expect(r.status).toBe('applied');
      expect(r.runtime?.langs).toEqual(['zh-TW', 'zh-CN', 'ja', 'ko']);
      expect(readManifest(r.manifestPath)!.runtime!.langs).toEqual(['zh-TW', 'zh-CN', 'ja', 'ko']);
      asar.uncacheAll();
      expect(asar.extractFile(asarPath, path.join('dist', 'menu.js')).toString()).toContain('label:"設定"');
      const code = asar.extractFile(asarPath, path.join('dist', RUNTIME_FILE_NAME)).toString();

      // 在 jsdom 中執行打包出的 runtime：預設 ja，可切換其他三語與英文
      const dom = new JSDOM('<!doctype html><html><body><button id="b">Settings</button></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
      dom.window.eval(code);
      const h = (dom.window as unknown as { __ANTIGRAVITY_I18N__: OverlayHandle }).__ANTIGRAVITY_I18N__;
      const b = dom.window.document.getElementById('b')!;
      expect(h.lang).toBe('ja');
      expect(h.availableLangs).toEqual(['zh-TW', 'zh-CN', 'ja', 'ko', 'en']);
      const seen = ['zh-TW', 'zh-CN', 'ko', 'en'].map((l) => (h.setLang(l), b.textContent));
      expect(seen).toEqual([dicts['zh-TW'].Settings, dicts['zh-CN'].Settings, dicts.ko.Settings, 'Settings']);

      await restoreManifest(r.manifestPath, { toolHome: home });
      expect(fs.readFileSync(asarPath)).toEqual(original);

      // 僅背景模式：仍然不寫入翻譯 runtime（即使傳入四語詞庫）
      const bg = await applyTarget(t, { lang: 'none', dict: {}, toolHome: home, toolVersion: '0', runtimeDicts: dicts });
      expect(bg.runtime).toMatchObject({ translation: false, entries: 0 });
      asar.uncacheAll();
      expect(asar.listPackage(asarPath, { isPack: false }).some((p) => p.endsWith(RUNTIME_FILE_NAME))).toBe(false);
    } finally {
      rm(dir);
    }
  });
});
