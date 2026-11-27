import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as asar from '@electron/asar';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommand } from '../src/commands/apply.js';
import { CliError, langLabel, parseApplyLang } from '../src/commands/common.js';
import { statusCommand } from '../src/commands/status.js';
import { openBrowser, parsePort, shouldLaunchUi } from '../src/commands/ui.js';
import { detectTarget } from '../src/config/paths.js';
import { wslToWindowsPath } from '../src/core/background.js';
import { TERMINOLOGY_RULES } from '../src/core/locales.js';
import { UI_TEXT } from '../src/ui/html.js';
import { electronAsarArchiver } from '../src/core/asar.js';
import { atomicCopy, atomicWrite, readManifest } from '../src/core/backup.js';
import { FileLockError, explainFsError, formatFsError, toFriendlyError } from '../src/core/errors.js';
import { applyTarget, restoreManifest } from '../src/core/patcher.js';
import { presetMeta } from '../src/core/presets.js';
import { HOOK_BEGIN, HOOK_VERSION, RUNTIME_FILE_NAME, buildHook, injectHook } from '../src/core/runtime.js';
import { applyBackground } from '../src/runtime/background.js';
import { antigravityI18nPanel, type PanelHandle } from '../src/runtime/panel.js';
import type { Detect } from '../src/ui/actions.js';
import { UI_HOST, startUiServer, type UiServer } from '../src/ui/server.js';
import type { DetectedTarget } from '../src/types.js';
import { packAsar, rm, tmpDir, write } from './helpers.js';

let dir: string;
let home: string;
let userHome: string;
beforeEach(() => {
  dir = tmpDir();
  home = path.join(dir, 'tool-home');
  userHome = path.join(dir, 'user-home');
});
afterEach(() => {
  vi.restoreAllMocks();
  rm(dir);
});

const MAIN = `'use strict';\nconst { app } = require('electron');\n`;

/** 模擬 Antigravity 2.0：asar 只有主行程與殼層 */
async function makeApp(name = 'Antigravity'): Promise<{ root: string; asarPath: string; target: DetectedTarget }> {
  const src = path.join(dir, `${name}-src`);
  write(path.join(src, 'package.json'), '{"name":"antigravity","main":"dist/main.js"}');
  write(path.join(src, 'dist', 'main.js'), MAIN);
  write(path.join(src, 'dist', 'menu.js'), 'Menu.buildFromTemplate([{label:"Settings"},{label:"Check for Updates"}]);');
  const root = path.join(dir, name);
  const asarPath = path.join(root, 'resources', 'app.asar');
  fs.mkdirSync(path.dirname(asarPath), { recursive: true });
  await packAsar(src, asarPath, {});
  return { root, asarPath, target: detectTarget('app', { customPath: root })! };
}

const readAsar = (asarPath: string, p: string): string => {
  asar.uncacheAll();
  return asar.extractFile(asarPath, p.split('/').join(path.sep)).toString('utf8');
};

function captureLog(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ').replace(/\x1b\[[0-9;]*m/g, '')));
  return lines;
}

function withToolHome<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.ANTIGRAVITY_I18N_HOME;
  process.env.ANTIGRAVITY_I18N_HOME = home;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.ANTIGRAVITY_I18N_HOME;
    else process.env.ANTIGRAVITY_I18N_HOME = prev;
  });
}

// ─────────────────────────────────────────────────────────────
// 1. 僅背景模式（--lang none）
// ─────────────────────────────────────────────────────────────

