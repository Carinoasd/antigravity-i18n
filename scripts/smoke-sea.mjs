#!/usr/bin/env node
/**
 * 單檔執行檔冒煙測試（Release 與 PR CI 共用）。
 *
 *   node scripts/smoke-sea.mjs dist-sea/antigravity-i18n-linux-x64
 *   node scripts/smoke-sea.mjs -- node dist-sea/antigravity-i18n.cjs     # 測 esbuild bundle
 *
 * 全程使用暫存目錄（ANTIGRAVITY_I18N_HOME、--home、假的 app.asar），不碰真實安裝。
 *
 * 除了 --version / --help / validate / status / ui，也會用「編譯出的執行檔」對假的
 * app.asar 實際套用，再把 asar 中的掛鉤與 runtime 放進模擬的 Electron 與 jsdom 執行，
 * 確認 esbuild 打包後以 toString() 序列化的注入腳本仍然完全自足、能正常運作。
 */
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const { JSDOM } = require('jsdom');
const root = fileURLToPath(new URL('..', import.meta.url));

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
let cmd;
let baseArgs;
if (sep >= 0) {
  const [c, ...rest] = argv.slice(sep + 1);
  cmd = c === 'node' ? process.execPath : c;
  baseArgs = rest;
} else if (argv[0]) {
  cmd = path.resolve(argv[0]);
  baseArgs = [];
} else {
  console.error('用法：node scripts/smoke-sea.mjs <執行檔> 或 node scripts/smoke-sea.mjs -- node <bundle.cjs>');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agi18n-smoke-'));
const toolHome = path.join(tmp, 'tool-home');
const userHome = path.join(tmp, 'user-home');
const env = { ...process.env, ANTIGRAVITY_I18N_HOME: toolHome, NO_COLOR: '1', CI: 'true' };
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
let failures = 0;

function exec(args, opts = {}) {
  const r = spawnSync(cmd, [...baseArgs, ...args], { env, encoding: 'utf8', timeout: 60_000, ...opts });
  if (r.error) throw r.error;
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

async function step(name, fn) {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (e) {
    failures++;
    console.log(`✖ ${name}\n  ${String(e?.stack ?? e).split('\n').join('\n  ')}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function packAsar(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ws = await asar.createPackageWithOptions(src, dest, {});
  if (!ws.closed) await new Promise((r, j) => (ws.once('close', r), ws.once('error', j)));
}

/** 模擬 Antigravity 2.0：asar 只有主行程與殼層 */
async function makeFakeApp() {
  const src = path.join(tmp, 'app-src');
  fs.mkdirSync(path.join(src, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(src, 'package.json'), '{"name":"antigravity","main":"dist/main.js"}');
  fs.writeFileSync(path.join(src, 'dist', 'main.js'), "'use strict';\nconst { app } = require('electron');\nglobalThis.__smokeMainRan = true;\n");
  fs.writeFileSync(path.join(src, 'dist', 'menu.js'), 'Menu.buildFromTemplate([{label:"Settings"},{label:"Check for Updates"}]);');
  const appRoot = path.join(tmp, 'Antigravity');
  const asarPath = path.join(appRoot, 'resources', 'app.asar');
  await packAsar(src, asarPath);
  // 假的 Antigravity 執行檔（launch 用）：Linux 為會寫入標記檔的 shell 腳本；
  // Windows 複製 node.exe（stdin 為 ignore 時會立即結束）
  if (process.platform === 'win32') {
    fs.copyFileSync(process.execPath, path.join(appRoot, 'Antigravity.exe'));
  } else {
    const exe = path.join(appRoot, 'antigravity');
    fs.writeFileSync(exe, '#!/bin/sh\necho launched > "$AGI18N_SMOKE_MARKER"\n');
    fs.chmodSync(exe, 0o755);
  }
  return { appRoot, asarPath };
}

console.log(`單檔執行檔冒煙測試：${[cmd, ...baseArgs].join(' ')}\n暫存目錄：${tmp}\n`);

await step(`--version 為 ${version}`, () => {
  const r = exec(['--version']);
  assert(r.code === 0 && r.out.trim() === version, `exit=${r.code} out=${r.out}`);
});

await step('--help 列出主要指令', () => {
  const r = exec(['--help']);
  for (const c of ['apply', 'restore', 'bg', 'launch', 'shortcut', 'ui', 'validate']) assert(r.out.includes(c), `缺少 ${c}：${r.out}`);
});

await step('launch --help / shortcut --help', () => {
  const l = exec(['launch', '--help']);
  assert(l.code === 0 && l.out.includes('--no-reapply'), `exit=${l.code}\n${l.out}`);
  const s = exec(['shortcut', '--help']);
  assert(s.code === 0 && s.out.includes('install | remove | status'), `exit=${s.code}\n${s.out}`);
});

await step('不帶參數（非互動）顯示說明而不啟動 server', () => {
  const r = exec([], { timeout: 15_000 });
  assert(r.code === 0 && r.out.includes('Usage: antigravity-i18n'), `exit=${r.code} out=${r.out}`);
});

await step('validate 從內嵌詞庫讀取且通過', () => {
  const r = exec(['validate']);
  assert(r.code === 0, `exit=${r.code}\n${r.out}`);
  assert(r.out.includes('<embedded>/locales'), `未使用內嵌詞庫：${r.out}`);
  assert(/zh-TW：\d+ 條/.test(r.out) && r.out.includes('驗證通過'), r.out);
});

await step('status', () => {
  const r = exec(['status', '--home', userHome]);
  assert(r.code === 0 && r.out.includes('全域規則'), `exit=${r.code}\n${r.out}`);
});

const { appRoot, asarPath } = await makeFakeApp();
const original = fs.readFileSync(asarPath);

await step('apply --dry-run 不修改任何檔案', () => {
  const r = exec(['apply', '--lang', 'zh-TW', '--target', 'app', '--path', appRoot, '--dry-run']);
  assert(r.code === 0 && r.out.includes('執行期注入層'), `exit=${r.code}\n${r.out}`);
  assert(Buffer.compare(fs.readFileSync(asarPath), original) === 0, 'asar 被修改了');
  assert(!fs.existsSync(path.join(toolHome, 'manifests')), 'dry-run 寫入了 manifest');
});

await step('apply + bg preset，並在模擬的 Electron 與 jsdom 中執行注入腳本', async () => {
  const r = exec(['apply', '--lang', 'zh-TW', '--target', 'app', '--path', appRoot]);
  assert(r.code === 0, `apply exit=${r.code}\n${r.out}`);
  const b = exec(['bg', 'preset', 'aurora', '--opacity', '0.2']);
  assert(b.code === 0, `bg preset exit=${b.code}\n${b.out}`);

  // 取出執行檔寫入的掛鉤與 runtime
  asar.uncacheAll();
  const appDir = path.join(tmp, 'extracted');
  fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true });
  for (const f of ['dist/main.js', 'dist/antigravity-i18n-runtime.js']) {
    fs.writeFileSync(path.join(appDir, f), asar.extractFile(asarPath, f.split('/').join(path.sep)));
  }
  const main = fs.readFileSync(path.join(appDir, 'dist', 'main.js'), 'utf8');
  assert(main.includes('antigravity-i18n:runtime-hook:begin'), '主行程入口沒有掛鉤');
  assert(asar.extractFile(asarPath, path.join('dist', 'menu.js')).toString().includes('label:"設定"'), '靜態層沒有翻譯');

  // 模擬 Electron 主行程
  fs.mkdirSync(path.join(appDir, 'node_modules', 'electron'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'node_modules', 'electron', 'index.js'), 'module.exports = { app: globalThis.__smokeApp };');
  const app = new EventEmitter();
  globalThis.__smokeApp = app;
  process.env.ANTIGRAVITY_I18N_HOME = toolHome;
  createRequire(path.join(appDir, 'dist', 'main.js'))(path.join(appDir, 'dist', 'main.js'));
  assert(globalThis.__smokeMainRan === true, '主行程原本的程式沒有執行');
  const injected = [];
  const wc = Object.assign(new EventEmitter(), {
    getType: () => 'window',
    getURL: () => 'file:///app/index.html',
    executeJavaScript: (code) => (injected.push(code), Promise.resolve()),
  });
  app.emit('web-contents-created', {}, wc);
  wc.emit('dom-ready');
  assert(injected.length === 2, `應注入翻譯 runtime 與背景面板，實際 ${injected.length} 段`);
  for (const js of injected) assert(!/__name\(|__require\(|__toESM\(|__commonJS\(/.test(js), '注入腳本含有 esbuild helper');

  // 在 jsdom 中執行注入腳本
  const dom = new JSDOM('<!doctype html><html><head></head><body><button id="b">Settings</button></body></html>', { runScripts: 'outside-only' });
  for (const js of injected) dom.window.eval(js);
  await dom.window.__ANTIGRAVITY_I18N_PANEL__.ready;
  const doc = dom.window.document;
  assert(doc.getElementById('b').textContent === '設定', '翻譯 runtime 沒有生效');
  assert(doc.getElementById('antigravity-i18n-bg')?.getAttribute('data-preset') === 'aurora', '背景沒有生效');
  doc.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, altKey: true, bubbles: true }));
  assert(doc.getElementById('antigravity-i18n-panel').hidden === false, 'Ctrl+Alt+B 沒有開啟面板');

  // 面板的「掃描未翻譯英文」：已翻譯的 Settings 不列入，新的英文字串列入
  const extra = doc.createElement('span');
  extra.textContent = 'Smoke untranslated label';
  doc.body.appendChild(extra);
  doc.querySelector('[data-agi18n="scan"]').click();
  assert(doc.querySelector('[data-agi18n="scan-count"]').textContent === '找到 1 筆', `掃描結果：${doc.querySelector('[data-agi18n="scan-count"]').textContent}`);
  assert(JSON.parse(dom.window.__ANTIGRAVITY_I18N_PANEL__.scanJson())['Smoke untranslated label'] === '', 'scanJson 格式錯誤');

  // 四語 runtime：面板內免重整切換五語，切回英文時還原原文
  const ov = dom.window.__ANTIGRAVITY_I18N__;
  assert(ov.availableLangs.join(',') === 'zh-TW,zh-CN,ja,ko,en', `availableLangs：${ov.availableLangs}`);
  const btn = doc.getElementById('b');
  const seen = ['zh-CN', 'ja', 'ko', 'en', 'zh-TW'].map((l) => (ov.setLang(l), btn.textContent));
  assert(seen.join('|') === '设置|設定|설정|Settings|設定', `五語切換結果：${seen.join('|')}`);
  // 外觀微調：獨立的 <style>，開關立即注入／移除
  const panelHandle = dom.window.__ANTIGRAVITY_I18N_PANEL__;
  panelHandle.setPrefs({ cjkFont: true, glass: true });
  assert(doc.getElementById('antigravity-i18n-font') && doc.getElementById('antigravity-i18n-glass'), '外觀微調樣式沒有注入');
  panelHandle.setPrefs({ cjkFont: false, glass: false });
  assert(!doc.getElementById('antigravity-i18n-font') && !doc.getElementById('antigravity-i18n-glass'), '外觀微調樣式沒有移除');
});

// macOS 的 launch 會呼叫系統的 open -a，冒煙測試只在 Linux / Windows 實際啟動假的執行檔
await step('launch：偵測到 app.asar 被官方更新覆蓋時自動重新套用，再啟動 Antigravity', async () => {
  if (process.platform === 'darwin') return;
  const marker = path.join(tmp, 'launched.txt');
  const launchEnv = { ...env, AGI18N_SMOKE_MARKER: marker };
  const fresh = exec(['launch', '--path', appRoot], { env: launchEnv });
  assert(fresh.code === 0 && fresh.out.includes('已是最新修補狀態'), `exit=${fresh.code}\n${fresh.out}`);
  // 模擬官方自動更新：app.asar 被換回未翻譯的版本
  fs.writeFileSync(asarPath, original);
  const r = exec(['launch', '--path', appRoot], { env: launchEnv });
  assert(r.code === 0 && r.out.includes('已重新套用'), `exit=${r.code}\n${r.out}`);
  asar.uncacheAll();
  assert(asar.extractFile(asarPath, path.join('dist', 'menu.js')).toString().includes('label:"設定"'), '重新套用後沒有翻譯');
  if (process.platform !== 'win32') {
    for (let i = 0; i < 50 && !fs.existsSync(marker); i++) await new Promise((res) => setTimeout(res, 100));
    assert(fs.existsSync(marker), '沒有啟動假的 Antigravity 執行檔');
  }
});

await step('shortcut install / status / remove（寫入暫存目錄）', () => {
  const desk = path.join(tmp, 'desktop');
  const i = exec(['shortcut', 'install', '--dir', desk, '--path', appRoot, '--lang', 'zh-TW']);
  assert(i.code === 0 && i.out.includes('已建立捷徑'), `exit=${i.code}\n${i.out}`);
  const files = fs.readdirSync(desk);
  assert(files.length === 1, `捷徑檔案：${files.join(', ')}`);
  const file = path.join(desk, files[0]);
  if (process.platform !== 'win32') {
    const text = fs.readFileSync(file, 'utf8');
    assert(text.includes('launch --lang zh-TW --path'), `捷徑內容沒有 launch：\n${text}`);
    // 單檔執行檔直接執行自己；esbuild bundle 需要帶上 bundle 路徑
    for (const a of [cmd, ...baseArgs]) assert(text.includes(a), `捷徑沒有指向 ${a}：\n${text}`);
  }
  const st = exec(['shortcut', 'status', '--dir', desk, '--path', appRoot]);
  assert(st.code === 0 && st.out.includes('已建立'), `exit=${st.code}\n${st.out}`);
  const rm = exec(['shortcut', 'remove', '--dir', desk, '--path', appRoot]);
  assert(rm.code === 0 && fs.readdirSync(desk).length === 0, `exit=${rm.code}\n${rm.out}`);
});

await step('restore 逐位元組還原', () => {
  const r = exec(['restore', '--target', 'app']);
  assert(r.code === 0, `exit=${r.code}\n${r.out}`);
  assert(Buffer.compare(fs.readFileSync(asarPath), original) === 0, '還原後與原始檔不同');
});

await step('ui --no-open：首頁與關閉控制台', async () => {
  const child = spawn(cmd, [...baseArgs, 'ui', '--no-open', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待網址逾時：${output}`)), 30_000);
      const onData = (d) => {
        output += d;
        const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(output);
        if (m) {
          clearTimeout(timer);
          resolve(m[0]);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', (code) => reject(new Error(`ui 提早結束（${code}）：${output}`)));
    });
    const home = await fetch(url);
    const html = await home.text();
    assert(home.status === 200, `GET / ${home.status}`);
    const token = /name="agi18n-token" content="([0-9a-f]{64})"/.exec(html)?.[1];
    assert(token, '首頁沒有 Token');
    assert((await fetch(`${url}api/status`)).status === 403, '沒有 Token 的請求應回傳 403');
    const status = await fetch(`${url}api/status`, { headers: { 'X-AGI18N-Token': token } });
    assert(status.status === 200 && (await status.json()).ok === true, 'GET /api/status 失敗');
    const bye = await fetch(`${url}api/shutdown`, { method: 'POST', headers: { 'X-AGI18N-Token': token } });
    assert(bye.status === 200, `POST /api/shutdown ${bye.status}`);
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 15_000))]);
    assert(code === 0, `控制台關閉後的 exit code：${code}\n${output}`);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
