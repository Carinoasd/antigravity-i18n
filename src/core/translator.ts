import path from 'node:path';
import type { Dictionary, TranslateStats } from '../types.js';

/**
 * 詞庫替換引擎。
 *
 * 設計重點：Electron / VS Code bundle 裡充滿 `"Off"`、`"Run"` 這類同時被當成
 * 列舉值或指令 ID 使用的短字串，盲目全域取代會破壞程式邏輯。因此：
 *
 * - **JS（code 模式）**：只替換「完整的字串常值」（`"..."`、`'...'`、`` `...` ``）。
 *   - 「長字串」（含空白且長度 ≥ 8）視為 UI 文字，任何位置皆可替換。
 *   - 「短字串」只在 UI 語境中替換，例如 `label:`、`title:`、`children:`、
 *     `placeholder=`、`localize(key, "...")`、`createElement(tag, props, "...")`。
 * - **JSON**：只替換字串「值」（不動 key）；`*.nls.json` / `nls.messages.json`
 *   內全部值都是顯示文字，其餘 JSON 套用與 code 模式相同的語境規則。
 * - **HTML**：替換文字節點、`title` / `placeholder` / `aria-label` / `alt` 屬性，
 *   並對內嵌 script 套用 code 模式。
 */

export type TranslateMode = 'auto' | 'code' | 'json' | 'html';

export interface TranslateOptions {
  mode?: TranslateMode;
  /** 用於 auto 模式判斷檔案類型 */
  filename?: string;
}

export interface TranslateResult {
  output: string;
  changed: boolean;
  totalHits: number;
  hits: Record<string, number>;
}

const UI_PROPS = [
  'label',
  'title',
  'tooltip',
  'placeholder',
  'description',
  'markdownDescription',
  'detail',
  'text',
  'message',
  'caption',
  'header',
  'heading',
  'subtitle',
  'buttonText',
  'confirmText',
  'cancelText',
  'okText',
  'ariaLabel',
  'aria-label',
  'children',
  'displayName',
  'hint',
  'helperText',
  'emptyText',
  'emptyMessage',
  'tooltipText',
  'primaryButton',
  'secondaryButton',
  'enumDescriptions',
  'enumItemLabels',
  'category',
];

const UI_PROP_SET = new Set(UI_PROPS);

