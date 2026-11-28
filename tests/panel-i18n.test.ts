import { IDBFactory } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { TERMINOLOGY_RULES } from '../src/core/locales.js';
import { PANEL_LANGS, PANEL_TEXT, panelI18n, panelLangFromNavigator } from '../src/core/panel-i18n.js';
import { presetMeta } from '../src/core/presets.js';
import { HOOK_VERSION, PANEL_MAX_BYTES, buildRuntimeScript } from '../src/core/runtime.js';
import { applyBackground } from '../src/runtime/background.js';
import type { OverlayHandle } from '../src/runtime/overlay.js';
import { antigravityI18nPanel, type PanelHandle } from '../src/runtime/panel.js';
import { UI_TEXT } from '../src/ui/html.js';

const FOUR = {
  'zh-CN': { Settings: '设置' },
  ja: { Settings: '設定' },
  ko: { Settings: '설정' },
};

type Win = JSDOM['window'] & { __ANTIGRAVITY_I18N_PANEL__: PanelHandle; __ANTIGRAVITY_I18N__?: OverlayHandle; indexedDB?: IDBFactory };

interface Booted {
  win: Win;
  doc: Document;
  panel: PanelHandle;
  $: (sel: string) => HTMLElement;
  text: (sel: string) => string;
}

