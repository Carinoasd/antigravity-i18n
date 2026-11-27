/**
 * Runtime i18n Overlay（執行期 DOM 翻譯層）
 *
 * 這個函式會被 `Function.prototype.toString()` 序列化後，連同詞庫一起寫進
 * `app.asar` 的 `antigravity-i18n-runtime.js`，再由主行程在每個視窗 `dom-ready`
 * 時以 `webContents.executeJavaScript()` 注入 renderer。
 *
 * ⚠️ 撰寫規則（序列化的前提）：
 * - 函式必須**完全自足**：不可引用模組層級的變數、import 或其他函式。
 * - 零依賴，只使用瀏覽器內建 API（MutationObserver、TreeWalker）。
 * - 只能用不會產生 helper 的語法（不要用 enum、decorator、class 參數屬性）。
 */

export interface OverlayOptions {
  lang: string;
  version: string;
}

export interface OverlayHandle {
  lang: string;
  version: string;
  /** 詞庫條數（含佔位符樣式） */
  entries: number;
  /** 翻譯單一字串；沒有對應時回傳 null */
  translate(text: string): string | null;
  /** 重新掃描整份文件 */
  refresh(): void;
  /** 目前是否啟用翻譯 */
  readonly enabled: boolean;
  /** 停止翻譯與監聽 DOM 變更（已翻譯的文字需重新整理頁面才會恢復原文） */
  stop(): void;
  /** 重新啟用翻譯：立即翻譯整份文件並恢復監聽 */
  resume(): void;
}

/** 介面面板寫入的同步旗標：設為 '1' 時，頁面載入後不啟用翻譯 */
export const I18N_DISABLED_KEY = 'antigravity-i18n:i18n-disabled';

export function antigravityI18nOverlay(dict: Record<string, string>, options: OverlayOptions): void {
  const MARK = '__ANTIGRAVITY_I18N__';
  const g = globalThis as unknown as Record<string, unknown> & { document?: Document; MutationObserver?: typeof MutationObserver };
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

  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const exact = new Map<string, string>();
  const patterns: { re: RegExp; tokens: string[]; value: string }[] = [];
  const PH = /\{[A-Za-z_][A-Za-z0-9_]*\}|%[sd]/g;
  const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const key of Object.keys(dict)) {
    const value = dict[key];
    if (typeof value !== 'string' || value === '' || value === key) continue;
    const tokens = key.match(PH);
    if (!tokens) {
      exact.set(norm(key), value);
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
    patterns.push({ re: new RegExp(`^${src}$`), tokens, value });
  }

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

  const isProtected = (el: Element | null): boolean => !el || el.closest(PROTECTED) !== null;

  const translateText = (node: Text, trusted: boolean): void => {
    const parent = node.parentElement;
    if (!trusted && (isProtected(parent) || parent!.closest(FORM) !== null)) return;
    const v = node.nodeValue;
    if (!v) return;
    const tr = translate(v);
    if (tr === null) return;
    const next = (v.match(/^\s*/)?.[0] ?? '') + tr + (v.match(/\s*$/)?.[0] ?? '');
    if (next !== v) node.nodeValue = next;
  };

  const translateAttr = (el: Element, name: string): void => {
    const v = el.getAttribute(name);
    if (!v) return;
    const tr = translate(v);
    if (tr !== null && tr !== v) el.setAttribute(name, tr);
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

  // 使用者在介面面板停用翻譯時會寫入此旗標（同步讀取，避免先翻譯再還原的閃爍）
  let stopped = false;
  try {
    const ls = (g as { localStorage?: Storage }).localStorage;
    stopped = !!ls && ls.getItem('antigravity-i18n:i18n-disabled') === '1';
  } catch {
    stopped = false;
  }
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

  const handle: OverlayHandle = {
    lang: options.lang,
    version: options.version,
    entries: exact.size + patterns.length,
    get enabled(): boolean {
      return !stopped;
    },
    translate,
    refresh,
    stop: () => {
      stopped = true;
      observer.disconnect();
    },
    resume: () => {
      if (!stopped) return;
      stopped = false;
      refresh();
      observe();
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
