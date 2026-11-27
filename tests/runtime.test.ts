import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBackground, setPreset } from '../src/core/background.js';
import { BACKGROUND_PRESETS } from '../src/core/presets.js';
import {
  HOOK_BEGIN,
  HOOK_VERSION,
  buildHook,
  HOOK_END,
  RUNTIME_FILE_NAME,
  RUNTIME_MARKER,
  buildRuntimeScript,
  countRuntimeEntries,
  detectModuleFormat,
  hasHook,
  injectHook,
  isInternalUrl,
  resolveMainEntry,
  runtimeEntryPath,
  stripHook,
} from '../src/core/runtime.js';
import type { OverlayHandle } from '../src/runtime/overlay.js';
import { rm, tmpDir, write } from './helpers.js';

const dict = {
  Settings: '設定',
  'Accept All': '全部接受',
  Run: '執行',
  'Search conversations': '搜尋對話',
  'Open Settings': '開啟設定',
  'Ask anything, @ to mention, / for workflows': '詢問任何問題，輸入 @ 以提及、/ 以使用工作流程',
  '{count} files changed': '已變更 {count} 個檔案',
  'Thought for %ds': '已思考 %d 秒',
  'Logged in as {email}': '已登入為 {email}',
  Same: 'Same',
};

const script = buildRuntimeScript(dict, { lang: 'zh-TW', version: '9.9.9' });

/** 在 jsdom 中執行與實際注入完全相同的 runtime 腳本 */
function load(body: string): { window: JSDOM['window']; document: Document; handle: OverlayHandle } {
  const dom = new JSDOM(`<!doctype html><html><head><title>Settings</title></head><body>${body}</body></html>`, {
    runScripts: 'outside-only',
  });
  dom.window.eval(script);
  const handle = (dom.window as unknown as { __ANTIGRAVITY_I18N__: OverlayHandle }).__ANTIGRAVITY_I18N__;
  return { window: dom.window, document: dom.window.document, handle };
}

const $ = (doc: Document, sel: string): Element => {
  const el = doc.querySelector(sel);
  if (!el) throw new Error(`not found: ${sel}`);
  return el;
};