/** 字串常值前方（≤ 80 字元）符合下列任一模式即視為 UI 語境 */
const CODE_CONTEXT_RE = new RegExp(
  [
    // label: "..."、title = "..."、"label": "..."
    `(?:^|[^\\w$-])["']?(?:${UI_PROPS.map((p) => p.replace('-', '\\-')).join('|')})["']?\\s*[:=]\\s*\\[?\\s*$`,
    // localize("key", "...") / localize2(123, "...") / nls.localize({...}, "...")
    `\\blocalize2?\\s*\\(\\s*(?:"[^"\\n]*"|'[^'\\n]*'|[\\w$.]+|\\{[^{}]{0,60}\\})\\s*,\\s*$`,
    // React.createElement("div", null, "...") / jsx("span", {...}, "...") / h("b", null, "...")
    `\\b(?:createElement|jsxs?|jsxDEV|h)\\s*\\([^()]{0,40},\\s*(?:null|\\{[^{}]{0,60}\\})\\s*,\\s*$`,
    // el.textContent = "..." / el.title = "..."
    `\\.(?:textContent|innerText|title|placeholder|ariaLabel)\\s*=\\s*$`,
    // showInformationMessage("...") / alert("...") / confirm("...")
    `\\b(?:show(?:Information|Warning|Error)Message|alert|confirm|setStatusBarMessage)\\s*\\(\\s*$`,
  ].join('|'),
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 依引號種類將文字編碼成 JS 字串常值內容 */
function encodeJs(s: string, quote: string): string {
  let out = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  if (quote === '`') out = out.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  else out = out.split(quote).join(`\\${quote}`);
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 含空白且長度 ≥ 8 的字串視為明確的 UI 文字 */
export function isDistinctive(key: string): boolean {
  return /\s/.test(key) && key.length >= 8;
}

function detectMode(filename: string | undefined): Exclude<TranslateMode, 'auto'> {
  const ext = filename ? path.extname(filename).toLowerCase() : '';
  if (ext === '.json') return 'json';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'code';
}

function detectIndent(raw: string): string | number {
  const m = raw.match(/^[{[]\r?\n([ \t]+)\S/);
  return m?.[1] ?? 0;
}

export class Translator {
  readonly keys: string[];
  private readonly literalRe: RegExp | null;
  private readonly literalMap = new Map<string, string>();
  private readonly htmlTextRe: RegExp | null;
  private readonly htmlAttrRe: RegExp | null;
  private readonly htmlMap = new Map<string, string>();

  constructor(private readonly dict: Dictionary) {
    // 長字串優先，避免較短的 key 先吃掉
    this.keys = Object.keys(dict)
      .filter((k) => k !== '' && dict[k] !== '' && dict[k] !== k)
      .sort((a, b) => b.length - a.length);

    const literals: string[] = [];
    for (const key of this.keys) {
      for (const q of ['"', "'", '`']) {
        const lit = q + encodeJs(key, q) + q;
        if (!this.literalMap.has(lit)) {
          this.literalMap.set(lit, key);
          literals.push(lit);
        }
      }
    }
    this.literalRe = literals.length ? new RegExp(literals.map(escapeRe).join('|'), 'g') : null;

    const htmlKeys: string[] = [];
    for (const key of this.keys) {
      const enc = escapeHtml(key);
      this.htmlMap.set(enc, key);
      htmlKeys.push(escapeRe(enc));
    }
    const alt = htmlKeys.join('|');
    this.htmlTextRe = alt ? new RegExp(`(>[ \\t\\r\\n]*)(${alt})([ \\t\\r\\n]*<)`, 'g') : null;
    this.htmlAttrRe = alt ? new RegExp(`(\\b(?:title|placeholder|aria-label|alt)=")(${alt})(")`, 'g') : null;
  }

  translate(content: string, opts: TranslateOptions = {}): TranslateResult {
    const mode = opts.mode && opts.mode !== 'auto' ? opts.mode : detectMode(opts.filename);
    const hits: Record<string, number> = {};
    let output: string;
    if (mode === 'json') output = this.translateJson(content, opts.filename, hits);
    else if (mode === 'html') output = this.translateHtml(content, hits);
    else output = this.translateCode(content, hits);
    const totalHits = Object.values(hits).reduce((a, b) => a + b, 0);
    return { output, changed: output !== content, totalHits, hits };
  }

  private bump(hits: Record<string, number>, key: string): void {
    hits[key] = (hits[key] ?? 0) + 1;
  }

  private translateCode(content: string, hits: Record<string, number>): string {
    if (!this.literalRe) return content;
    this.literalRe.lastIndex = 0;
    return content.replace(this.literalRe, (lit: string, offset: number) => {
      const key = this.literalMap.get(lit);
      if (key === undefined) return lit;
      // 避免吃到跳脫引號的一半：前一字元是反斜線就略過
      if (offset > 0 && content[offset - 1] === '\\') return lit;
      if (!isDistinctive(key)) {
        const before = content.slice(Math.max(0, offset - 80), offset);
        if (!CODE_CONTEXT_RE.test(before)) return lit;
      }
      this.bump(hits, key);
      const q = lit[0]!;
      return q + encodeJs(this.dict[key]!, q) + q;
    });
  }

  private translateHtml(content: string, hits: Record<string, number>): string {
    let out = content;
    if (this.htmlTextRe && this.htmlAttrRe) {
      const repl = (_m: string, a: string, enc: string, b: string): string => {
        const key = this.htmlMap.get(enc)!;
        this.bump(hits, key);
        return a + escapeHtml(this.dict[key]!) + b;
      };
      out = out.replace(this.htmlTextRe, repl).replace(this.htmlAttrRe, repl);
    }
    // 內嵌 <script>
    return out.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, a: string, body: string, b: string) => {
      return a + this.translateCode(body, hits) + b;
    });
  }

  private translateJson(content: string, filename: string | undefined, hits: Record<string, number>): string {
    const bom = content.startsWith('﻿') ? '﻿' : '';
    const raw = content.slice(bom.length);
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return this.translateCode(content, hits);
    }
    const base = filename ? path.basename(filename).toLowerCase() : '';
    const allStrings = base.endsWith('.nls.json') || base === 'nls.messages.json' || /^package\.nls(\.[\w-]+)?\.json$/.test(base);
    let changed = false;

    const visit = (node: unknown, parentKey: string | null): unknown => {
      if (typeof node === 'string') {
        const t = this.dict[node];
        if (t === undefined || t === node) return node;
        if (allStrings || isDistinctive(node) || (parentKey !== null && UI_PROP_SET.has(parentKey))) {
          this.bump(hits, node);
          changed = true;
          return t;
        }
        return node;
      }
      if (Array.isArray(node)) return node.map((v) => visit(v, parentKey));
      if (node && typeof node === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node)) out[k] = visit(v, k);
        return out;
      }
      return node;
    };

    const result = visit(data, null);
    if (!changed) return content;
    const trailing = /\r?\n$/.test(raw) ? (raw.endsWith('\r\n') ? '\r\n' : '\n') : '';
    return bom + JSON.stringify(result, null, detectIndent(raw)) + trailing;
  }
}

/** 單次翻譯（測試與小檔案用；大量檔案請重複使用同一個 Translator） */
export function translateContent(content: string, dict: Dictionary, opts: TranslateOptions = {}): TranslateResult {
  return new Translator(dict).translate(content, opts);
}

export function emptyStats(totalKeys: number): TranslateStats {
  return { totalKeys, matchedKeys: 0, totalHits: 0, coverage: 0, hitsByKey: {} };
}

/** 將單檔命中結果累加到總統計 */
export function mergeHits(stats: TranslateStats, hits: Record<string, number>): void {
  for (const [k, n] of Object.entries(hits)) {
    stats.hitsByKey[k] = (stats.hitsByKey[k] ?? 0) + n;
    stats.totalHits += n;
  }
  stats.matchedKeys = Object.keys(stats.hitsByKey).length;
  stats.coverage = stats.totalKeys === 0 ? 0 : stats.matchedKeys / stats.totalKeys;
}
