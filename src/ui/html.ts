/**
 * 圖形控制台的單一自足 HTML（內嵌 CSS / JS、零外部資源）。
 *
 * - Token 以 <meta> 內嵌，前端呼叫 API 時放進 `X-AGI18N-Token` header
 * - 腳本帶 CSP nonce；動態資料一律以 textContent 寫入，不使用 innerHTML
 * - 深淺色自適應（prefers-color-scheme），右上角可切換 繁中 / 简中 / EN
 */

export interface UiHtmlOptions {
  token: string;
  nonce: string;
  version: string;
  hookVersion: number;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 介面文字（繁中 / 简中 / EN） */
export const UI_TEXT: Record<'zh-TW' | 'zh-CN' | 'en', Record<string, string>> = {
  'zh-TW': {
    title: 'Antigravity 中文化控制台',
    subtitle: '不用背指令：在這裡套用中文化、自訂背景，或一鍵還原官方原版。',
    'status.title': '狀態總覽',
    'col.target': '目標',
    'col.path': '安裝路徑',
    'col.state': '狀態',
    'col.hook': '掛鉤',
    'col.backup': '備份',
    'paths.title': '自訂安裝路徑（偵測不到時填寫）',
    'paths.app': 'App（含 app.asar 的資料夾）',
    'paths.ide': 'IDE 安裝資料夾',
    'paths.cli': 'CLI（agy）路徑',
    refresh: '重新整理',
    'actions.title': '一鍵操作',
    'actions.zhTW': '套用繁體中文＋背景面板',
    'actions.zhCN': '套用簡體中文＋背景面板',
    'actions.none': '只要自訂背景與 Ctrl+Alt+B 面板（維持英文）',
    'actions.restore': '一鍵還原官方原版',
    'actions.dryRun': '只預覽（dry-run，不修改任何檔案）',
    'actions.note': '套用前會自動備份並校驗 SHA-256；請先完全關閉 Antigravity。套用後重新開啟 Antigravity 即生效。',
    'rules.title': '零侵入模式：中文 AI 全域規則',
    'rules.desc': '不修改任何安裝檔，只讓 AI 全程以中文回覆。',
    'rules.install': '安裝規則',
    'rules.remove': '移除規則',
    'bg.title': '背景快捷設定',
    'bg.hint': '套用後，在 Antigravity 裡按 Ctrl+Alt+B（macOS：⌘+⌥+B）就能免重開，直接選擇電腦裡的圖片。',
    'bg.opacity': '不透明度',
    'bg.blur': '模糊',
    'bg.tint': '遮罩',
    'bg.mode': '圖層',
    'bg.tint.none': '無',
    'bg.tint.dark25': '暗色 25%',
    'bg.tint.dark45': '深暗 45%',
    'bg.tint.navy35': '深藍 35%',
    'bg.mode.overlay': '覆蓋在介面上',
    'bg.mode.underlay': '放在介面底層',
    'bg.image': '或直接輸入電腦中的圖片路徑：',
    'bg.useImage': '使用此圖片',
    'bg.pick': '選擇電腦圖片…',
    'bg.tooLarge': '圖片超過 10 MB，請選擇較小的圖片',
    'bg.badType': '只支援 PNG、JPEG、WebP、GIF 圖片',
    'hint.not-applied': 'App 尚未套用，背景與 Ctrl+Alt+B 面板還不會生效。請按下方「一鍵操作」中任一個套用按鈕（只想要背景、維持英文，就選「只要自訂背景與 Ctrl+Alt+B 面板」）。',
    'hint.no-runtime': 'App 目前的套用方式沒有載入背景功能。請按下方「一鍵操作」中任一個套用按鈕，重新套用一次即可。',
    'hint.old-hook': 'App 的背景功能是舊版（v{current}，最新為 v{latest}），部分功能無法使用。請按下方「一鍵操作」中任一個套用按鈕，重新套用一次即可升級。',
    'bg.on': '啟用',
    'bg.off': '停用',
    'bg.clear': '清除設定',
    'bg.state.none': '背景：未設定',
    'bg.state.on': '背景：已啟用',
    'bg.state.off': '背景：已停用',
    'result.title': '執行結果',
    'result.empty': '尚未執行任何操作。',
    'lock.title': 'Antigravity 可能正在執行，鎖住了檔案',
    'lock.retry': '我已關閉 Antigravity，重試',
    shutdown: '關閉控制台',
    'shutdown.done': '控制台已關閉，可以關閉這個分頁了。',
    working: '執行中…',
    'state.not-installed': '未偵測到',
    'state.unsupported': '不支援',
    'state.not-applied': '原版（尚未套用）',
    'state.applied': '已套用',
    'state.outdated': '部分失效（可能是官方更新，建議重新套用）',
    'state.stale': '已還原為原版',
    'state.bgOnly': '僅背景模式',
    'backup.ok': '正常',
    'backup.bad': '異常',
    'r.applied': '已套用',
    'r.dry-run': '預覽完成',
    'r.already-applied': '已套用過（未變更）',
    'r.unsupported': '不支援',
    'r.no-match': '沒有命中任何字串',
    'r.not-installed': '未偵測到，略過',
    'r.skipped': '略過',
    'r.error': '失敗',
    'r.restored': '已還原',
    'r.already-original': '已是原版',
    'r.blocked': '已中止（未修改任何檔案）',
    'r.nothing': '沒有可還原的套用紀錄',
    'r.serverMsg': '詳細訊息以繁體中文顯示',
    'preset.aurora': '極光',
    'preset.nebula': '星雲',
    'preset.sunset': '霓虹夕陽',
    'preset.midnight': '深夜藍',
    'preset.forest': '靜謐森林',
  },
  'zh-CN': {
    title: 'Antigravity 汉化控制台',
    subtitle: '不用记命令：在这里应用汉化、自定义背景，或一键还原官方原版。',
    'status.title': '状态总览',
    'col.target': '目标',
    'col.path': '安装路径',
    'col.state': '状态',
    'col.hook': '挂钩',
    'col.backup': '备份',
    'paths.title': '自定义安装路径（检测不到时填写）',
    'paths.app': 'App（包含 app.asar 的文件夹）',
    'paths.ide': 'IDE 安装文件夹',
    'paths.cli': 'CLI（agy）路径',
    refresh: '刷新',
    'actions.title': '一键操作',
    'actions.zhTW': '应用繁体中文＋背景面板',
    'actions.zhCN': '应用简体中文＋背景面板',
    'actions.none': '只要自定义背景与 Ctrl+Alt+B 面板（保持英文）',
    'actions.restore': '一键还原官方原版',
    'actions.dryRun': '只预览（dry-run，不修改任何文件）',
    'actions.note': '应用前会自动备份并校验 SHA-256；请先完全关闭 Antigravity。应用后重新打开 Antigravity 即生效。',
    'rules.title': '零侵入模式：中文 AI 全局规则',
    'rules.desc': '不修改任何安装文件，只让 AI 全程用中文回复。',
    'rules.install': '安装规则',
    'rules.remove': '移除规则',
    'bg.title': '背景快捷设置',
    'bg.hint': '应用后，在 Antigravity 里按 Ctrl+Alt+B（macOS：⌘+⌥+B）即可免重启，直接选择电脑里的图片。',
    'bg.opacity': '不透明度',
    'bg.blur': '模糊',
    'bg.tint': '遮罩',
    'bg.mode': '图层',
    'bg.tint.none': '无',
    'bg.tint.dark25': '暗色 25%',
    'bg.tint.dark45': '深暗 45%',
    'bg.tint.navy35': '深蓝 35%',
    'bg.mode.overlay': '覆盖在界面上',
    'bg.mode.underlay': '放在界面底层',
    'bg.image': '或直接输入电脑中的图片路径：',
    'bg.useImage': '使用此图片',
    'bg.pick': '选择电脑图片…',
    'bg.tooLarge': '图片超过 10 MB，请选择较小的图片',
    'bg.badType': '只支持 PNG、JPEG、WebP、GIF 图片',
    'hint.not-applied': 'App 尚未应用，背景与 Ctrl+Alt+B 面板还不会生效。请点击下方「一键操作」中任一个应用按钮（只想要背景、保持英文，就选「只要自定义背景与 Ctrl+Alt+B 面板」）。',
    'hint.no-runtime': 'App 当前的应用方式没有加载背景功能。请点击下方「一键操作」中任一个应用按钮，重新应用一次即可。',
    'hint.old-hook': 'App 的背景功能是旧版（v{current}，最新为 v{latest}），部分功能无法使用。请点击下方「一键操作」中任一个应用按钮，重新应用一次即可升级。',
    'bg.on': '启用',
    'bg.off': '停用',
    'bg.clear': '清除设置',
    'bg.state.none': '背景：未设置',
    'bg.state.on': '背景：已启用',
    'bg.state.off': '背景：已停用',
    'result.title': '执行结果',
    'result.empty': '尚未执行任何操作。',
    'lock.title': 'Antigravity 可能正在运行，锁住了文件',
    'lock.retry': '我已关闭 Antigravity，重试',
    shutdown: '关闭控制台',
    'shutdown.done': '控制台已关闭，可以关闭这个标签页了。',
    working: '执行中…',
    'state.not-installed': '未检测到',
    'state.unsupported': '不支持',
    'state.not-applied': '原版（尚未应用）',
    'state.applied': '已应用',
    'state.outdated': '部分失效（可能是官方更新，建议重新应用）',
    'state.stale': '已还原为原版',
    'state.bgOnly': '仅背景模式',
    'backup.ok': '正常',
    'backup.bad': '异常',
    'r.applied': '已应用',
    'r.dry-run': '预览完成',
    'r.already-applied': '已应用过（未变更）',
    'r.unsupported': '不支持',
    'r.no-match': '没有命中任何字符串',
    'r.not-installed': '未检测到，跳过',
    'r.skipped': '跳过',
    'r.error': '失败',
    'r.restored': '已还原',
    'r.already-original': '已是原版',
    'r.blocked': '已中止（未修改任何文件）',
    'r.nothing': '没有可还原的应用记录',
    'r.serverMsg': '详细信息以繁体中文显示',
    'preset.aurora': '极光',
    'preset.nebula': '星云',
    'preset.sunset': '霓虹夕阳',
    'preset.midnight': '深夜蓝',
    'preset.forest': '静谧森林',
  },
  en: {
    title: 'Antigravity i18n Control Panel',
    subtitle: 'No commands to remember: apply Chinese localization, customize the background, or restore the official build in one click.',
    'status.title': 'Status',
    'col.target': 'Target',
    'col.path': 'Install path',
    'col.state': 'State',
    'col.hook': 'Hook',
    'col.backup': 'Backup',
    'paths.title': 'Custom install paths (if not detected)',
    'paths.app': 'App (folder containing app.asar)',
    'paths.ide': 'IDE install folder',
    'paths.cli': 'CLI (agy) path',
    refresh: 'Refresh',
    'actions.title': 'One-click actions',
    'actions.zhTW': 'Apply Traditional Chinese + background panel',
    'actions.zhCN': 'Apply Simplified Chinese + background panel',
    'actions.none': 'Background & Ctrl+Alt+B panel only (keep English)',
    'actions.restore': 'Restore the official build',
    'actions.dryRun': 'Preview only (dry-run, no files are changed)',
    'actions.note': 'Originals are backed up and SHA-256 verified first. Quit Antigravity completely before applying, then reopen it.',
    'rules.title': 'Zero-touch mode: Chinese AI global rule',
    'rules.desc': 'Changes no installed files; only makes the AI reply in Chinese.',
    'rules.install': 'Install rule',
    'rules.remove': 'Remove rule',
    'bg.title': 'Background',
    'bg.hint': 'After applying, press Ctrl+Alt+B (macOS: ⌘+⌥+B) inside Antigravity to pick any image from your computer — no restart needed.',
    'bg.opacity': 'Opacity',
    'bg.blur': 'Blur',
    'bg.tint': 'Tint',
    'bg.mode': 'Layer',
    'bg.tint.none': 'None',
    'bg.tint.dark25': 'Dark 25%',
    'bg.tint.dark45': 'Darker 45%',
    'bg.tint.navy35': 'Navy 35%',
    'bg.mode.overlay': 'Over the UI',
    'bg.mode.underlay': 'Under the UI',
    'bg.image': 'Or type an image path on this computer:',
    'bg.useImage': 'Use this image',
    'bg.pick': 'Choose an image…',
    'bg.tooLarge': 'The image is larger than 10 MB — please choose a smaller one',
    'bg.badType': 'Only PNG, JPEG, WebP and GIF images are supported',
    'hint.not-applied': 'The App is not patched yet, so the background and the Ctrl+Alt+B panel are not active. Click any apply button under "One-click actions" below (pick "Background & Ctrl+Alt+B panel only" to keep the English UI).',
    'hint.no-runtime': 'The App was patched without the background hook. Click any apply button under "One-click actions" below to re-apply.',
    'hint.old-hook': 'The App has an old background hook (v{current}, latest is v{latest}), so some features are unavailable. Click any apply button under "One-click actions" below to upgrade.',
    'bg.on': 'Enable',
    'bg.off': 'Disable',
    'bg.clear': 'Clear',
    'bg.state.none': 'Background: not set',
    'bg.state.on': 'Background: enabled',
    'bg.state.off': 'Background: disabled',
    'result.title': 'Result',
    'result.empty': 'Nothing has been run yet.',
    'lock.title': 'Antigravity seems to be running and is locking the files',
    'lock.retry': 'I quit Antigravity — retry',
    shutdown: 'Close control panel',
    'shutdown.done': 'The control panel has stopped. You can close this tab.',
    working: 'Working…',
    'state.not-installed': 'Not detected',
    'state.unsupported': 'Unsupported',
    'state.not-applied': 'Official (not applied)',
    'state.applied': 'Applied',
    'state.outdated': 'Partially outdated (probably an official update — re-apply)',
    'state.stale': 'Restored to official',
    'state.bgOnly': 'Background only',
    'backup.ok': 'OK',
    'backup.bad': 'Problem',
    'r.applied': 'Applied',
    'r.dry-run': 'Preview done',
    'r.already-applied': 'Already applied (unchanged)',
    'r.unsupported': 'Unsupported',
    'r.no-match': 'No strings matched',
    'r.not-installed': 'Not detected, skipped',
    'r.skipped': 'Skipped',
    'r.error': 'Failed',
    'r.restored': 'Restored',
    'r.already-original': 'Already official',
    'r.blocked': 'Aborted (no files changed)',
    'r.nothing': 'Nothing to restore',
    'r.serverMsg': 'Detailed messages are shown in Traditional Chinese',
    'preset.aurora': 'Aurora',
    'preset.nebula': 'Nebula',
    'preset.sunset': 'Neon Sunset',
    'preset.midnight': 'Midnight',
    'preset.forest': 'Forest',
  },
};

const CSS = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#1d1f23;--muted:#6b7280;--line:#e3e5e8;--accent:#2563eb;--accent-fg:#fff;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--code:#f1f3f5}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--card:#1c1d21;--fg:#e8e8ea;--muted:#9a9ca3;--line:#2c2e33;--accent:#5b8cff;--accent-fg:#0b0c0e;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--code:#24262b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC","PingFang SC",sans-serif}
header{display:flex;align-items:center;gap:12px;padding:18px 24px 6px;max-width:1080px;margin:0 auto}
header h1{font-size:20px;margin:0}
.ver{color:var(--muted);font-size:12px}
.langs{margin-left:auto;display:flex;gap:4px}
.langs button[aria-pressed=true]{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.sub{max-width:1080px;margin:0 auto;padding:0 24px 8px;color:var(--muted)}
main{max-width:1080px;margin:0 auto;padding:8px 24px 24px;display:grid;gap:16px;grid-template-columns:1fr 1fr}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.wide{grid-column:1/-1}
h2{font-size:15px;margin:0 0 10px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{white-space:nowrap}
td.nowrap{white-space:nowrap}
td.path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;word-break:break-all}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;padding:7px 12px}
button:hover{border-color:var(--accent)}
button:disabled{opacity:.55;cursor:progress}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
button.danger{color:var(--bad)}
.stack{display:grid;gap:8px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
label.ctl{display:flex;align-items:center;gap:8px}
label.ctl span{min-width:64px;color:var(--muted)}
input[type=text]{flex:1;min-width:180px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
select{padding:5px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
details{margin-top:10px}
summary{cursor:pointer;color:var(--muted)}
.presets{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0}
.preset{height:72px;border-radius:10px;border:1px solid var(--line);color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8);display:flex;align-items:flex-end;padding:6px 8px;font-size:12px}
.hint{background:var(--code);border-radius:8px;padding:8px 10px;color:var(--fg)}
.note{color:var(--muted);font-size:12px}
#lock{border:1px solid var(--warn);border-radius:10px;padding:10px 14px;margin-bottom:10px}
#lock h3{margin:0 0 6px;font-size:14px;color:var(--warn)}
#log{background:var(--code);border-radius:8px;padding:10px 12px;margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:320px;overflow:auto}
footer{max-width:1080px;margin:0 auto;padding:0 24px 32px;display:flex;justify-content:flex-end}
[hidden]{display:none !important}
@media (max-width:820px){main{grid-template-columns:1fr}.presets{grid-template-columns:repeat(3,1fr)}}
`;

/** 前端腳本：刻意不用 template literal，避免與外層 TS 字串混淆 */
const SCRIPT = `
(function () {
  'use strict';
  var TEXT = __TEXT__;
  var TOKEN = document.querySelector('meta[name="agi18n-token"]').getAttribute('content');
  var LOCK = ['EBUSY', 'EPERM', 'EACCES'];
  var lang = 'zh-TW';
  var last = null;
  var status = null;
  try {
    var saved = localStorage.getItem('agi18n-ui-lang');
    if (saved && TEXT[saved]) lang = saved;
    else if (/^zh-(CN|SG|Hans)/i.test(navigator.language)) lang = 'zh-CN';
    else if (!/^zh/i.test(navigator.language)) lang = 'en';
  } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function t(key) { return (TEXT[lang] && TEXT[lang][key]) || TEXT['zh-TW'][key] || key; }
  function presetLabel(name, fallback) {
    var key = 'preset.' + name;
    return (TEXT[lang] && TEXT[lang][key]) || fallback || name;
  }
  function sep() { return lang === 'en' ? ': ' : '：'; }
  function paren(s) { return lang === 'en' ? ' (' + s + ')' : '（' + s + '）'; }

  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (cls) n.className = cls;
    return n;
  }

  function applyLang() {
    document.documentElement.lang = lang === 'en' ? 'en' : lang === 'zh-CN' ? 'zh-Hans' : 'zh-Hant';
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    document.querySelectorAll('.langs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
    document.querySelectorAll('#presets .preset').forEach(function (b) { b.textContent = presetLabel(b.getAttribute('data-preset'), b.getAttribute('data-label')); });
    if (status) renderStatus(status);
  }

  function paths() {
    var out = {};
    ['app', 'ide', 'cli'].forEach(function (k) { var v = $('path-' + k).value.trim(); if (v) out[k] = v; });
    return out;
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { 'X-AGI18N-Token': TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }).then(function (j) { j.httpStatus = r.status; return j; });
    });
  }

  function log(lines, cls) {
    var box = $('log');
    if (box.getAttribute('data-empty') === '1') { box.textContent = ''; box.removeAttribute('data-empty'); }
    var stamp = new Date().toLocaleTimeString();
    [].concat(lines).forEach(function (line, i) {
      var div = el('div', (i === 0 ? '[' + stamp + '] ' : '    ') + line, cls);
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  function showLock(err) {
    var box = $('lock');
    if (!err || LOCK.indexOf(err.code) < 0) { box.hidden = true; return; }
    var ol = $('lock-steps');
    ol.textContent = '';
    (err.steps || []).forEach(function (s) { ol.appendChild(el('li', s)); });
    $('lock-msg').textContent = err.message;
    box.hidden = false;
  }

  function setBusy(on) {
    document.querySelectorAll('button[data-act], #refresh').forEach(function (b) { b.disabled = on; });
  }

  function run(label, fn) {
    last = { label: label, fn: fn };
    setBusy(true);
    log(label + ' — ' + t('working'), 'muted');
    return fn().then(function (res) {
      report(res);
      return refresh();
    }).catch(function (e) {
      log(String(e && e.message || e), 'bad');
    }).then(function () { setBusy(false); });
  }

  function report(res) {
    var lockErr = null;
    if (res.error && !res.results) {
      log(res.error, 'bad');
      if (res.detail) lockErr = res.detail;
    }
    (res.results || []).forEach(function (r) {
      var cls = r.status === 'error' || r.status === 'blocked' ? 'bad' : r.status === 'applied' || r.status === 'restored' || r.status === 'dry-run' ? 'ok' : 'muted';
      var lines = ['[' + r.id + '] ' + t('r.' + r.status) + (r.installRoot ? '  ' + r.installRoot : '')];
      if (r.stats && res.lang !== 'none' && r.status !== 'not-installed' && r.status !== 'skipped') {
        lines.push(r.stats.matchedKeys + '/' + r.stats.totalKeys + ' · ' + r.stats.totalHits + ' · ' + Math.round(r.stats.coverage * 1000) / 10 + '%');
      }
      if (r.runtime && r.runtime.enabled) {
        lines.push(r.runtime.translation === false ? 'runtime: background + Ctrl+Alt+B panel' : 'runtime: ' + r.runtime.entries + ' entries @ ' + r.runtime.mainEntry);
      }
      (r.warnings || []).forEach(function (w) { lines.push('⚠ ' + w); });
      // 還原結果的 files 是陣列（套用結果的 files 是檔案數量）
      if (Array.isArray(r.files)) {
        r.files.forEach(function (f) { lines.push((f.action === 'restored' ? '✔ ' : f.action === 'blocked' ? '✖ ' : '· ') + f.path + (f.reason ? '（' + f.reason + '）' : '')); });
      }
      if (r.error) {
        lines.push('✖ ' + r.error.message);
        if (LOCK.indexOf(r.error.code) >= 0) lockErr = r.error;
      }
      log(lines, cls);
    });
    if (res.results && res.results.length === 0) log(t('r.nothing'), 'muted');
    if (res.action) {
      var lines2 = ['bg ' + res.action + ' ✔'];
      if (res.imagePath) lines2.push(res.imagePath);
      if (res.mirrorImage) lines2.push(res.mirrorImage);
      if (res.file) lines2.push(res.file);
      if (res.mirror) lines2.push(res.mirror);
      (res.warnings || []).forEach(function (w) { lines2.push('⚠ ' + w); });
      if (res.result && res.result.path) lines2.push(res.result.path);
      if (res.result && res.result.removed) res.result.removed.forEach(function (p) { lines2.push('✔ ' + p); });
      log(lines2, res.ok === false ? 'warn' : 'ok');
    }
    showLock(lockErr);
  }

  function stateText(r) {
    if (r.state === 'applied' && r.backgroundOnly) return t('state.applied') + sep() + t('state.bgOnly');
    if (r.state === 'applied' && r.lang) return t('state.applied') + sep() + r.lang;
    return t('state.' + r.state) + (r.reason ? paren(r.reason) : '');
  }

  /** 掛鉤提示依介面語系顯示，並引導使用者點擊下方的套用按鈕 */
  function hintText(s) {
    var h = s.hintInfo;
    if (!h) return '';
    if (h.code === 'not-applied') {
      // 沒偵測到 App、也沒有設定背景時不提示，避免誤導
      var app = s.targets.filter(function (r) { return r.id === 'app'; })[0];
      var hasBg = s.background && s.background.config;
      if ((!app || app.state === 'not-installed') && !hasBg) return '';
    }
    return t('hint.' + h.code).replace('{current}', String(h.current || '')).replace('{latest}', String(h.latest || ''));
  }

  function renderStatus(s) {
    status = s;
    var body = $('targets');
    body.textContent = '';
    s.targets.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', r.id.toUpperCase(), 'nowrap'));
      tr.appendChild(el('td', r.installRoot || '—', 'path'));
      var cls = r.state === 'applied' ? 'ok' : r.state === 'outdated' ? 'warn' : r.state === 'not-installed' || r.state === 'unsupported' ? 'muted' : '';
      tr.appendChild(el('td', stateText(r), cls));
      tr.appendChild(el('td', r.hookVersion ? 'v' + r.hookVersion + (r.hookVersion < s.hookVersion ? ' → v' + s.hookVersion : '') : '—', 'nowrap' + (r.hookVersion && r.hookVersion < s.hookVersion ? ' warn' : '')));
      tr.appendChild(el('td', r.backupOk === undefined ? '—' : r.backupOk ? t('backup.ok') : t('backup.bad'), 'nowrap' + (r.backupOk === false ? ' bad' : '')));
      body.appendChild(tr);
    });
    var bg = s.background;
    var bgText = bg.error ? bg.error : !bg.config ? t('bg.state.none') : (bg.config.enabled ? t('bg.state.on') : t('bg.state.off')) + ' · ' + (bg.config.kind === 'preset' ? bg.config.preset : bg.config.imagePath);
    $('bg-state').textContent = bgText;
    var hint = hintText(s);
    $('hint').textContent = hint;
    $('hint').hidden = !hint;
    if ($('presets').childElementCount === 0) {
      s.presets.forEach(function (p) {
        var b = el('button', presetLabel(p.name, p.label), 'preset');
        b.setAttribute('data-act', 'preset');
        b.setAttribute('data-preset', p.name);
        b.setAttribute('data-label', p.label);
        b.title = p.description;
        b.style.backgroundImage = p.image;
        b.addEventListener('click', function () {
          run(presetLabel(p.name, p.label), function () {
            return api('POST', '/api/bg', { action: 'preset', preset: p.name, opacity: $('bg-opacity').value, blur: $('bg-blur').value, tint: $('bg-tint').value, mode: $('bg-mode').value });
          });
        });
        $('presets').appendChild(b);
      });
    }
  }

  function refresh() {
    var q = paths();
    var qs = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    return api('GET', '/api/status' + (qs ? '?' + qs : '')).then(function (s) {
      if (s.ok === false) { log(s.error || 'status failed', 'bad'); return; }
      renderStatus(s);
    });
  }

  function applyBody(l) {
    return { lang: l, target: l === 'none' ? 'app' : 'all', paths: paths(), dryRun: $('dry-run').checked, force: true };
  }

  var ACTIONS = {
    'apply-zh-TW': function () { return api('POST', '/api/apply', applyBody('zh-TW')); },
    'apply-zh-CN': function () { return api('POST', '/api/apply', applyBody('zh-CN')); },
    'apply-none': function () { return api('POST', '/api/apply', applyBody('none')); },
    restore: function () { return api('POST', '/api/restore', { target: 'all', paths: paths() }); },
    'rules-install': function () { return api('POST', '/api/rules', { action: 'install', lang: $('rules-lang').value }); },
    'rules-remove': function () { return api('POST', '/api/rules', { action: 'remove' }); },
    'bg-image': function () { return api('POST', '/api/bg', { action: 'set', imagePath: $('bg-path').value, opacity: $('bg-opacity').value, blur: $('bg-blur').value, tint: $('bg-tint').value, mode: $('bg-mode').value }); },
    'bg-on': function () { return api('POST', '/api/bg', { action: 'on' }); },
    'bg-off': function () { return api('POST', '/api/bg', { action: 'off' }); },
    'bg-clear': function () { return api('POST', '/api/bg', { action: 'clear' }); },
  };

  document.querySelectorAll('button[data-act]').forEach(function (b) {
    var act = b.getAttribute('data-act');
    if (!ACTIONS[act]) return;
    b.addEventListener('click', function () { run(b.textContent, ACTIONS[act]); });
  });
  document.querySelectorAll('.langs button').forEach(function (b) {
    b.addEventListener('click', function () {
      lang = b.getAttribute('data-lang');
      try { localStorage.setItem('agi18n-ui-lang', lang); } catch (e) {}
      applyLang();
    });
  });
  var MAX_UPLOAD = 10 * 1024 * 1024;
  var ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  function bgQuery() {
    return ['opacity', 'blur', 'tint', 'mode'].map(function (k) { return k + '=' + encodeURIComponent($('bg-' + k).value); }).join('&');
  }
  function upload(file) {
    return fetch('/api/bg/upload?' + bgQuery(), {
      method: 'POST',
      headers: { 'X-AGI18N-Token': TOKEN, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
    });
  }
  $('bg-pick').addEventListener('click', function () { $('bg-file').click(); });
  $('bg-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD) { log(t('bg.tooLarge'), 'bad'); return; }
    if (ACCEPT.indexOf(file.type) < 0) { log(t('bg.badType'), 'bad'); return; }
    run(t('bg.pick') + ' ' + file.name, function () { return upload(file); });
  });
  $('refresh').addEventListener('click', function () { refresh(); });
  $('lock-retry').addEventListener('click', function () { if (last) run(last.label, last.fn); });
  $('bg-opacity').addEventListener('input', function () { $('bg-opacity-v').textContent = Number(this.value).toFixed(2); });
  $('bg-blur').addEventListener('input', function () { $('bg-blur-v').textContent = this.value + 'px'; });
  $('shutdown').addEventListener('click', function () {
    api('POST', '/api/shutdown').then(function () {
      document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      log(t('shutdown.done'), 'ok');
    });
  });

  $('log').setAttribute('data-empty', '1');
  applyLang();
  $('log').textContent = t('result.empty');
  refresh();
})();
`;

export function renderUiHtml(opts: UiHtmlOptions): string {
  const script = SCRIPT.replace('__TEXT__', JSON.stringify(UI_TEXT).replace(/</g, '\\u003c'));
  const opt = (value: string, key: string): string => `<option value="${escapeHtml(value)}" data-i18n="${key}"></option>`;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="agi18n-token" content="${escapeHtml(opts.token)}">
<title>Antigravity i18n</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1 data-i18n="title"></h1>
  <span class="ver">v${escapeHtml(opts.version)} · hook v${opts.hookVersion}</span>
  <nav class="langs" aria-label="Language">
    <button type="button" data-lang="zh-TW">繁中</button>
    <button type="button" data-lang="zh-CN">简中</button>
    <button type="button" data-lang="en">EN</button>
  </nav>
</header>
<p class="sub" data-i18n="subtitle"></p>
<main>
  <section class="card wide" id="status-card">
    <h2 data-i18n="status.title"></h2>
    <table>
      <thead><tr><th data-i18n="col.target"></th><th data-i18n="col.path"></th><th data-i18n="col.state"></th><th data-i18n="col.hook"></th><th data-i18n="col.backup"></th></tr></thead>
      <tbody id="targets"></tbody>
    </table>
    <div class="row"><span id="bg-state" class="muted"></span></div>
    <div id="hint" class="hint warn" hidden></div>
    <details>
      <summary data-i18n="paths.title"></summary>
      <div class="stack" style="margin-top:8px">
        <label class="ctl"><span data-i18n="paths.app"></span><input type="text" id="path-app" spellcheck="false"></label>
        <label class="ctl"><span data-i18n="paths.ide"></span><input type="text" id="path-ide" spellcheck="false"></label>
        <label class="ctl"><span data-i18n="paths.cli"></span><input type="text" id="path-cli" spellcheck="false"></label>
      </div>
    </details>
    <div class="row"><button type="button" id="refresh" data-i18n="refresh"></button></div>
  </section>

  <section class="card">
    <h2 data-i18n="actions.title"></h2>
    <div class="stack">
      <button type="button" class="primary" data-act="apply-zh-TW" data-i18n="actions.zhTW"></button>
      <button type="button" class="primary" data-act="apply-zh-CN" data-i18n="actions.zhCN"></button>
      <button type="button" data-act="apply-none" data-i18n="actions.none"></button>
      <button type="button" class="danger" data-act="restore" data-i18n="actions.restore"></button>
    </div>
    <label class="row"><input type="checkbox" id="dry-run"> <span data-i18n="actions.dryRun"></span></label>
    <p class="note" data-i18n="actions.note"></p>
    <h2 style="margin-top:16px" data-i18n="rules.title"></h2>
    <p class="note" data-i18n="rules.desc"></p>
    <div class="row">
      <select id="rules-lang"><option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option></select>
      <button type="button" data-act="rules-install" data-i18n="rules.install"></button>
      <button type="button" data-act="rules-remove" data-i18n="rules.remove"></button>
    </div>
  </section>

  <section class="card">
    <h2 data-i18n="bg.title"></h2>
    <p class="hint" data-i18n="bg.hint"></p>
    <div class="presets" id="presets"></div>
    <label class="ctl"><span data-i18n="bg.opacity"></span><input type="range" id="bg-opacity" min="0.01" max="1" step="0.01" value="0.12"><span id="bg-opacity-v">0.12</span></label>
    <label class="ctl"><span data-i18n="bg.blur"></span><input type="range" id="bg-blur" min="0" max="32" step="1" value="0"><span id="bg-blur-v">0px</span></label>
    <label class="ctl"><span data-i18n="bg.tint"></span><select id="bg-tint">${opt('none', 'bg.tint.none')}${opt('rgba(0,0,0,0.25)', 'bg.tint.dark25')}${opt('rgba(0,0,0,0.45)', 'bg.tint.dark45')}${opt('rgba(10,25,60,0.35)', 'bg.tint.navy35')}</select></label>
    <label class="ctl"><span data-i18n="bg.mode"></span><select id="bg-mode">${opt('overlay', 'bg.mode.overlay')}${opt('underlay', 'bg.mode.underlay')}</select></label>
    <div class="row">
      <button type="button" class="primary" id="bg-pick" data-act="bg-pick" data-i18n="bg.pick"></button>
      <input type="file" id="bg-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    </div>
    <p class="note" data-i18n="bg.image"></p>
    <div class="row"><input type="text" id="bg-path" spellcheck="false" aria-label="image path" placeholder="C:\\Users\\me\\Pictures\\wallpaper.jpg"><button type="button" data-act="bg-image" data-i18n="bg.useImage"></button></div>
    <div class="row">
      <button type="button" data-act="bg-on" data-i18n="bg.on"></button>
      <button type="button" data-act="bg-off" data-i18n="bg.off"></button>
      <button type="button" class="danger" data-act="bg-clear" data-i18n="bg.clear"></button>
    </div>
  </section>

  <section class="card wide" id="result-card">
    <h2 data-i18n="result.title"></h2>
    <div id="lock" hidden>
      <h3 data-i18n="lock.title"></h3>
      <div id="lock-msg" class="note"></div>
      <ol id="lock-steps"></ol>
      <button type="button" class="primary" id="lock-retry" data-i18n="lock.retry"></button>
    </div>
    <div id="log" role="log" aria-live="polite"></div>
    <p class="note" data-i18n="r.serverMsg"></p>
  </section>
</main>
<footer><button type="button" id="shutdown" data-i18n="shutdown"></button></footer>
<script nonce="${escapeHtml(opts.nonce)}">${script}</script>
</body>
</html>`;
}