/** 等待 MutationObserver 回呼執行 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('runtime 腳本', () => {
  it('自足、零依賴，並帶有標記', () => {
    expect(script.startsWith(RUNTIME_MARKER)).toBe(true);
    expect(script).not.toMatch(/\brequire\(|\bimport\s|__vite|__name\(/);
    // 在沒有 DOM 的環境執行也不會拋錯
    expect(() => vm.runInNewContext(script, {})).not.toThrow();
  });

  it('只載入原文與譯文不同的詞條，並統計佔位符樣式', () => {
    expect(countRuntimeEntries(dict)).toEqual({ entries: 9, patternEntries: 3 });
    expect(script).not.toContain('"Same"');
  });
});

describe('Runtime DOM 翻譯', () => {
  it('翻譯文字節點並保留前後空白', () => {
    const { document, handle } = load(`<nav><button id="a">  Settings </button><span id="b">Accept All</span></nav>`);
    expect($(document, '#a').textContent).toBe('  設定 ');
    expect($(document, '#b').textContent).toBe('全部接受');
    expect(document.title).toBe('設定');
    expect(handle).toMatchObject({ lang: 'zh-TW', version: '9.9.9', entries: 9 });
  });

  it('不翻譯部分相符或含其他文字的節點', () => {
    const { document } = load(`<p id="a">Settings Sync</p><p id="b">Run tests</p>`);
    expect($(document, '#a').textContent).toBe('Settings Sync');
    expect($(document, '#b').textContent).toBe('Run tests');
  });

  it('翻譯 title / aria-label / placeholder 屬性', () => {
    const { document } = load(
      `<button id="b" title="Open Settings" aria-label="Settings">x</button>` +
        `<input id="i" placeholder="Search conversations" value="Settings">` +
        `<textarea id="t" placeholder="Ask anything, @ to mention, / for workflows">Settings</textarea>`,
    );
    const b = $(document, '#b');
    expect(b.getAttribute('title')).toBe('開啟設定');
    expect(b.getAttribute('aria-label')).toBe('設定');
    expect($(document, '#i').getAttribute('placeholder')).toBe('搜尋對話');
    expect($(document, '#t').getAttribute('placeholder')).toBe('詢問任何問題，輸入 @ 以提及、/ 以使用工作流程');
  });

  it('絕不改動輸入框與 textarea 的內容', () => {
    const { document } = load(`<input id="i" value="Settings"><textarea id="t">Settings</textarea><select id="s"><option>Settings</option></select>`);
    expect(($(document, '#i') as HTMLInputElement).value).toBe('Settings');
    expect(($(document, '#t') as HTMLTextAreaElement).value).toBe('Settings');
    expect($(document, '#t').textContent).toBe('Settings');
    expect($(document, '#s option').textContent).toBe('Settings');
  });

  it.each([
    ['<code>', `<code>Settings</code>`],
    ['<pre>', `<pre><span>Settings</span></pre>`],
    ['.monaco-editor', `<div class="monaco-editor"><div class="view-line"><span>Settings</span></div></div>`],
    ['.xterm', `<div class="xterm"><div class="xterm-rows"><span>Run</span></div></div>`],
    ['[contenteditable="true"]', `<div contenteditable="true"><p>Settings</p></div>`],
    ['[contenteditable]', `<div contenteditable><p>Settings</p></div>`],
    ['[role="textbox"]', `<div role="textbox">Settings</div>`],
    ['Markdown 正文', `<div class="chat-message"><div class="markdown-body"><p>Settings</p><p>Accept All</p></div></div>`],
    ['.prose', `<article class="prose"><p>Settings</p></article>`],
    ['[data-antigravity-i18n-skip]', `<div data-antigravity-i18n-skip><b>Settings</b></div>`],
  ])('排除保護區域：%s', (_name, html) => {
    const { document } = load(`<main id="root">${html}</main><button id="ok">Settings</button>`);
    expect($(document, '#root').textContent).not.toMatch(/設定|全部接受|執行/);
    expect($(document, '#ok').textContent).toBe('設定');
  });

  it('保護區域內的屬性也不翻譯', () => {
    const { document } = load(
      `<div contenteditable="true"><span id="a" title="Settings">x</span></div>` +
        `<pre><a id="b" aria-label="Settings">x</a></pre>` +
        `<div contenteditable="false"><span id="c" title="Settings">Settings</span></div>`,
    );
    expect($(document, '#a').getAttribute('title')).toBe('Settings');
    expect($(document, '#b').getAttribute('aria-label')).toBe('Settings');
    // contenteditable="false" 不是可編輯區域
    expect($(document, '#c').getAttribute('title')).toBe('設定');
    expect($(document, '#c').textContent).toBe('設定');
  });

  it('含佔位符的詞條以樣式比對', () => {
    const { document, handle } = load(`<p id="a">3 files changed</p><p id="b">Thought for 12s</p><p id="c">Logged in as a@b.c</p><p id="d">Thought for xs</p>`);
    expect($(document, '#a').textContent).toBe('已變更 3 個檔案');
    expect($(document, '#b').textContent).toBe('已思考 12 秒');
    expect($(document, '#c').textContent).toBe('已登入為 a@b.c');
    expect($(document, '#d').textContent).toBe('Thought for xs');
    expect(handle.translate('Settings')).toBe('設定');
    expect(handle.translate('設定')).toBeNull();
  });

  it('MutationObserver：動態新增的節點、文字變更與屬性變更都會即時翻譯', async () => {
    const { document } = load(`<div id="app"></div>`);
    const app = $(document, '#app');
    app.innerHTML = `<button id="x" title="Settings">Accept All</button><div class="markdown-body"><p id="md">Settings</p></div>`;
    await flush();
    expect($(document, '#x').textContent).toBe('全部接受');
    expect($(document, '#x').getAttribute('title')).toBe('設定');
    expect($(document, '#md').textContent).toBe('Settings');

    // React 之類的框架更新文字節點
    ($(document, '#x').firstChild as Text).nodeValue = 'Settings';
    $(document, '#x').setAttribute('title', 'Accept All');
    await flush();
    expect($(document, '#x').textContent).toBe('設定');
    expect($(document, '#x').getAttribute('title')).toBe('全部接受');

    // 在保護區域內新增的節點不翻譯
    const span = document.createElement('span');
    span.textContent = 'Run';
    document.querySelector('.markdown-body')!.appendChild(span);
    await flush();
    expect(span.textContent).toBe('Run');
  });

  it('stop() 後不再翻譯', async () => {
    const { document, handle } = load(`<div id="app"></div>`);
    handle.stop();
    $(document, '#app').innerHTML = '<b>Settings</b>';
    await flush();
    expect($(document, '#app').textContent).toBe('Settings');
  });

  it('防止重複注入', () => {
    const { window, handle } = load(`<b>Settings</b>`);
    window.eval(script);
    expect((window as unknown as { __ANTIGRAVITY_I18N__: OverlayHandle }).__ANTIGRAVITY_I18N__).toBe(handle);
  });
});

describe('主行程掛鉤：注入與移除', () => {
  const MAIN = `'use strict';\nconst { app } = require('electron');\napp.whenReady();\n`;

  it('插在 use strict 之後，並保留 shebang 與開頭註解', () => {
    const out = injectHook(MAIN, 'cjs');
    expect(out.startsWith(`'use strict';\n${HOOK_BEGIN}`)).toBe(true);
    const withHeader = `#!/usr/bin/env electron\n/* banner */\n"use strict";\nfoo();\n`;
    expect(injectHook(withHeader, 'cjs').startsWith(`#!/usr/bin/env electron\n/* banner */\n"use strict";\n${HOOK_BEGIN}`)).toBe(true);
    expect(injectHook('foo();\n', 'cjs').startsWith(HOOK_BEGIN)).toBe(true);
    expect(injectHook('#!/usr/bin/env node\nfoo();\n', 'esm').startsWith(`#!/usr/bin/env node\n${HOOK_BEGIN}`)).toBe(true);
  });

  it('具冪等性，且可完整移除', () => {
    const once = injectHook(MAIN, 'cjs');
    const twice = injectHook(once, 'cjs');
    expect(twice).toBe(once);
    expect(twice.split(HOOK_BEGIN)).toHaveLength(2);
    expect(hasHook(once)).toBe(true);
    expect(stripHook(once)).toBe(MAIN);
    expect(hasHook(MAIN)).toBe(false);
  });

  it('掛鉤是合法的 JavaScript', () => {
    expect(() => new vm.Script(injectHook(MAIN, 'cjs'))).not.toThrow();
    expect(injectHook(MAIN, 'cjs')).toContain(HOOK_END);
  });

  it('resolveMainEntry / detectModuleFormat / runtimeEntryPath', () => {
    const files = new Set(['dist/main.js', 'index.js', 'out/app/index.js', 'esm/main.mjs']);
    expect(resolveMainEntry({ main: './dist/main.js' }, files)).toBe('dist/main.js');
    expect(resolveMainEntry({ main: 'dist/main' }, files)).toBe('dist/main.js');
    expect(resolveMainEntry({ main: 'out/app' }, files)).toBe('out/app/index.js');
    expect(resolveMainEntry({}, files)).toBe('index.js');
    expect(resolveMainEntry({ main: '../evil.js' }, files)).toBeNull();
    expect(resolveMainEntry({ main: 'missing.js' }, files)).toBeNull();
    expect(detectModuleFormat('esm/main.mjs', null)).toBe('esm');
    expect(detectModuleFormat('main.cjs', { type: 'module' })).toBe('cjs');
    expect(detectModuleFormat('dist/main.js', { type: 'module' })).toBe('esm');
    expect(detectModuleFormat('dist/main.js', {})).toBe('cjs');
    expect(runtimeEntryPath('dist/main.js')).toBe(`dist/${RUNTIME_FILE_NAME}`);
    expect(runtimeEntryPath('index.js')).toBe(RUNTIME_FILE_NAME);
  });
});