/** 與主行程掛鉤相同的組合方式；i18n 為 undefined 時模擬沒有傳入文案表的呼叫端 */
async function boot(opts: { i18n?: unknown; runtime?: boolean; language?: string; idb?: IDBFactory } = {}): Promise<Booted> {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="app"><button id="btn">Settings</button></main></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  const win = dom.window as unknown as Win;
  if (opts.language) Object.defineProperty(win.navigator, 'language', { value: opts.language, configurable: true });
  if (opts.idb) win.indexedDB = opts.idb;
  if (opts.runtime) win.eval(buildRuntimeScript({ Settings: '設定' }, { lang: 'zh-TW', version: '0' }, FOUR));
  const cfg: Record<string, unknown> = { cli: null, presets: presetMeta(), maxBytes: PANEL_MAX_BYTES, version: HOOK_VERSION };
  if (opts.i18n !== undefined) cfg.i18n = opts.i18n;
  win.eval(`(function(){var applyBackground=${applyBackground.toString()};(${antigravityI18nPanel.toString()})(applyBackground,${JSON.stringify(cfg)});})();`);
  const panel = win.__ANTIGRAVITY_I18N_PANEL__;
  await panel.ready;
  const doc = win.document;
  const $ = (sel: string): HTMLElement => {
    const el = doc.querySelector(sel);
    if (!el) throw new Error(`not found: ${sel}`);
    return el as HTMLElement;
  };
  return { win, doc, panel, $, text: (sel) => $(sel).textContent ?? '' };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function choose(b: Booted, sel: string, value: string): void {
  const s = b.$(sel) as HTMLSelectElement;
  s.value = value;
  s.dispatchEvent(new b.win.Event('change', { bubbles: true }));
}

const options = (b: Booted, key: string): string[] => Array.from((b.$(`[data-agi18n="${key}"]`) as HTMLSelectElement).options).map((o) => o.textContent ?? '');

// ─────────────────────────────────────────────────────────────

describe('面板五語文案表（src/core/panel-i18n.ts）', () => {
  const base = Object.keys(PANEL_TEXT['zh-TW']).sort();
  const placeholders = (s: string): string[] => (s.match(/\{[A-Za-z]+\}/g) ?? []).sort();

  it('五語的 key 完全一致', () => {
    expect(PANEL_LANGS).toEqual(['zh-TW', 'zh-CN', 'ja', 'ko', 'en']);
    for (const l of PANEL_LANGS) expect(Object.keys(PANEL_TEXT[l]).sort(), l).toEqual(base);
    expect(base.length).toBeGreaterThan(80);
  });

  it('沒有空字串，佔位符的種類與數量與 zh-TW 相同', () => {
    const problems: string[] = [];
    for (const l of PANEL_LANGS) {
      for (const k of base) {
        const v = PANEL_TEXT[l][k]!;
        if (v.trim() === '') problems.push(`${l} ${k}: 空字串`);
        if (placeholders(v).join() !== placeholders(PANEL_TEXT['zh-TW'][k]!).join()) problems.push(`${l} ${k}: 佔位符 ${placeholders(v)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('zh-TW / zh-CN 逐條通過繁簡用語規範（與 validate 相同的規則）', () => {
    const problems: string[] = [];
    for (const l of ['zh-TW', 'zh-CN'] as const) {
      for (const [k, v] of Object.entries(PANEL_TEXT[l])) for (const r of TERMINOLOGY_RULES[l]) if (r.pattern.test(v)) problems.push(`${l} ${k}: ${v}（${r.hint}）`);
    }
    expect(problems).toEqual([]);
  });

  it('與圖形控制台（src/ui/html.ts）的用語一致：內建漸層、不透明度、模糊、遮罩', () => {
    const same: [string, string][] = [
      ['preset.aurora', 'preset.aurora'],
      ['preset.nebula', 'preset.nebula'],
      ['preset.sunset', 'preset.sunset'],
      ['preset.midnight', 'preset.midnight'],
      ['preset.forest', 'preset.forest'],
      ['label.opacity', 'bg.opacity'],
      ['label.blur', 'bg.blur'],
      ['label.tint', 'bg.tint'],
      ['label.mode', 'bg.mode'],
      ['tint.none', 'bg.tint.none'],
      ['tint.dark25', 'bg.tint.dark25'],
      ['tint.dark45', 'bg.tint.dark45'],
      ['tint.navy35', 'bg.tint.navy35'],
    ];
    for (const l of PANEL_LANGS) for (const [p, u] of same) expect(PANEL_TEXT[l][p], `${l} ${p}`).toBe(UI_TEXT[l][u]);
  });

  it('panelI18n() 回傳複本，不會改到常數', () => {
    const copy = panelI18n();
    copy.en.title = 'changed';
    expect(PANEL_TEXT.en.title).toBe('Background');
  });

  it('面板內建的繁體中文預設與 zh-TW 完全相同（沒有傳入 i18n 時使用）', async () => {
    const b = await boot({ language: 'ja-JP' });
    // 沒有文案表時固定使用內建繁中，不跟隨瀏覽器語系
    expect(b.panel.uiLang).toBe('zh-TW');
    for (const k of base) expect(b.panel.text(k), k).toBe(PANEL_TEXT['zh-TW'][k]);
    expect(b.panel.text('scan.count', { n: 3 })).toBe('找到 3 筆');
    expect(b.text('[data-agi18n="title"]')).toBe('背景設定');
  });
});

describe('面板語系：跟隨翻譯 runtime 即時切換', () => {
  const expectLang = (b: Booted, lang: (typeof PANEL_LANGS)[number]): void => {
    const T = PANEL_TEXT[lang];
    expect(b.panel.uiLang).toBe(lang);
    expect(b.text('[data-agi18n="title"]')).toBe(T.title);
    expect(b.$('#antigravity-i18n-panel').getAttribute('aria-label')).toBe(T.title);
    expect(b.$('[data-agi18n="close"]').getAttribute('aria-label')).toBe(T.close);
    expect(b.text('[data-agi18n="gallery-add"]')).toBe(T['gallery.add']);
    expect(b.text('[data-agi18n="gallery-next"]')).toBe(T['gallery.next']);
    expect(b.text('[data-agi18n="reset"]')).toBe(T.reset);
    expect(b.text('[data-agi18n="scan"]')).toBe(T['scan.run']);
    expect(b.text('[data-agi18n="scan-copy"]')).toBe(T['scan.copy']);
    expect(b.text('[data-agi18n="scan-report"]')).toBe(T['scan.report']);
    expect(b.text('[data-agi18n="pick"]')).toBe(T.pick);
    // 選圖按鈕內的 <input type="file"> 不會因為換文字而被移除
    expect(b.doc.querySelector('[data-agi18n="pick"] input[type="file"]')).not.toBeNull();
    expect(options(b, 'slideshow')).toEqual(['off', 'on-launch', '15m', '30m', '60m'].map((m) => T[`slide.${m}`]));
    expect(options(b, 'tint')).toEqual([T['tint.none'], T['tint.dark25'], T['tint.dark45'], T['tint.navy35']]);
    expect(options(b, 'position')[0]).toBe(T['pos.center']);
    expect(options(b, 'mode')).toEqual([T['mode.overlay'], T['mode.underlay']]);
    expect(options(b, 'i18n')).toEqual(['繁體中文', '简体中文', '日本語', '한국어', T['lang.en']]);
    expect(b.text('[data-agi18n-preset="aurora"]')).toBe(T['preset.aurora']);
    expect(b.text('[data-agi18n-preset="forest"]')).toBe(T['preset.forest']);
    expect(b.text('#antigravity-i18n-bg-launcher')).toBe(T.launcher);
    expect(b.$('#antigravity-i18n-bg-launcher').getAttribute('title')).toBe(T.launcherTitle);
    expect(b.text('.agi18n-foot')).toBe(T.foot);
    const sections = Array.from(b.doc.querySelectorAll('#antigravity-i18n-panel .agi18n-sub')).map((n) => n.textContent);
    expect(sections).toEqual([T['sec.source'], T['sec.presets'], T['sec.look'], T['sec.gallery'], T['sec.tweaks'], T['sec.lang'], T['sec.scan']]);
  };

  it('zh-TW → ja → ko → zh-CN → en：標題、按鈕、選單選項、內建漸層與右下角小按鈕全部即時更新', async () => {
    const b = await boot({ i18n: panelI18n(), runtime: true, language: 'fr-FR' });
    b.panel.open();
    expectLang(b, 'zh-TW');
    expect(b.$('#antigravity-i18n-panel').getAttribute('lang')).toBe('zh-Hant-TW');
    for (const lang of ['ja', 'ko', 'zh-CN', 'en', 'zh-TW'] as const) {
      choose(b, '[data-agi18n="i18n"]', lang);
      expectLang(b, lang);
      // 頁面本身也一起切換
      expect(b.text('#btn')).toBe(lang === 'en' ? 'Settings' : lang === 'zh-TW' ? '設定' : FOUR[lang].Settings);
      const native = { 'zh-TW': '繁體中文', 'zh-CN': '简体中文', ja: '日本語', ko: '한국어' };
      expect(b.text('[data-agi18n="msg"]')).toBe(lang === 'en' ? PANEL_TEXT.en['msg.langEn'] : PANEL_TEXT[lang]['msg.lang']!.replace('{label}', native[lang]));
    }
    expect(b.$('#antigravity-i18n-panel').getAttribute('lang')).toBe('zh-Hant-TW');
  });

  it('從面板外切換顯示語系（runtime 的 setLang）後，面板開啟時跟著切換，目前的訊息也以新語系重新顯示', async () => {
    const b = await boot({ i18n: panelI18n(), runtime: true });
    b.panel.open();
    (b.$('[data-agi18n-preset="nebula"]') as HTMLButtonElement).click();
    expect(b.text('[data-agi18n="msg"]')).toBe('已套用「星雲」（只在目前視窗生效）');
    b.panel.close();
    b.win.__ANTIGRAVITY_I18N__!.setLang('ko');
    b.panel.open();
    expect(b.panel.uiLang).toBe('ko');
    expect(b.text('[data-agi18n="msg"]')).toBe('"성운"을(를) 적용했습니다 (현재 창에서만 적용)');
    expect(b.text('[data-agi18n="title"]')).toBe('배경 설정');
  });

  it('容量配額、掃描筆數與刪除按鈕也隨語系更新', async () => {
    const b = await boot({ i18n: panelI18n(), runtime: true, idb: new IDBFactory() });
    b.panel.open();
    await b.panel.gallery();
    expect(b.text('[data-agi18n="gallery-quota"]')).toBe('0/12 張．0.0/30.0 MB');
    b.panel.scan();
    expect(b.text('[data-agi18n="scan-count"]')).toBe('找到 0 筆');
    choose(b, '[data-agi18n="i18n"]', 'en');
    expect(b.text('[data-agi18n="gallery-quota"]')).toBe('0/12 images · 0.0/30.0 MB');
    expect(b.text('[data-agi18n="scan-count"]')).toBe('0 found');
    choose(b, '[data-agi18n="i18n"]', 'ja');
    expect(b.text('[data-agi18n="gallery-quota"]')).toBe('0/12 枚・0.0/30.0 MB');
    expect(b.text('[data-agi18n="scan-count"]')).toBe('0 件見つかりました');
  });
});

describe('面板語系：僅背景模式依 navigator.language 自動挑選', () => {
  it.each([
    ['ja-JP', 'ja'],
    ['ja', 'ja'],
    ['ko-KR', 'ko'],
    ['zh-CN', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
    ['', 'en'],
  ] as const)('%s → %s', async (language, expected) => {
    expect(panelLangFromNavigator(language)).toBe(expected);
    const b = await boot({ i18n: panelI18n(), language });
    expect(b.panel.uiLang).toBe(expected);
    expect(b.text('[data-agi18n="title"]')).toBe(PANEL_TEXT[expected].title);
    expect(b.text('#antigravity-i18n-bg-launcher')).toBe(PANEL_TEXT[expected].launcher);
    // 沒有翻譯 runtime：介面語言選單停用
    expect((b.$('[data-agi18n="i18n"]') as HTMLSelectElement).disabled).toBe(true);
  });

  it('僅背景模式的提示訊息也使用瀏覽器語系', async () => {
    const b = await boot({ i18n: panelI18n(), language: 'ko-KR' });
    b.panel.open();
    b.$('[data-agi18n="scan"]').click();
    expect(b.text('[data-agi18n="msg"]')).toBe(PANEL_TEXT.ko['msg.scanNoRuntime']);
  });
});

describe('面板語系：不信任傳入的文案表', () => {
  it('非字串的值一律忽略並退回；含 HTML 的字串只會以純文字顯示', async () => {
    const evil = panelI18n();
    (evil.en as Record<string, unknown>).title = { toString: 'x' };
    (evil.en as Record<string, unknown>)['gallery.add'] = 42;
    evil.en['scan.run'] = '<img src=x onerror="window.__pwned=1">';
    const b = await boot({ i18n: evil, language: 'en-US' });
    expect(b.panel.uiLang).toBe('en');
    // 退回內建繁中
    expect(b.text('[data-agi18n="title"]')).toBe('背景設定');
    expect(b.text('[data-agi18n="gallery-add"]')).toBe('加入目前圖片');
    expect(b.text('[data-agi18n="scan"]')).toBe('<img src=x onerror="window.__pwned=1">');
    expect(b.doc.querySelector('#antigravity-i18n-panel img')).toBeNull();
    expect((b.win as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('文案表格式錯誤時不拋錯，退回內建繁中', async () => {
    for (const bad of [null, 'oops', [1, 2], { en: 'not-an-object' }]) {
      const b = await boot({ i18n: bad, language: 'en-US' });
      expect(b.text('[data-agi18n="title"]')).toBe('背景設定');
    }
  });

  it('只有部分語系時，缺少的語系退回 English，缺少的 key 退回內建繁中', async () => {
    const b = await boot({ i18n: { en: { title: 'Background' } }, language: 'ja-JP' });
    expect(b.panel.uiLang).toBe('en');
    expect(b.text('[data-agi18n="title"]')).toBe('Background');
    expect(b.text('[data-agi18n="scan"]')).toBe('掃描本頁');
    await sleep(0);
  });

  it('面板原始碼不使用 innerHTML，文字一律以 textContent / setAttribute 寫入', () => {
    expect(antigravityI18nPanel.toString()).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
});