describe('僅背景模式（--lang none）', () => {
  it('parseApplyLang 接受 none，並有顯示名稱', () => {
    expect(parseApplyLang('none')).toBe('none');
    expect(parseApplyLang('NONE')).toBe('none');
    expect(parseApplyLang('zh-tw')).toBe('zh-TW');
    expect(() => parseApplyLang('ja')).toThrow(/none/);
    expect(langLabel('none')).toBe('僅背景模式（none）');
    expect(langLabel('zh-CN')).toBe('zh-CN');
  });

  it('patcher：不翻譯、不寫入翻譯 runtime，只掛載背景掛鉤；restore 逐位元組還原', async () => {
    const { asarPath, target } = await makeApp();
    const original = fs.readFileSync(asarPath);

    const dry = await applyTarget(target, { lang: 'none', dict: {}, toolHome: home, dryRun: true, toolVersion: '9' });
    expect(dry.status).toBe('dry-run');
    expect(dry.stats.totalHits).toBe(0);
    expect(dry.runtime).toMatchObject({ enabled: true, translation: false, entries: 0, mainEntry: 'dist/main.js' });
    expect(dry.asarEntries).toEqual([{ path: 'dist/main.js', kind: 'hook', hits: 0 }]);
    expect(fs.existsSync(home)).toBe(false);

    const r = await applyTarget(target, { lang: 'none', dict: {}, toolHome: home, toolVersion: '9' });
    expect(r.status).toBe('applied');
    // 選單維持英文
    expect(readAsar(asarPath, 'dist/menu.js')).toContain('label:"Settings"');
    const main = readAsar(asarPath, 'dist/main.js');
    expect(main).toContain(`hook-version ${HOOK_VERSION} background-only`);
    expect(main).not.toContain(`'./${RUNTIME_FILE_NAME}'`.replace(/'/g, '"'));
    expect(electronAsarArchiver.list(asarPath).some((e) => e.path.endsWith(RUNTIME_FILE_NAME))).toBe(false);

    const m = readManifest(r.manifestPath)!;
    expect(m.lang).toBe('none');
    expect(m.runtime).toEqual({ entries: 0, mainEntry: 'dist/main.js', hookVersion: HOOK_VERSION, translation: false });

    const res = await restoreManifest(r.manifestPath, { toolHome: home });
    expect(res.status).toBe('restored');
    expect(fs.readFileSync(asarPath)).toEqual(original);
  });

  it('patcher：從中文切換為僅背景模式（--force）時移除翻譯', async () => {
    const { asarPath, target } = await makeApp();
    await applyTarget(target, { lang: 'zh-TW', dict: { Settings: '設定' }, toolHome: home });
    expect(readAsar(asarPath, 'dist/menu.js')).toContain('label:"設定"');
    const again = await applyTarget(target, { lang: 'none', dict: {}, toolHome: home });
    expect(again).toMatchObject({ status: 'already-applied', previousLang: 'zh-TW' });
    await applyTarget(target, { lang: 'none', dict: {}, toolHome: home, force: true });
    expect(readAsar(asarPath, 'dist/menu.js')).toContain('label:"Settings"');
    expect(readAsar(asarPath, 'dist/main.js').split(HOOK_BEGIN)).toHaveLength(2);
  });

  it('patcher：只適用於 app；不能與 --no-runtime 併用', async () => {
    const ide = { id: 'ide', installRoot: dir, kind: 'files', files: [], source: 'custom', supported: true } as DetectedTarget;
    const r = await applyTarget(ide, { lang: 'none', dict: {}, toolHome: home });
    expect(r.status).toBe('unsupported');
    expect(r.warnings).toContain('僅背景模式（--lang none）只適用於 app 目標');
    const { target } = await makeApp();
    await expect(applyTarget(target, { lang: 'none', dict: {}, toolHome: home, runtime: false })).rejects.toThrow(/--no-runtime/);
  });

  it('掛鉤：不讀取翻譯 runtime（即使檔案存在），只注入背景面板', () => {
    const hook = buildHook('cjs', RUNTIME_FILE_NAME, { translate: false });
    expect(hook).not.toContain('readFileSync(path.join(__dirname');
    expect(buildHook('cjs')).toContain('readFileSync(path.join(__dirname');

    const appDir = path.join(dir, 'app');
    const g = globalThis as Record<string, unknown>;
    const app = new EventEmitter();
    g.__fakeElectronApp = app;
    delete g.__ANTIGRAVITY_I18N_HOOK__;
    const prev = process.env.ANTIGRAVITY_I18N_HOME;
    process.env.ANTIGRAVITY_I18N_HOME = home;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      write(path.join(appDir, 'node_modules', 'electron', 'index.js'), 'module.exports = { app: globalThis.__fakeElectronApp };');
      write(path.join(appDir, 'dist', RUNTIME_FILE_NAME), '/* should not load */');
      const main = write(path.join(appDir, 'dist', 'main.js'), injectHook(MAIN, 'cjs', RUNTIME_FILE_NAME, { translate: false }));
      createRequire(main)(main);
      const injected: string[] = [];
      const wc = Object.assign(new EventEmitter(), {
        getType: () => 'window',
        getURL: () => 'file:///app/index.html',
        executeJavaScript: (c: string) => (injected.push(c), Promise.resolve()),
      });
      app.emit('web-contents-created', {}, wc);
      wc.emit('dom-ready');
      expect(injected).toHaveLength(1);
      expect(injected[0]).toContain('__ANTIGRAVITY_I18N_PANEL__');
      expect(injected.join('')).not.toContain('should not load');
      expect(warn.mock.calls.some((c) => String(c[0]).includes('runtime not loaded'))).toBe(false);
    } finally {
      delete g.__fakeElectronApp;
      delete g.__ANTIGRAVITY_I18N_HOOK__;
      if (prev === undefined) delete process.env.ANTIGRAVITY_I18N_HOME;
      else process.env.ANTIGRAVITY_I18N_HOME = prev;
    }
  });

  it('面板：沒有翻譯層時隱藏中／英文切換，背景照常運作', async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only' });
    const cfg = { cli: null, presets: presetMeta(), maxBytes: 10 * 1024 * 1024, version: HOOK_VERSION };
    dom.window.eval(`(function(){var applyBackground=${applyBackground.toString()};(${antigravityI18nPanel.toString()})(applyBackground,${JSON.stringify(cfg)});})();`);
    const panel = (dom.window as unknown as { __ANTIGRAVITY_I18N_PANEL__: PanelHandle }).__ANTIGRAVITY_I18N_PANEL__;
    await panel.ready;
    const doc = dom.window.document;
    const row = (doc.querySelector('[data-agi18n="i18n"]') as HTMLInputElement).closest('label') as HTMLElement;
    expect(row.hidden).toBe(true);
    (doc.querySelector('[data-agi18n-preset="nebula"]') as HTMLButtonElement).click();
    expect(doc.getElementById('antigravity-i18n-bg')!.getAttribute('data-preset')).toBe('nebula');
  });

  it('CLI：status 顯示「僅背景模式（none）」；明確指定 ide 時拒絕', async () => {
    const { root } = await makeApp();
    const lines = captureLog();
    await withToolHome(async () => {
      expect(await applyCommand({ lang: 'none', target: 'app', path: root })).toBe(0);
      expect(lines.join('\n')).toContain('僅背景模式');
      lines.length = 0;
      await statusCommand({ target: 'app', path: root, home: userHome });
      const out = lines.join('\n');
      expect(out).toContain('已套用 僅背景模式（none）');
      expect(out).toContain('執行期注入層：僅背景模式');
      await expect(applyCommand({ lang: 'none', target: 'ide' })).rejects.toBeInstanceOf(CliError);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// 2. 本機 HTTP server
// ─────────────────────────────────────────────────────────────

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: Record<string, unknown>;
}

function request(srv: UiServer, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown; token?: string | null; host?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data: Buffer | string | undefined =
      opts.body === undefined ? undefined : Buffer.isBuffer(opts.body) || typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    const headers: Record<string, string> = { Host: opts.host ?? `${UI_HOST}:${srv.port}`, ...(opts.headers ?? {}) };
    if (opts.token !== null) headers['X-AGI18N-Token'] = opts.token ?? srv.token;
    if (data !== undefined) {
      // 一律帶 Content-Length：沒有長度資訊的 body 會被 server 當成下一個請求的開頭（格式錯誤）
      headers['Content-Type'] ??= 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data));
    }
    // agent: false：每個請求使用獨立連線，測試之間不共用 keep-alive socket
    const req = http.request({ host: UI_HOST, port: srv.port, method: opts.method ?? 'GET', path: opts.path ?? '/', headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          /* html */
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

describe('本機 HTTP server', () => {
  let srv: UiServer;
  /** 只認得測試指定的路徑，絕不掃描真實安裝位置 */
  const onlyCustom: Detect = (id, customPath) => (customPath ? detectTarget(id, { customPath }) : null);

  beforeEach(async () => {
    srv = await startUiServer({ toolHome: home, userHome, toolVersion: '9.9.9', detect: onlyCustom, wsl: null });
  });
  afterEach(async () => {
    await srv.close();
  });

  it('只監聽 127.0.0.1，Token 為 32-byte hex', () => {
    const addr = srv.server.address() as { address: string; port: number };
    expect(addr.address).toBe('127.0.0.1');
    expect(srv.url).toBe(`http://127.0.0.1:${srv.port}/`);
    expect(srv.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('每次啟動產生不同的 Token', async () => {
    const other = await startUiServer({ toolHome: home, userHome, toolVersion: '0', detect: onlyCustom });
    expect(other.token).not.toBe(srv.token);
    await other.close();
  });

  it('首頁內嵌 Token，並帶 CSP nonce 與防嵌入 header', async () => {
    const r = await request(srv, { token: null });
    expect(r.status).toBe(200);
    expect(r.text).toContain(`<meta name="agi18n-token" content="${srv.token}">`);
    const csp = String(r.headers['content-security-policy']);
    const nonce = /nonce-([^']+)/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(r.text).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.text).toContain('Ctrl+Alt+B');
  });

  it.each([
    ['GET', '/api/status'],
    ['POST', '/api/apply'],
    ['POST', '/api/restore'],
    ['POST', '/api/bg'],
    ['POST', '/api/rules'],
    ['POST', '/api/shutdown'],
  ])('%s %s：缺少或錯誤 Token 回傳 403', async (method, p) => {
    const body = method === 'GET' ? undefined : {};
    expect((await request(srv, { method, path: p, token: null, body })).status).toBe(403);
    expect((await request(srv, { method, path: p, token: 'a'.repeat(64), body })).status).toBe(403);
    expect((await request(srv, { method, path: p, token: srv.token.slice(0, 10), body })).status).toBe(403);
  });

  it('沒有長度資訊的請求 body 會被當成格式錯誤而關閉連線，server 仍可繼續服務', async () => {
    const malformed = await new Promise<string>((resolve) => {
      const req = http.request({ host: UI_HOST, port: srv.port, method: 'GET', path: '/api/status', headers: { Host: `${UI_HOST}:${srv.port}` }, agent: false }, (res) => {
        res.resume();
        res.on('end', () => resolve(String(res.statusCode)));
      });
      req.on('error', (e) => resolve(e.message));
      req.write('{}');
      req.end();
    });
    expect(malformed).toBe('403');
    expect((await request(srv, { path: '/api/status' })).status).toBe(200);
  });

  it.each([`localhost:PORT`, 'evil.example', `evil.example:PORT`, `127.0.0.1:1`, '0.0.0.0:PORT'])('錯誤 Host（%s）回傳 403，含首頁', async (host) => {
    const h = host.replace('PORT', String(srv.port));
    expect((await request(srv, { host: h, token: null })).status).toBe(403);
    expect((await request(srv, { host: h, path: '/api/status' })).status).toBe(403);
    expect((await request(srv, { host: h, method: 'POST', path: '/api/apply', body: { lang: 'zh-TW' } })).status).toBe(403);
  });

  it('跨站 Origin 回傳 403；同源 Origin 可通過', async () => {
    expect((await request(srv, { path: '/api/status', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await request(srv, { path: '/api/status', headers: { Origin: `http://127.0.0.1:${srv.port}` } })).status).toBe(200);
  });

  it('背景卡片：說明文字在路徑輸入框上方，並有「選擇電腦圖片」按鈕', async () => {
    const html = (await request(srv, { token: null })).text;
    const note = html.indexOf('data-i18n="bg.image"');
    expect(note).toBeGreaterThan(0);
    expect(note).toBeLessThan(html.indexOf('id="bg-path"'));
    expect(html).toContain('id="bg-pick"');
    expect(html).toContain('<input type="file" id="bg-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>');
  });

  it('不回應 CORS，且未知路徑回傳 404', async () => {
    const pre = await request(srv, { method: 'OPTIONS', path: '/api/apply', token: null, headers: { Origin: `http://127.0.0.1:${srv.port}` } });
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(srv, { path: '/api/nope' })).status).toBe(404);
    expect((await request(srv, { path: '/etc/passwd', token: null })).status).toBe(404);
  });

  it('不合法的 JSON 與參數回傳 400', async () => {
    expect((await request(srv, { method: 'POST', path: '/api/apply', body: '{bad' })).status).toBe(400);
    expect((await request(srv, { method: 'POST', path: '/api/apply', body: '[1]' })).status).toBe(400);
    const r = await request(srv, { method: 'POST', path: '/api/apply', body: { lang: 'ja' } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/zh-TW、zh-CN 或 none/);
    expect((await request(srv, { method: 'POST', path: '/api/apply', body: { lang: 'none', target: 'ide' } })).status).toBe(400);
    expect((await request(srv, { method: 'POST', path: '/api/bg', body: { action: 'explode' } })).status).toBe(400);
    expect((await request(srv, { method: 'POST', path: '/api/bg', body: { action: 'preset', preset: 'rainbow' } })).json.error).toMatch(/未知的預設/);
  });

  it('GET /api/status：列出目標、背景、規則與預設', async () => {
    const { root } = await makeApp();
    const r = await request(srv, { path: `/api/status?app=${encodeURIComponent(root)}` });
    expect(r.status).toBe(200);
    const s = r.json as { targets: { id: string; state: string; installRoot?: string }[]; hookVersion: number; presets: unknown[]; rules: unknown[]; version: string };
    expect(s.version).toBe('9.9.9');
    expect(s.hookVersion).toBe(HOOK_VERSION);
    expect(s.targets.map((t) => [t.id, t.state])).toEqual([
      ['app', 'not-applied'],
      ['ide', 'not-installed'],
      ['cli', 'not-installed'],
    ]);
    expect(s.targets[0]!.installRoot).toBe(root);
    expect(s.presets).toHaveLength(5);
    expect(s.rules).toHaveLength(2);
  });

  it('POST /api/apply：dry-run 不寫入任何檔案', async () => {
    const { root, asarPath } = await makeApp();
    const before = fs.readFileSync(asarPath);
    const r = await request(srv, { method: 'POST', path: '/api/apply', body: { lang: 'zh-TW', target: 'app', paths: { app: root }, dryRun: true } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, lang: 'zh-TW', dryRun: true });
    expect((r.json.results as { status: string }[])[0]!.status).toBe('dry-run');
    expect(fs.readFileSync(asarPath)).toEqual(before);
    expect(fs.existsSync(home)).toBe(false);
  });

  it('POST /api/apply（zh-TW、none）→ /api/status → /api/restore 逐位元組還原', async () => {
    const { root, asarPath } = await makeApp();
    const original = fs.readFileSync(asarPath);
    const paths = { app: root };

    const a = await request(srv, { method: 'POST', path: '/api/apply', body: { lang: 'zh-TW', target: 'all', paths } });
    expect(a.json.ok).toBe(true);
    expect((a.json.results as { id: string; status: string }[]).map((x) => [x.id, x.status])).toEqual([
      ['app', 'applied'],
      ['ide', 'not-installed'],
      ['cli', 'not-installed'],
    ]);
    expect(readAsar(asarPath, 'dist/menu.js')).toContain('label:"設定"');

    const b = await request(srv, { method: 'POST', path: '/api/apply', body: { lang: 'none', paths, force: true } });
    expect(b.json.ok).toBe(true);
    expect((b.json.results as { id: string; status: string }[]).map((x) => x.id)).toEqual(['app']);
    expect(readAsar(asarPath, 'dist/menu.js')).toContain('label:"Settings"');

    const s = await request(srv, { path: `/api/status?app=${encodeURIComponent(root)}` });
    expect((s.json.targets as { state: string; lang: string; backgroundOnly: boolean; hookVersion: number; backupOk: boolean }[])[0]).toMatchObject({
      state: 'applied',
      lang: 'none',
      backgroundOnly: true,
      hookVersion: HOOK_VERSION,
      backupOk: true,
    });

    const r = await request(srv, { method: 'POST', path: '/api/restore', body: { target: 'all' } });
    expect(r.json.ok).toBe(true);
    expect((r.json.results as { status: string }[])[0]!.status).toBe('restored');
    expect(fs.readFileSync(asarPath)).toEqual(original);
  });

  it('POST /api/bg：預設、開關與清除（寫入暫存的工具資料目錄）', async () => {
    const r = await request(srv, { method: 'POST', path: '/api/bg', body: { action: 'preset', preset: 'aurora', opacity: '0.2', blur: '4', tint: 'rgba(0,0,0,0.25)', mode: 'overlay' } });
    expect(r.status).toBe(200);
    expect(r.json.file).toBe(path.join(home, 'background.json'));
    const cfg = JSON.parse(fs.readFileSync(path.join(home, 'background.json'), 'utf8'));
    expect(cfg).toMatchObject({ kind: 'preset', preset: 'aurora', opacity: 0.2, blur: 4, tint: 'rgba(0,0,0,0.25)' });
    expect((await request(srv, { method: 'POST', path: '/api/bg', body: { action: 'off' } })).json.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(home, 'background.json'), 'utf8')).enabled).toBe(false);
    const bad = await request(srv, { method: 'POST', path: '/api/bg', body: { action: 'preset', preset: 'aurora', tint: 'red;}*{display:none' } });
    expect(bad.status).toBe(400);
    expect((await request(srv, { method: 'POST', path: '/api/bg', body: { action: 'clear' } })).json.removed).toEqual([path.join(home, 'background.json')]);
  });

  it('POST /api/rules：安裝與移除（寫入暫存的使用者家目錄）', async () => {
    const r = await request(srv, { method: 'POST', path: '/api/rules', body: { action: 'install', lang: 'zh-CN' } });
    expect(r.json.ok).toBe(true);
    expect(fs.existsSync(path.join(userHome, '.gemini', 'config', 'rules', 'language-zh-cn.md'))).toBe(true);
    const rm2 = await request(srv, { method: 'POST', path: '/api/rules', body: { action: 'remove' } });
    expect(rm2.json.ok).toBe(true);
    expect(fs.existsSync(path.join(userHome, '.gemini', 'config', 'rules', 'language-zh-cn.md'))).toBe(false);
  });

  it('POST /api/apply：檔案被鎖定時回傳處理步驟，且不留下半套用狀態', async () => {
    const { root, asarPath } = await makeApp();
    const original = fs.readFileSync(asarPath);
    const realRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === asarPath) throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
      return realRename(from, to);
    });
    const r = await request(srv, { method: 'POST', path: '/api/apply', body: { lang: 'zh-TW', target: 'app', paths: { app: root } } });
    expect(r.json.ok).toBe(false);
    const item = (r.json.results as { status: string; error: { code: string; steps: string[]; message: string } }[])[0]!;
    expect(item.status).toBe('error');
    expect(item.error.code).toBe('EBUSY');
    expect(item.error.steps.join('\n')).toMatch(/系統匣.*Quit/);
    expect(fs.readFileSync(asarPath)).toEqual(original);
    // 寫入失敗即回滾：不會留下 manifest（目錄甚至不會被建立）
    const manifests = path.join(home, 'manifests');
    expect(fs.existsSync(manifests) ? fs.readdirSync(manifests) : []).toEqual([]);
  });

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

  function upload(body: Buffer, opts: { token?: string | null; query?: string; type?: string } = {}): Promise<Res> {
    return request(srv, {
      method: 'POST',
      path: `/api/bg/upload${opts.query ? `?${opts.query}` : ''}`,
      token: opts.token,
      body,
      headers: { 'Content-Type': opts.type ?? 'image/png' },
    }).catch((e: Error) => ({ status: -1, headers: {}, text: e.message, json: {} }));
  }

  it('POST /api/bg/upload：儲存為 wallpaper.<ext> 並設為背景', async () => {
    const r = await upload(PNG, { query: 'opacity=0.3&blur=4&tint=rgba(0%2C0%2C0%2C0.25)&mode=underlay' });
    expect(r.status).toBe(200);
    const saved = path.join(home, 'wallpaper.png');
    expect(r.json).toMatchObject({ ok: true, action: 'upload', imagePath: saved });
    expect(fs.readFileSync(saved)).toEqual(PNG);
    const cfg = JSON.parse(fs.readFileSync(path.join(home, 'background.json'), 'utf8'));
    expect(cfg).toMatchObject({ kind: 'image', imagePath: saved, opacity: 0.3, blur: 4, tint: 'rgba(0,0,0,0.25)', mode: 'underlay' });

    // 換成 JPEG：舊的 wallpaper.png 被移除
    const j = await upload(JPEG, { type: 'image/jpeg' });
    expect(j.json.imagePath).toBe(path.join(home, 'wallpaper.jpg'));
    expect(fs.existsSync(saved)).toBe(false);
  });

  it('POST /api/bg/upload：以檔案內容判斷格式，不信任 Content-Type', async () => {
    const fake = await upload(Buffer.from('<svg onload=alert(1)>'), { type: 'image/png' });
    expect(fake.status).toBe(400);
    expect(fake.json.error).toContain('只支援 PNG、JPEG、WebP、GIF');
    expect((await upload(Buffer.alloc(0))).status).toBe(400);
    expect(fs.existsSync(path.join(home, 'background.json'))).toBe(false);
    const badParam = await upload(PNG, { query: 'tint=red%3B%7D' });
    expect(badParam.status).toBe(400);
    expect(fs.existsSync(path.join(home, 'wallpaper.png'))).toBe(false);
  });

  it('POST /api/bg/upload：分段慢速上傳超過上限時，client 仍能完整送出並讀到 413', async () => {
    const status = await new Promise<number | string>((resolve) => {
      const total = 10 * 1024 * 1024 + 64 * 1024;
      const req = http.request(
        {
          host: UI_HOST,
          port: srv.port,
          method: 'POST',
          path: '/api/bg/upload',
          agent: false,
          headers: { Host: `${UI_HOST}:${srv.port}`, 'X-AGI18N-Token': srv.token, 'Content-Type': 'image/png', 'Content-Length': String(total) },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', (e) => resolve(e.message));
      const chunk = Buffer.alloc(1024 * 1024);
      let sent = 0;
      const pump = (): void => {
        if (sent >= total) return void req.end();
        const n = Math.min(chunk.length, total - sent);
        sent += n;
        req.write(chunk.subarray(0, n), () => setTimeout(pump, 5));
      };
      pump();
    });
    expect(status).toBe(413);
  });

  it('POST /api/bg/upload：超過 10 MB 回傳 413；缺少或錯誤 Token 回傳 403', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    const r = await upload(big);
    // status -1 表示 client 端出錯（r.text 為錯誤訊息），一併顯示方便診斷
    expect([r.status, r.status === -1 ? r.text : '']).toEqual([413, '']);
    expect(r.json.error).toContain('10 MB');
    expect(fs.existsSync(path.join(home, 'wallpaper.png'))).toBe(false);
    expect((await upload(PNG, { token: null })).status).toBe(403);
    expect((await upload(PNG, { token: 'f'.repeat(64) })).status).toBe(403);
    // 之後仍可正常服務
    expect((await request(srv, { path: '/api/status' })).status).toBe(200);
  });

  it('GET /api/status：以結構化的 hintInfo 提示掛鉤狀態（控制台依語系顯示）', async () => {
    const { root } = await makeApp();
    const s1 = await request(srv, { path: `/api/status?app=${encodeURIComponent(root)}` });
    expect(s1.json.hintInfo).toEqual({ code: 'not-applied' });
    await request(srv, { method: 'POST', path: '/api/apply', body: { lang: 'none', paths: { app: root } } });
    const s2 = await request(srv, { path: `/api/status?app=${encodeURIComponent(root)}` });
    expect(s2.json.hintInfo).toBeNull();
    // 舊版掛鉤
    const mf = path.join(home, 'manifests', fs.readdirSync(path.join(home, 'manifests'))[0]!);
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.runtime.hookVersion = 3;
    fs.writeFileSync(mf, JSON.stringify(m));
    const s3 = await request(srv, { path: `/api/status?app=${encodeURIComponent(root)}` });
    expect(s3.json.hintInfo).toEqual({ code: 'old-hook', current: 3, latest: HOOK_VERSION });
  });

  it('POST /api/shutdown：回應後關閉 server', async () => {
    const r = await request(srv, { method: 'POST', path: '/api/shutdown' });
    expect(r.json).toMatchObject({ ok: true });
    await srv.closed;
    expect(srv.server.listening).toBe(false);
  });
});

describe('本機 HTTP server：WSL 上傳鏡像', () => {
  it('圖片一併複製到 Windows 家目錄，設定記錄那一份的 Windows 路徑', async () => {
    const winHome = path.join(dir, 'winhome');
    const srv = await startUiServer({ toolHome: home, userHome, toolVersion: '0', detect: () => null, wsl: { distro: 'Ubuntu', windowsHome: winHome } });
    try {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
      const r = await request(srv, { method: 'POST', path: '/api/bg/upload', body: png, headers: { 'Content-Type': 'image/png' } });
      expect(r.status).toBe(200);
      const mirrorImage = path.join(winHome, '.antigravity-i18n', 'wallpaper.png');
      expect(r.json.mirrorImage).toBe(mirrorImage);
      expect(fs.readFileSync(mirrorImage)).toEqual(png);
      const cfg = JSON.parse(fs.readFileSync(path.join(winHome, '.antigravity-i18n', 'background.json'), 'utf8'));
      // 真實 WSL 中鏡像位於 /mnt/c/... → C:\...；測試的暫存路徑則換算成 UNC（Windows runner 上無法換算）
      const expected = wslToWindowsPath(mirrorImage, 'Ubuntu');
      if (expected) {
        expect(cfg.windowsPath).toBe(expected);
        // 已複製到 Windows 側並記錄其路徑，不需要再提醒「圖片位於 WSL 檔案系統」
        expect((r.json.warnings as string[]).some((w) => w.includes('WSL 檔案系統'))).toBe(false);
      } else {
        // Windows runner 的暫存路徑本身就是 C:\...，不是 WSL 會出現的路徑，無法換算
        expect(cfg.windowsPath).toBeUndefined();
      }
    } finally {
      await srv.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 3. 友善的檔案鎖定錯誤
// ─────────────────────────────────────────────────────────────

describe('EBUSY / EPERM / EACCES 友善錯誤', () => {
  const err = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: oops`), { code, path: '/x/app.asar' });

  it('EBUSY：引導關閉系統匣的 Antigravity 並重試', () => {
    const e = explainFsError(err('EBUSY'), 'win32')!;
    expect(e.code).toBe('EBUSY');
    expect(e.title).toContain('使用中');
    expect(e.steps[0]).toMatch(/系統匣.*Quit/);
    expect(e.steps.at(-1)).toContain('重試');
  });

  it('EPERM（Windows）：系統管理員與防毒軟體', () => {
    const steps = explainFsError(err('EPERM'), 'win32')!.steps.join('\n');
    expect(steps).toContain('系統管理員');
    expect(steps).toContain('防毒');
  });

  it('EACCES（Linux / macOS）：sudo 或 --path', () => {
    const linux = explainFsError(err('EACCES'), 'linux')!.steps.join('\n');
    expect(linux).toContain('sudo');
    expect(linux).toContain('--path');
    expect(explainFsError(err('EACCES'), 'darwin')!.steps.join('\n')).toContain('/Applications');
  });

  it('其他錯誤不轉換', () => {
    expect(explainFsError(err('ENOENT'))).toBeNull();
    expect(explainFsError(new Error('x'))).toBeNull();
    expect(toFriendlyError(err('ENOENT'), '/a')).toBeInstanceOf(Error);
    expect(toFriendlyError(err('ENOENT'), '/a')).not.toBeInstanceOf(FileLockError);
    expect(formatFsError(new Error('plain'))).toBe('plain');
  });

  it('formatFsError：多行步驟格式', () => {
    const text = formatFsError(toFriendlyError(err('EBUSY'), '/x/app.asar', 'win32'));
    expect(text.split('\n')[0]).toBe('檔案正被 Antigravity 使用中，無法寫入（EBUSY）：/x/app.asar');
    expect(text).toContain('處理方式：');
    expect(text).toMatch(/\n {2}1\. 完全關閉 Antigravity/);
  });

  it('atomicWrite / atomicCopy 遇到鎖定時拋出 FileLockError，且不留下暫存檔', () => {
    const target = write(path.join(dir, 'f.txt'), 'old');
    const src = write(path.join(dir, 'src.txt'), 'new');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    });
    expect(() => atomicWrite(target, 'x')).toThrow(FileLockError);
    let caught: unknown;
    try {
      atomicCopy(src, target);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FileLockError);
    expect((caught as FileLockError).code).toBe('EBUSY');
    expect((caught as FileLockError).path).toBe(target);
    expect(fs.readdirSync(dir).filter((n) => n.includes('agi18n-tmp'))).toEqual([]);
    expect(fs.readFileSync(target, 'utf8')).toBe('old');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. 啟動行為
// ─────────────────────────────────────────────────────────────

describe('ui 指令與無參數啟動', () => {
  it('只有在互動式終端機、沒有子指令、非 CI 時才自動開啟控制台', () => {
    const argv = ['node', 'cli.js'];
    expect(shouldLaunchUi(argv, {}, true, true)).toBe(true);
    expect(shouldLaunchUi([...argv, '--help'], {}, true, true)).toBe(false);
    expect(shouldLaunchUi([...argv, '--version'], {}, true, true)).toBe(false);
    expect(shouldLaunchUi([...argv, 'status'], {}, true, true)).toBe(false);
    expect(shouldLaunchUi(argv, { CI: 'true' }, true, true)).toBe(false);
    expect(shouldLaunchUi(argv, { CI: '1' }, true, true)).toBe(false);
    expect(shouldLaunchUi(argv, { CI: 'false' }, true, true)).toBe(true);
    expect(shouldLaunchUi(argv, {}, false, true)).toBe(false);
    expect(shouldLaunchUi(argv, {}, true, false)).toBe(false);
  });

  it('parsePort', () => {
    expect(parsePort(undefined)).toBe(0);
    expect(parsePort('0')).toBe(0);
    expect(parsePort('8080')).toBe(8080);
    for (const bad of ['-1', '65536', '1.5', 'abc']) expect(() => parsePort(bad)).toThrow(/--port/);
  });

  it('openBrowser：依平台選擇指令，失敗時回傳 false', () => {
    const calls: [string, string[]][] = [];
    const spawner = (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      return { on: () => undefined, unref: () => undefined };
    };
    const url = 'http://127.0.0.1:1234/';
    // wsl 一律明確指定：在真實 WSL 環境中自動偵測會讀到 /proc/version
    expect(openBrowser(url, { platform: 'win32', wsl: false, spawner })).toBe(true);
    expect(openBrowser(url, { platform: 'darwin', wsl: false, spawner })).toBe(true);
    expect(openBrowser(url, { platform: 'linux', wsl: false, spawner })).toBe(true);
    expect(openBrowser(url, { platform: 'linux', wsl: true, spawner })).toBe(true);
    expect(calls).toEqual([
      ['cmd', ['/c', 'start', '', url]],
      ['open', [url]],
      ['xdg-open', [url]],
      ['cmd.exe', ['/c', 'start', '', url]],
    ]);
    const fail = (): never => {
      throw new Error('ENOENT');
    };
    expect(openBrowser(url, { platform: 'linux', wsl: false, spawner: fail })).toBe(false);
  });

  it('openBrowser：wsl 只影響 Linux（macOS / Windows 不受影響）', () => {
    const calls: string[] = [];
    const spawner = (cmd: string) => {
      calls.push(cmd);
      return { on: () => undefined, unref: () => undefined };
    };
    openBrowser('http://127.0.0.1:1/', { platform: 'darwin', wsl: true, spawner });
    openBrowser('http://127.0.0.1:1/', { platform: 'win32', wsl: true, spawner });
    expect(calls).toEqual(['open', 'cmd']);
  });
});

describe('控制台介面文字', () => {
  it('繁中 / 简中 / EN 的 key 完全一致', () => {
    const tw = Object.keys(UI_TEXT['zh-TW']).sort();
    expect(Object.keys(UI_TEXT['zh-CN']).sort()).toEqual(tw);
    expect(Object.keys(UI_TEXT.en).sort()).toEqual(tw);
    for (const code of ['not-applied', 'no-runtime', 'old-hook']) expect(tw).toContain(`hint.${code}`);
  });

  it('遵守繁簡用語規範（與 validate 相同的規則）', () => {
    const problems: string[] = [];
    for (const lang of ['zh-TW', 'zh-CN'] as const) {
      for (const [k, v] of Object.entries(UI_TEXT[lang])) {
        for (const rule of TERMINOLOGY_RULES[lang]) if (rule.pattern.test(v)) problems.push(`${lang} ${k}: ${v}（${rule.hint}）`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('提示文字引導點擊介面按鈕，而不是要求輸入指令', () => {
    for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) {
      for (const code of ['not-applied', 'no-runtime', 'old-hook']) {
        const text = UI_TEXT[lang][`hint.${code}`]!;
        expect(text).not.toMatch(/antigravity-i18n |--force|--lang/);
      }
    }
    expect(UI_TEXT.en['hint.old-hook']).toContain('{current}');
  });
});
