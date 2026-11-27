/**
 * Runtime i18n Overlay（執行期 DOM 翻譯層）
 *
 * 這個函式會被 `Function.prototype.toString()` 序列化後，連同詞庫一起寫進
 * `app.asar` 的 `antigravity-i18n-runtime.js`，再由主行程在每個視窗 `dom-ready`
 * 時以 `webContents.executeJavaScript()` 注入 renderer。
 *
 * 詞庫為多語系共享 key 的精簡結構（{@link RuntimePack}）：同一份 key 陣列，各語系一個等長的
 * 譯文陣列。執行時只把**目前語系**編譯成查詢表，切換語系時才重新編譯，舊表即可回收。
 *
 * 五語免重整切換：第一次替換文字或屬性時，以 `WeakMap` 記住英文原文（節點被移除後自動回收，
 * 不會洩漏記憶體）。`setLang()` 會先把整份文件還原成英文原文，再以目標語系重新翻譯；
 * `'en'` 則停止翻譯並維持原文。
 *
 * ⚠️ 撰寫規則（序列化的前提）：
 * - 函式必須**完全自足**：不可引用模組層級的變數、import 或其他函式。
 * - 零依賴，只使用瀏覽器內建 API（MutationObserver、TreeWalker、WeakMap）。
 * - 只能用不會產生 helper 的語法（不要用 enum、decorator、class 參數屬性）。
 */

export interface OverlayOptions {
  /** apply 時指定的語系（預設語系） */
  lang: string;
  version: string;
}

/**
 * 多語系 runtime 詞庫：`langs[lang][i]` 是 `keys[i]` 在該語系的譯文，`null` 表示沒有譯文。
 * 四個語系共用一份 key 陣列，比四份獨立的字典小得多。
 */
export interface RuntimePack {
  keys: string[];
  langs: Record<string, (string | null)[]>;
}

/** 面板可切換的語系（翻譯語系 + 英文原文） */
export type OverlayLang = 'zh-TW' | 'zh-CN' | 'ja' | 'ko' | 'en';

export interface OverlayHandle {
  /** 目前顯示的語系；停用翻譯時為 `'en'` */
  readonly lang: string;
  version: string;
  /** 目前語系的詞庫條數（含佔位符樣式） */
  readonly entries: number;
  /** 可切換的語系（詞庫中有譯文的語系，最後一個一定是 `'en'`） */
  readonly availableLangs: string[];
  /** 以目前（或最近一次啟用的）語系翻譯單一字串；沒有對應時回傳 null */
  translate(text: string): string | null;
  /** 重新掃描整份文件 */
  refresh(): void;
  /** 目前是否啟用翻譯 */
  readonly enabled: boolean;
  /** 停止翻譯與監聽 DOM 變更，並把已翻譯的文字還原成英文原文（不寫入偏好） */
  stop(): void;
  /** 重新啟用翻譯：立即翻譯整份文件並恢復監聽 */
  resume(): void;
  /** 免重整切換語系（`'en'` 為英文原文），並記住選擇 */
  setLang(lang: string): void;
}

/** 舊版（掛鉤 v4、v5）面板寫入的同步旗標：設為 '1' 時，頁面載入後不啟用翻譯（仍向下相容） */
export const I18N_DISABLED_KEY = 'antigravity-i18n:i18n-disabled';
/** 面板語系切換器寫入的偏好：`zh-TW` / `zh-CN` / `ja` / `ko` / `en` */
export const I18N_LANG_KEY = 'antigravity-i18n:lang';
/** 寫入語系偏好當下 apply 的語系：之後以其他語系重新 apply 時，舊偏好不再生效 */
export const I18N_LANG_BASE_KEY = 'antigravity-i18n:lang-base';

