import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LANGS,
  LOCALE_MODULES,
  type Dictionary,
  type Lang,
  type LocaleModule,
  type ProtectedTermsFile,
} from '../types.js';

/** 套件根目錄（src/core 與 dist/core 皆往上兩層） */
export function packageRoot(): string {
  return fileURLToPath(new URL('../../', import.meta.url));
}

export function defaultLocalesDir(): string {
  return path.join(packageRoot(), 'locales');
}

export function readToolVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export class LocaleError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = 'LocaleError';
  }
}

/** 將 `zh-tw`、`zh_TW`、`tw` 等寫法正規化 */
export function normalizeLang(input: string): Lang | null {
  const v = input.trim().toLowerCase().replace('_', '-');
  if (['zh-tw', 'tw', 'zh-hant', 'zh-hant-tw', 'traditional'].includes(v)) return 'zh-TW';
  if (['zh-cn', 'cn', 'zh-hans', 'zh-hans-cn', 'simplified'].includes(v)) return 'zh-CN';
  return null;
}

export function moduleFile(dir: string, lang: Lang, mod: LocaleModule): string {
  return path.join(dir, lang, `${mod}.json`);
}

function readJson(file: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new LocaleError('找不到檔案', file);
  }
  try {
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    throw new LocaleError(`JSON 語法錯誤：${(e as Error).message}`, file);
  }
}

export function loadModule(dir: string, lang: Lang, mod: LocaleModule): Dictionary {
  const file = moduleFile(dir, lang, mod);
  const data = readJson(file);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new LocaleError('根節點必須是 { "英文原文": "譯文" } 物件', file);
  }
  const out: Dictionary = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string') throw new LocaleError(`「${k}」的值必須是字串`, file);
    out[k] = v;
  }
  return out;
}

/** 合併多個模組成單一詞庫 */
export function loadDictionary(lang: Lang, modules: readonly LocaleModule[], dir = defaultLocalesDir()): Dictionary {
  const out: Dictionary = {};
  for (const mod of modules) Object.assign(out, loadModule(dir, lang, mod));
  return out;
}

export function loadProtectedTerms(dir = defaultLocalesDir()): string[] {
  const file = path.join(dir, 'protected-terms.json');
  const data = readJson(file) as ProtectedTermsFile;
  if (!data || !Array.isArray(data.terms) || data.terms.some((t) => typeof t !== 'string' || t === '')) {
    throw new LocaleError('格式必須為 { "terms": ["..."] } 且不可含空字串', file);
  }
  return data.terms;
}

const PLACEHOLDER_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}|%[sd]/g;