describe('isInternalUrl：只注入 App 內部頁面', () => {
  it.each([
    'file:///C:/Users/me/AppData/Local/Programs/Antigravity/resources/app.asar/dist/index.html',
    'file:///opt/Antigravity/resources/app.asar/dist/index.html',
    'app://-/index.html',
    'antigravity://workbench/index.html',
    'http://localhost:5173/',
    'https://localhost/',
    'http://LOCALHOST:3000/path',
    'http://127.0.0.1:8080/index.html',
    'http://[::1]:9000/',
    'blob:file:///opt/app/abc',
    'blob:http://localhost:5173/uuid',
  ])('允許：%s', (url) => {
    expect(isInternalUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'http://github.com/Carinoasd/antigravity-i18n',
    'HTTPS://ACCOUNTS.GOOGLE.COM/',
    'https://localhost.evil.com/',
    'http://127.0.0.1.nip.io/',
    'http://10.0.0.5/',
    'https://antigravity.google/',
    'devtools://devtools/bundled/inspector.html',
    'chrome://gpu',
    'chrome-extension://abc/popup.html',
    'chrome-error://chromewebdata/',
    'about:blank',
    'view-source:file:///x.html',
    'data:text/html,<b>Settings</b>',
    'javascript:alert(1)',
    'blob:https://example.com/uuid',
    '',
    'not a url',
  ])('略過：%s', (url) => {
    expect(isInternalUrl(url)).toBe(false);
  });

  it('內嵌進掛鉤的版本與匯出的函式一致', () => {
    const hook = injectHook('foo();\n', 'cjs');
    expect(hook).toContain('var __agi18nIsInternalUrl = function (url)');
    expect(hook).not.toMatch(/\bisInternalUrl\(/);
  });
});

describe('主行程掛鉤：在模擬的 Electron 中實際執行', () => {
  type FakeWc = EventEmitter & { type: string; url: string; injected: string[] };
  let dir: string;
  let app: EventEmitter;
  const g = globalThis as Record<string, unknown>;

  const fakeWc = (type: string, url = 'file:///app/index.html'): FakeWc => {
    const wc = Object.assign(new EventEmitter(), { type, url, injected: [] as string[] }) as FakeWc;
    Object.assign(wc, {
      getType: () => wc.type,
      getURL: () => wc.url,
      executeJavaScript: (code: string) => {
        wc.injected.push(code);
        return Promise.resolve();
      },
    });
    return wc;
  };

  /** 掛鉤 v4 起，每個內部頁面都會另外注入背景設定面板 */
  const isPanel = (js: string): boolean => js.includes('__ANTIGRAVITY_I18N_PANEL__');
  const runtimes = (wc: FakeWc): string[] => wc.injected.filter((js) => !isPanel(js));
  const panels = (wc: FakeWc): string[] => wc.injected.filter(isPanel);

  /** 建立含假 electron 套件的暫存 App */
  function makeApp(format: 'cjs' | 'esm'): string {
    write(path.join(dir, 'node_modules', 'electron', 'package.json'), '{"name":"electron","main":"index.js"}');
    write(path.join(dir, 'node_modules', 'electron', 'index.js'), 'module.exports = { app: globalThis.__fakeElectronApp };');
    write(path.join(dir, 'dist', RUNTIME_FILE_NAME), script);
    const body = format === 'esm' ? `import { app } from 'electron';\nglobalThis.__mainRan = typeof app.on;\n` : `'use strict';\nglobalThis.__mainRan = typeof require('electron').app.on;\n`;
    return write(path.join(dir, 'dist', format === 'esm' ? 'main.mjs' : 'main.js'), injectHook(body, format));
  }

  let prevHome: string | undefined;
  beforeEach(() => {
    dir = tmpDir();
    app = new EventEmitter();
    g.__fakeElectronApp = app;
    delete g.__ANTIGRAVITY_I18N_HOOK__;
    delete g.__mainRan;
    delete process.env.ANTIGRAVITY_I18N_DISABLE;
    // 掛鉤會讀取背景圖設定：指向暫存目錄，避免讀到使用者真實的 ~/.antigravity-i18n
    prevHome = process.env.ANTIGRAVITY_I18N_HOME;
    process.env.ANTIGRAVITY_I18N_HOME = path.join(dir, 'tool-home');
  });
  afterEach(() => {
    rm(dir);
    delete g.__fakeElectronApp;
    delete g.__ANTIGRAVITY_I18N_HOOK__;
    delete process.env.ANTIGRAVITY_I18N_DISABLE;
    if (prevHome === undefined) delete process.env.ANTIGRAVITY_I18N_HOME;
    else process.env.ANTIGRAVITY_I18N_HOME = prevHome;
  });

  const exercise = (): { win: FakeWc; view: FakeWc; webview: FakeWc; devtools: FakeWc } => {
    const win = fakeWc('window');
    const view = fakeWc('browserView');
    const webview = fakeWc('webview');
    const devtools = fakeWc('window', 'devtools://devtools/bundled/inspector.html');
    for (const wc of [win, view, webview, devtools]) {
      app.emit('web-contents-created', {}, wc);
      wc.emit('dom-ready');
    }
    return { win, view, webview, devtools };
  };

  it('CJS：dom-ready 時注入 runtime，略過 webview 與 DevTools', () => {
    const main = makeApp('cjs');
    createRequire(main)(main);
    expect(g.__mainRan).toBe('function');
    const { win, view, webview, devtools } = exercise();
    expect(runtimes(win)).toEqual([script]);
    expect(runtimes(view)).toEqual([script]);
    expect(panels(win)).toHaveLength(1);
    expect(panels(view)).toHaveLength(1);
    expect(webview.injected).toEqual([]);
    expect(devtools.injected).toEqual([]);
    // 每次換頁（新的 dom-ready）都會重新注入
    win.emit('dom-ready');
    expect(runtimes(win)).toHaveLength(2);
  });

  it('略過外部 http/https 網站，只注入本機與內部 scheme', () => {
    const main = makeApp('cjs');
    createRequire(main)(main);
    const cases: [string, boolean][] = [
      ['https://example.com/', false],
      ['https://accounts.google.com/signin', false],
      ['http://localhost:5173/', true],
      ['http://127.0.0.1:3000/', true],
      ['http://[::1]:8080/', true],
      ['app://-/index.html', true],
      ['chrome-error://chromewebdata/', false],
      ['about:blank', false],
    ];
    for (const [url, expected] of cases) {
      // 內建瀏覽器的 WebContentsView 也是 browserView 類型
      const wc = fakeWc('browserView', url);
      app.emit('web-contents-created', {}, wc);
      wc.emit('dom-ready');
      // 內部頁面：翻譯 runtime + 背景面板；外部網站：什麼都不注入
      expect([url, runtimes(wc).length, panels(wc).length]).toEqual([url, expected ? 1 : 0, expected ? 1 : 0]);
    }
  });

  it('同一個視窗導向外部網站後不再注入', () => {
    const main = makeApp('cjs');
    createRequire(main)(main);
    const wc = fakeWc('window', 'file:///app/index.html');
    app.emit('web-contents-created', {}, wc);
    wc.emit('dom-ready');
    wc.url = 'https://example.com/';
    wc.emit('dom-ready');
    wc.url = 'file:///app/settings.html';
    wc.emit('dom-ready');
    expect(runtimes(wc)).toHaveLength(2);
    expect(panels(wc)).toHaveLength(2);
  });

  it('掛鉤 v6 內嵌完整的預設表與背景面板（含未翻譯掃描、收藏夾、外觀微調與五語切換）', () => {
    expect(HOOK_VERSION).toBe(6);
    for (const format of ['cjs', 'esm'] as const) {
      const hook = buildHook(format);
      expect(hook).toContain(`/* antigravity-i18n:hook-version ${HOOK_VERSION} */`);
      expect(hook).toContain('var __agi18nPresets = ');
      for (const [name, p] of Object.entries(BACKGROUND_PRESETS)) expect(hook).toContain(JSON.stringify(name) + ':' + JSON.stringify(p.image));
      expect(hook).toContain('bgCache, __agi18nPresets)');
      expect(hook).toContain('var __agi18nPanel = ');
      expect(hook).toContain('ANTIGRAVITY_I18N_NO_PANEL');
      expect(hook).toContain('掃描未翻譯英文');
      for (const p of Object.values(BACKGROUND_PRESETS)) expect(hook).toContain(JSON.stringify(p.label));
    }
  });

  it('預設 + 遮罩：dom-ready 時注入漸層背景，切換預設不需重新打包', async () => {
    const toolHome = process.env.ANTIGRAVITY_I18N_HOME!;
    setPreset(toolHome, 'aurora', { wsl: null, opacity: '0.2', tint: 'rgba(0,0,0,0.25)' });
    const main = makeApp('cjs');
    createRequire(main)(main);
    const win = fakeWc('window');
    app.emit('web-contents-created', {}, win);
    win.emit('dom-ready');
    expect(win.injected).toHaveLength(2);
    expect(win.injected[0]).toBe(script);
    const bg = win.injected[1]!;
    expect(bg).toContain('"kind":"preset"');
    expect(bg).toContain('"preset":"aurora"');
    expect(bg).toContain('"tint":"rgba(0,0,0,0.25)"');
    expect(bg).toContain(JSON.stringify(BACKGROUND_PRESETS.aurora!.image));

    // 在 jsdom 執行實際注入的兩段腳本：翻譯與背景圖都生效
    const dom = new JSDOM('<html><head></head><body><button id="b">Settings</button></body></html>', { runScripts: 'outside-only' });
    for (const js of win.injected) dom.window.eval(js);
    // 面板先讀取 IndexedDB（jsdom 沒有 → 降級），再套用 CLI 設定
    await (dom.window as unknown as { __ANTIGRAVITY_I18N_PANEL__: { ready: Promise<void> } }).__ANTIGRAVITY_I18N_PANEL__.ready;
    const d = dom.window.document;
    expect(d.getElementById('b')!.textContent).toBe('設定');
    const css = d.getElementById('antigravity-i18n-bg-style')!.textContent!;
    expect(css).toContain('linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.25)), radial-gradient(');
    expect(d.getElementById('antigravity-i18n-bg')!.getAttribute('data-preset')).toBe('aurora');

    // 換預設：下一次載入即生效，不需要重新打包 app.asar
    setPreset(toolHome, 'forest', { wsl: null, blur: '6' });
    win.emit('dom-ready');
    expect(win.injected[3]).toContain('"preset":"forest"');
    expect(win.injected[3]).toContain('"blur":6');
    // 不帶遮罩的預設：payload 不會殘留上一次的 tint
    expect(win.injected[3]).not.toContain('"tint":"');
  });

  it('從預設切回圖片', () => {
    const toolHome = process.env.ANTIGRAVITY_I18N_HOME!;
    setPreset(toolHome, 'nebula', { wsl: null });
    const main = makeApp('cjs');
    createRequire(main)(main);
    const win = fakeWc('window');
    app.emit('web-contents-created', {}, win);
    win.emit('dom-ready');
    expect(win.injected[1]).toContain('"preset":"nebula"');
    const img = write(path.join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]));
    setBackground(toolHome, img, { wsl: null });
    win.emit('dom-ready');
    expect(win.injected[3]).toContain('"kind":"image"');
    expect(win.injected[3]).toContain('url(\\"data:image/png;base64,');
  });

  it('ESM 掛鉤同樣支援預設', async () => {
    setPreset(process.env.ANTIGRAVITY_I18N_HOME!, 'midnight', { wsl: null });
    const main = makeApp('esm');
    await import(pathToFileURL(main).href);
    const win = fakeWc('window');
    app.emit('web-contents-created', {}, win);
    win.emit('dom-ready');
    expect(win.injected[1]).toContain('"preset":"midnight"');
  });

  it('ESM：以 import.meta.url 讀取 runtime 並注入', async () => {
    const main = makeApp('esm');
    await import(pathToFileURL(main).href);
    expect(g.__mainRan).toBe('function');
    const { win, webview } = exercise();
    expect(runtimes(win)).toEqual([script]);
    expect(panels(win)).toHaveLength(1);
    expect(webview.injected).toEqual([]);
  });

  it('設定 ANTIGRAVITY_I18N_DISABLE=1 時不掛鉤', () => {
    process.env.ANTIGRAVITY_I18N_DISABLE = '1';
    const main = makeApp('cjs');
    createRequire(main)(main);
    expect(g.__mainRan).toBe('function');
    expect(app.listenerCount('web-contents-created')).toBe(0);
  });

  it('找不到 runtime 檔案時不影響 App 啟動，也不注入翻譯', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const main = makeApp('cjs');
    fs.rmSync(path.join(dir, 'dist', RUNTIME_FILE_NAME));
    expect(() => createRequire(main)(main)).not.toThrow();
    expect(g.__mainRan).toBe('function');
    // 掛鉤仍會註冊（背景圖不依賴翻譯 runtime），但沒有可注入的翻譯腳本
    const { win } = exercise();
    expect(runtimes(win)).toEqual([]);
    // 背景面板不依賴翻譯 runtime，照常注入
    expect(panels(win)).toHaveLength(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('runtime not loaded'))).toBe(true);
    warn.mockRestore();
  });
});