export function antigravityI18nOverlay(data: RuntimePack | Record<string, string>, options: OverlayOptions): void {
  const MARK = '__ANTIGRAVITY_I18N__';
  const g = globalThis as unknown as Record<string, unknown> & { document?: Document; MutationObserver?: typeof MutationObserver; localStorage?: Storage };
  // 防止重複注入（同一個 document 只會安裝一次）
  if (g[MARK]) return;
  const doc = g.document;
  if (!doc || typeof g.MutationObserver !== 'function') return;

  /**
   * 保護區域：這些元素（含自身與所有子孫）的文字與屬性一律不動。
   * 程式碼、編輯器、終端機、可編輯區域與 AI 回覆的 Markdown 正文。
   */
  const PROTECTED = [
    'code',
    'pre',
    'kbd',
    'samp',
    'script',
    'style',
    'noscript',
    'template',
    'svg',
    'math',
    '.monaco-editor',
    '.xterm',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]',
    '.markdown',
    '.markdown-body',
    '.prose',
    '[class*="markdown"]',
    '[class*="Markdown"]',
    '[data-antigravity-i18n-skip]',
  ].join(',');
  /** 表單欄位：絕不改動其內容（value / 子節點），只翻譯提示屬性 */
  const FORM = 'input,textarea,select';
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const SHOW_ELEMENT = 1;
  const SHOW_TEXT = 4;
  const FILTER_ACCEPT = 1;
  const FILTER_REJECT = 2;
  const MAX_LEN = 500;
  const LANG_KEY = 'antigravity-i18n:lang';
  const LANG_BASE_KEY = 'antigravity-i18n:lang-base';
  const DISABLED_KEY = 'antigravity-i18n:i18n-disabled';
  const ORDER = ['zh-TW', 'zh-CN', 'ja', 'ko'];

  // ── 詞庫：多語系共享 key（也接受舊的單一語系字典） ──────────────
  let pack: RuntimePack;
  const raw = data as Partial<RuntimePack> | null;
  if (raw && Array.isArray(raw.keys) && raw.langs && typeof raw.langs === 'object') {
    pack = raw as RuntimePack;
  } else {
    const d = (data ?? {}) as Record<string, string>;
    const keys = Object.keys(d);
    pack = { keys, langs: { [options.lang]: keys.map((k) => d[k] ?? null) } };
  }
  const hasValues = (l: string): boolean => {
    const vals = pack.langs[l];
    return Array.isArray(vals) && vals.some((v) => typeof v === 'string' && v !== '');
  };
  const available: string[] = [];
  for (const l of [...ORDER, ...Object.keys(pack.langs)]) if (!available.includes(l) && hasValues(l)) available.push(l);

  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const PH = /\{[A-Za-z_][A-Za-z0-9_]*\}|%[sd]/g;
  const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** 目前語系的查詢表（只保留一份，切換語系時重新編譯） */
  let tableLang = '';
  let exact = new Map<string, string>();
  let patterns: { re: RegExp; tokens: string[]; value: string }[] = [];
  const compile = (lang: string): void => {
    const vals = pack.langs[lang] ?? [];
    const nextExact = new Map<string, string>();
    const nextPatterns: typeof patterns = [];
    for (let i = 0; i < pack.keys.length; i++) {
      const key = pack.keys[i];
      const value = vals[i];
      if (typeof key !== 'string' || typeof value !== 'string' || value === '' || value === key) continue;
      const tokens = key.match(PH);
      if (!tokens) {
        nextExact.set(norm(key), value);
        continue;
      }
      // 含佔位符的詞條轉成正規表示式：{name}/%s → (.+?)，%d → (\d+)
      let src = '';
      let last = 0;
      PH.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PH.exec(key))) {
        src += escapeRe(key.slice(last, m.index));
        src += m[0] === '%d' ? '(\\d+)' : '(.+?)';
        last = m.index + m[0].length;
      }
      src += escapeRe(key.slice(last));
      nextPatterns.push({ re: new RegExp(`^${src}$`), tokens, value });
    }
    exact = nextExact;
    patterns = nextPatterns;
    tableLang = lang;
  };

  const translate = (text: string): string | null => {
    if (!text || text.length > MAX_LEN || !/[A-Za-z]/.test(text)) return null;
    const t = norm(text);
    const hit = exact.get(t);
    if (hit !== undefined) return hit;
    for (const p of patterns) {
      const m = p.re.exec(t);
      if (!m) continue;
      const used: Record<string, number> = {};
      return p.value.replace(PH, (tok) => {
        const nth = (used[tok] = (used[tok] ?? -1) + 1);
        let seen = -1;
        for (let i = 0; i < p.tokens.length; i++) {
          if (p.tokens[i] === tok && ++seen === nth) return m[i + 1] ?? tok;
        }
        return tok;
      });
    }
    return null;
  };

  // ── 英文原文（WeakMap：節點被移除後自動回收） ────────────────────
  const origText = new WeakMap<Text, string>();
  const wroteText = new WeakMap<Text, string>();
  const origAttrs = new WeakMap<Element, Record<string, string>>();
  const wroteAttrs = new WeakMap<Element, Record<string, string>>();

  const isProtected = (el: Element | null): boolean => !el || el.closest(PROTECTED) !== null;

  const translateText = (node: Text, trusted: boolean): void => {
    const parent = node.parentElement;
    if (!trusted && (isProtected(parent) || parent!.closest(FORM) !== null)) return;
    const v = node.nodeValue;
    if (!v) return;
    let src = v;
    const orig = origText.get(node);
    if (orig !== undefined) {
      if (wroteText.get(node) === v) {
        src = orig;
      } else {
        // App 自己改了文字：新的內容才是英文原文
        origText.delete(node);
        wroteText.delete(node);
      }
    }
    const tr = translate(src);
    if (tr === null) return;
    const next = (src.match(/^\s*/)?.[0] ?? '') + tr + (src.match(/\s*$/)?.[0] ?? '');
    if (next === v) return;
    if (!origText.has(node)) origText.set(node, src);
    wroteText.set(node, next);
    node.nodeValue = next;
  };

  const translateAttr = (el: Element, name: string): void => {
    const v = el.getAttribute(name);
    if (!v) return;
    let src = v;
    const o = origAttrs.get(el);
    const w = wroteAttrs.get(el);
    if (o && Object.prototype.hasOwnProperty.call(o, name)) {
      if (w && w[name] === v) {
        src = o[name]!;
      } else {
        delete o[name];
        if (w) delete w[name];
      }
    }
    const tr = translate(src);
    if (tr === null || tr === v) return;
    const oo = o ?? {};
    if (!Object.prototype.hasOwnProperty.call(oo, name)) oo[name] = src;
    const ww = w ?? {};
    ww[name] = tr;
    origAttrs.set(el, oo);
    wroteAttrs.set(el, ww);
    el.setAttribute(name, tr);
  };

  const translateAttrs = (el: Element): void => {
    for (const a of ATTRS) translateAttr(el, a);
  };

  const walk = (root: Node): void => {
    if (root.nodeType === 3) {
      translateText(root as Text, false);
      return;
    }
    if (root.nodeType === 1) {
      const el = root as Element;
      if (isProtected(el)) return;
      translateAttrs(el);
      if (el.matches(FORM) || el.closest(FORM) !== null) return;
    } else if (root.nodeType !== 9 && root.nodeType !== 11) {
      return;
    }
    const tw = doc.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
      acceptNode(n: Node): number {
        if (n.nodeType !== 1) return FILTER_ACCEPT;
        const el = n as Element;
        if (el.matches(PROTECTED)) return FILTER_REJECT;
        if (el.matches(FORM)) {
          // 表單欄位：只翻譯 placeholder / title / aria-label，不碰內容
          translateAttrs(el);
          return FILTER_REJECT;
        }
        return FILTER_ACCEPT;
      },
    });
    let n: Node | null;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) translateText(n as Text, true);
      else translateAttrs(n as Element);
    }
  };

  /** 把本 runtime 改過、且之後沒被 App 改動的文字與屬性還原成英文原文 */
  const restoreNode = (n: Node): void => {
    if (n.nodeType === 3) {
      const t = n as Text;
      const orig = origText.get(t);
      if (orig === undefined) return;
      if (t.nodeValue === wroteText.get(t)) t.nodeValue = orig;
      origText.delete(t);
      wroteText.delete(t);
      return;
    }
    const el = n as Element;
    const o = origAttrs.get(el);
    if (!o) return;
    const w = wroteAttrs.get(el) ?? {};
    for (const name of Object.keys(o)) if (el.getAttribute(name) === w[name]) el.setAttribute(name, o[name]!);
    origAttrs.delete(el);
    wroteAttrs.delete(el);
  };
  const restoreAll = (): void => {
    const root = doc.documentElement;
    if (!root) return;
    restoreNode(root);
    const tw = doc.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
      acceptNode(n: Node): number {
        // 保護區域從未被修改，整個略過
        return n.nodeType === 1 && (n as Element).matches(PROTECTED) ? FILTER_REJECT : FILTER_ACCEPT;
      },
    });
    let n: Node | null;
    while ((n = tw.nextNode())) restoreNode(n);
  };

  const observer = new g.MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        r.addedNodes.forEach((n) => walk(n));
      } else if (r.type === 'characterData') {
        translateText(r.target as Text, false);
      } else if (r.type === 'attributes' && r.attributeName) {
        const el = r.target as Element;
        if (!isProtected(el)) translateAttr(el, r.attributeName);
      }
    }
  });

  // ── 偏好（同步讀取，避免先翻譯再還原的閃爍） ──────────────────
  const storage = (): Storage | null => {
    try {
      return g.localStorage ?? null;
    } catch {
      return null;
    }
  };
  const readPref = (): string | null => {
    try {
      const ls = storage();
      if (!ls) return null;
      const base = ls.getItem(LANG_BASE_KEY);
      const pref = ls.getItem(LANG_KEY);
      // 以其他語系重新 apply 後，舊的語系偏好不再生效
      if (pref && (base === null || base === options.lang) && (pref === 'en' || available.includes(pref))) return pref;
      if (ls.getItem(DISABLED_KEY) === '1') return 'en';
    } catch {
      /* 無法讀取時使用預設語系 */
    }
    return null;
  };
  const savePref = (lang: string): void => {
    try {
      const ls = storage();
      if (!ls) return;
      ls.setItem(LANG_KEY, lang);
      ls.setItem(LANG_BASE_KEY, options.lang);
      // 同步維護舊旗標，讓舊版面板與 runtime 讀到一致的狀態
      if (lang === 'en') ls.setItem(DISABLED_KEY, '1');
      else ls.removeItem(DISABLED_KEY);
    } catch {
      /* 此環境無法記住選擇 */
    }
  };

  let stopped = false;
  const refresh = (): void => {
    if (!stopped && doc.documentElement) walk(doc.documentElement);
  };
  const observe = (): void => {
    if (!doc.documentElement) return;
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  };
  const halt = (): void => {
    observer.disconnect();
    restoreAll();
    stopped = true;
  };
  const activate = (lang: string): void => {
    if (tableLang !== lang) compile(lang);
    stopped = false;
    refresh();
    observe();
  };

  const defaultLang = available.includes(options.lang) ? options.lang : (available[0] ?? options.lang);
  const pref = readPref();
  compile(pref && pref !== 'en' ? pref : defaultLang);
  stopped = pref === 'en';

  const handle: OverlayHandle = {
    get lang(): string {
      return stopped ? 'en' : tableLang;
    },
    version: options.version,
    get entries(): number {
      return exact.size + patterns.length;
    },
    get availableLangs(): string[] {
      return [...available, 'en'];
    },
    get enabled(): boolean {
      return !stopped;
    },
    translate,
    refresh,
    stop: () => {
      try {
        halt();
      } catch (e) {
        console.warn('[antigravity-i18n] stop failed:', e instanceof Error ? e.message : e);
      }
    },
    resume: () => {
      if (!stopped) return;
      try {
        activate(tableLang || defaultLang);
      } catch (e) {
        console.warn('[antigravity-i18n] resume failed:', e instanceof Error ? e.message : e);
      }
    },
    setLang: (lang: string) => {
      try {
        if (lang !== 'en' && !available.includes(lang)) {
          console.warn('[antigravity-i18n] unknown language:', lang);
          return;
        }
        savePref(lang);
        if (lang === 'en') {
          if (!stopped) halt();
          return;
        }
        if (!stopped && tableLang === lang) return;
        // 先還原成英文原文，再以目標語系重新翻譯整份文件
        halt();
        activate(lang);
      } catch (e) {
        console.warn('[antigravity-i18n] setLang failed:', e instanceof Error ? e.message : e);
      }
    },
  };
  g[MARK] = handle;

  // 立即掃描並開始監聽；若文件仍在解析中，解析器插入的節點也會被 observer 捕捉，
  // DOMContentLoaded 時再完整補掃一次。
  if (!stopped) {
    refresh();
    observe();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', refresh, { once: true });
}