/** 取出字串中的佔位符（已排序，方便比較） */
export function extractPlaceholders(s: string): string[] {
  return (s.match(PLACEHOLDER_RE) ?? []).sort();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 判斷文字是否包含保護詞（英文詞以字母邊界判斷，大小寫敏感） */
export function containsTerm(text: string, term: string): boolean {
  const left = /^[A-Za-z]/.test(term) ? '(?<![A-Za-z])' : '';
  const right = /[A-Za-z]$/.test(term) ? '(?![A-Za-z])' : '';
  return new RegExp(`${left}${escapeRe(term)}${right}`).test(text);
}

/**
 * 常見 UI 用字的「繁體 → 簡體」對照（每兩個字元一組）。
 * 只收錄繁簡字形不同、且簡體字不是合法繁體字的組合（例如排除 制/准/后/云/折）。
 */
const TRAD_SIMP_PAIRS =
  '們们個个這这為为說说開开關关設设權权檔档與与發发時时會会從从對对還还進进過过來来該该請请應应門门問问題题圖图標标' +
  '頁页碼码終终機机執执運运錯错誤误輸输傳传載载線线連连視视資资訊讯夾夹擴扩編编輯辑選选擇择啟启動动態态狀状歷历紀纪' +
  '錄录記记儲储創创刪删復复複复預预測测試试驗验證证書书簡简體体單单數数據据庫库實实現现際际網网絡络處处計计劃划畫画' +
  '務务項项專专業业戶户帳账號号鍵键盤盘顯显隱隐種种類类範范圍围讀读寫写寬宽長长間间隨随詢询讓让幫帮認认識识語语話话' +
  '響响審审檢检稱称歸归釘钉尋寻換换頂顶側侧邊边欄栏細细節节點点擊击鈕钮額额價价費费員员協协議议責责許许絕绝';

function pairChars(which: 0 | 1): string {
  let out = '';
  for (let i = which; i < TRAD_SIMP_PAIRS.length; i += 2) out += TRAD_SIMP_PAIRS[i];
  return out;
}

/** 用語規範：各語系不應出現的字詞（對岸用語 / 台灣用語 / 繁簡混用） */
export const TERMINOLOGY_RULES: Record<Lang, { pattern: RegExp; hint: string }[]> = {
  'zh-TW': [
    { pattern: new RegExp(`[${pairChars(1)}]`, 'u'), hint: '含有簡體字，請改用繁體字' },
    { pattern: /命令面板/u, hint: '台灣用語為「命令選擇區」' },
    { pattern: /設置/u, hint: '台灣用語為「設定」' },
    { pattern: /默認/u, hint: '台灣用語為「預設」' },
    { pattern: /擴展/u, hint: '台灣用語為「擴充功能」' },
    { pattern: /文件夾/u, hint: '台灣用語為「資料夾」' },
    { pattern: /信息/u, hint: '台灣用語為「資訊」或「訊息」' },
    { pattern: /軟件|硬件/u, hint: '台灣用語為「軟體／硬體」' },
    { pattern: /終端(?!機)/u, hint: '台灣用語為「終端機」' },
  ],
  'zh-CN': [
    { pattern: new RegExp(`[${pairChars(0)}]`, 'u'), hint: '含有繁體字，請改用簡體字' },
    { pattern: /终端机/u, hint: '大陆用语为「终端」' },
    { pattern: /扩充功能/u, hint: '大陆用语为「扩展」' },
    { pattern: /命令选择区/u, hint: '大陆用语为「命令面板」' },
    { pattern: /专案/u, hint: '大陆用语为「项目」' },
    { pattern: /档案|资料夹/u, hint: '大陆用语为「文件／文件夹」' },
    { pattern: /预设/u, hint: '大陆用语为「默认」' },
    { pattern: /讯息/u, hint: '大陆用语为「消息」' },
  ],
};

export interface ValidationIssue {
  level: 'error' | 'warning';
  file: string;
  key?: string;
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  keyCount: Record<Lang, number>;
  moduleCount: number;
  ok: boolean;
}

/** CI 用詞庫驗證器 */
export function validateLocales(dir = defaultLocalesDir()): ValidationReport {
  const issues: ValidationIssue[] = [];
  const keyCount: Record<Lang, number> = { 'zh-TW': 0, 'zh-CN': 0 };
  const rel = (f: string): string => path.relative(dir, f).split(path.sep).join('/');
  const err = (file: string, message: string, key?: string): void => {
    issues.push({ level: 'error', file: rel(file), key, message });
  };

  let terms: string[] = [];
  try {
    terms = loadProtectedTerms(dir);
  } catch (e) {
    const le = e as LocaleError;
    err(le.file ?? path.join(dir, 'protected-terms.json'), le.message);
  }

  const loaded: Partial<Record<Lang, Partial<Record<LocaleModule, Dictionary>>>> = {};
  for (const lang of LANGS) {
    loaded[lang] = {};
    for (const mod of LOCALE_MODULES) {
      const file = moduleFile(dir, lang, mod);
      try {
        const dict = loadModule(dir, lang, mod);
        loaded[lang]![mod] = dict;
        const entries = Object.entries(dict);
        if (entries.length === 0) err(file, '模組不可為空');
        keyCount[lang] += entries.length;
        for (const [k, v] of entries) {
          if (k.trim() === '') err(file, 'key 不可為空字串');
          if (v.trim() === '') err(file, '譯文不可為空', k);
          if (k !== k.trim()) err(file, 'key 前後不可有空白', k);
          const srcPh = extractPlaceholders(k);
          const dstPh = extractPlaceholders(v);
          if (srcPh.join('\u0000') !== dstPh.join('\u0000')) {
            err(file, `佔位符不一致：原文 [${srcPh.join(', ')}]，譯文 [${dstPh.join(', ')}]`, k);
          }
          for (const t of terms) {
            if (containsTerm(k, t) && !containsTerm(v, t)) err(file, `保護詞「${t}」不可翻譯或改寫`, k);
          }
          for (const rule of TERMINOLOGY_RULES[lang]) {
            const m = v.match(rule.pattern);
            if (m) err(file, `用語不符規範（「${m[0]}」）：${rule.hint}`, k);
          }
        }
      } catch (e) {
        const le = e as LocaleError;
        err(le.file ?? file, le.message);
      }
    }
  }

  // zh-TW 與 zh-CN 的 key 必須完全一致
  for (const mod of LOCALE_MODULES) {
    const tw = loaded['zh-TW']?.[mod];
    const cn = loaded['zh-CN']?.[mod];
    if (!tw || !cn) continue;
    for (const k of Object.keys(tw)) {
      if (!(k in cn)) err(moduleFile(dir, 'zh-CN', mod), '缺少 key（zh-TW 有、zh-CN 沒有）', k);
    }
    for (const k of Object.keys(cn)) {
      if (!(k in tw)) err(moduleFile(dir, 'zh-TW', mod), '缺少 key（zh-CN 有、zh-TW 沒有）', k);
    }
  }

  // 跨模組重複 key 必須譯文一致，否則合併時會互相覆蓋
  for (const lang of LANGS) {
    const seen = new Map<string, { mod: LocaleModule; value: string }>();
    for (const mod of LOCALE_MODULES) {
      for (const [k, v] of Object.entries(loaded[lang]?.[mod] ?? {})) {
        const prev = seen.get(k);
        // 譯文相同的重複 key 允許存在（讓各模組可自成一套）；不同則會互相覆蓋，視為錯誤
        if (prev && prev.value !== v) {
          err(moduleFile(dir, lang, mod), `與 ${prev.mod}.json 的同名 key 譯文不一致（「${prev.value}」 vs 「${v}」）`, k);
        } else if (!prev) {
          seen.set(k, { mod, value: v });
        }
      }
    }
  }

  return {
    issues,
    keyCount,
    moduleCount: LOCALE_MODULES.length,
    ok: !issues.some((i) => i.level === 'error'),
  };
}
