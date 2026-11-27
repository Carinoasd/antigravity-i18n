import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  containsTerm,
  defaultLocalesDir,
  extractPlaceholders,
  loadDictionary,
  loadModule,
  loadProtectedTerms,
  normalizeLang,
  validateLocales,
} from '../src/core/locales.js';
import { LANGS, LOCALE_MODULES, TARGET_MODULES } from '../src/types.js';
import { rm, tmpDir, write } from './helpers.js';

describe('內建詞庫', () => {
  const dir = defaultLocalesDir();

  it('通過驗證且沒有錯誤', () => {
    const report = validateLocales(dir);
    expect(report.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('每個語系至少 150 條字串', () => {
    const report = validateLocales(dir);
    expect(report.keyCount['zh-TW']).toBeGreaterThanOrEqual(150);
    expect(report.keyCount['zh-CN']).toBeGreaterThanOrEqual(150);
  });

  it('6 個模組 zh-TW 與 zh-CN 的 key 完全一致', () => {
    for (const mod of LOCALE_MODULES) {
      const tw = Object.keys(loadModule(dir, 'zh-TW', mod)).sort();
      const cn = Object.keys(loadModule(dir, 'zh-CN', mod)).sort();
      expect(tw.length).toBeGreaterThan(0);
      expect(cn).toEqual(tw);
    }
  });

  it('使用正確的地區慣用語', () => {
    const tw = loadDictionary('zh-TW', LOCALE_MODULES);
    const cn = loadDictionary('zh-CN', LOCALE_MODULES);
    expect(tw['Settings']).toBe('設定');
    expect(cn['Settings']).toBe('设置');
    expect(tw['Terminal']).toBe('終端機');
    expect(cn['Terminal']).toBe('终端');
    expect(tw['Extensions']).toBe('擴充功能');
    expect(cn['Extensions']).toBe('扩展');
    expect(tw['Command Palette']).toBe('命令選擇區');
    expect(cn['Command Palette']).toBe('命令面板');
    expect(tw['Projects']).toBe('專案');
    expect(cn['Projects']).toBe('项目');
  });

  it('保護詞包含斜線指令與技術術語', () => {
    const terms = loadProtectedTerms(dir);
    for (const t of ['/plan', '/swarm', 'MCP', 'Git', 'SSH', 'Diff', 'Worktree']) expect(terms).toContain(t);
  });

  it('每個目標都能載入詞庫', () => {
    for (const lang of LANGS) {
      for (const mods of Object.values(TARGET_MODULES)) {
        expect(Object.keys(loadDictionary(lang, mods, dir)).length).toBeGreaterThan(20);
      }
    }
  });
});

describe('工具函式', () => {
  it('extractPlaceholders 取出並排序佔位符', () => {
    expect(extractPlaceholders('Hello {name}, %d items, %s and {count}')).toEqual(['%d', '%s', '{count}', '{name}']);
    expect(extractPlaceholders('no placeholders')).toEqual([]);
  });

  it('containsTerm 以字母邊界判斷英文詞', () => {
    expect(containsTerm('Open Git panel', 'Git')).toBe(true);
    expect(containsTerm('Open GitHub', 'Git')).toBe(false);
    expect(containsTerm('使用 /plan 建立', '/plan')).toBe(true);
    expect(containsTerm('Git：提交', 'Git')).toBe(true);
  });

  it('normalizeLang 接受常見寫法', () => {
    expect(normalizeLang('zh-tw')).toBe('zh-TW');
    expect(normalizeLang('zh_TW')).toBe('zh-TW');
    expect(normalizeLang('ZH-CN')).toBe('zh-CN');
    expect(normalizeLang('zh-Hans')).toBe('zh-CN');
    expect(normalizeLang('ja')).toBeNull();
  });
});

describe('validateLocales 能抓出錯誤', () => {
  let dir: string;
  afterEach(() => rm(dir));

  /** 以內建詞庫為基礎建立一份可修改的副本 */
  function fixture(): string {
    dir = tmpDir();
    fs.cpSync(defaultLocalesDir(), dir, { recursive: true });
    return dir;
  }
  const file = (lang: string, mod: string): string => path.join(dir, lang, `${mod}.json`);
  const patch = (lang: string, mod: string, fn: (d: Record<string, string>) => void): void => {
    const d = JSON.parse(fs.readFileSync(file(lang, mod), 'utf8')) as Record<string, string>;
    fn(d);
    write(file(lang, mod), JSON.stringify(d));
  };
  const errors = (): string[] => validateLocales(dir).issues.filter((i) => i.level === 'error').map((i) => i.message);

  it('JSON 語法錯誤', () => {
    fixture();
    write(file('zh-TW', 'chat'), '{ "Send": "傳送", }');
    expect(errors().some((m) => m.includes('JSON 語法錯誤'))).toBe(true);
  });

  it('模組為空與譯文為空', () => {
    fixture();
    write(file('zh-CN', 'cli'), '{}');
    patch('zh-TW', 'chat', (d) => (d['Send'] = '  '));
    const errs = errors();
    expect(errs).toContain('模組不可為空');
    expect(errs).toContain('譯文不可為空');
  });

  it('zh-TW 與 zh-CN key 不一致', () => {
    fixture();
    patch('zh-TW', 'sidebar', (d) => (d['Only In TW'] = '只有台灣'));
    expect(errors().some((m) => m.includes('zh-TW 有、zh-CN 沒有'))).toBe(true);
  });

  it('佔位符不一致', () => {
    fixture();
    patch('zh-CN', 'permissions', (d) => (d['Allow MCP tool {name} to run?'] = '要允许 MCP 工具运行吗？'));
    patch('zh-TW', 'cli', (d) => (d['Reading file %s'] = '正在讀取檔案 %d'));
    const errs = errors().filter((m) => m.startsWith('佔位符不一致'));
    expect(errs).toHaveLength(2);
  });

  it('保護詞被誤翻', () => {
    fixture();
    patch('zh-TW', 'chat', (d) => (d['Use /plan to create an implementation plan'] = '使用「規劃」建立實作計畫'));
    patch('zh-CN', 'ide', (d) => (d['Create Worktree'] = '创建工作树'));
    const errs = errors();
    expect(errs).toContain('保護詞「/plan」不可翻譯或改寫');
    expect(errs).toContain('保護詞「Worktree」不可翻譯或改寫');
  });

  it('用語不符地區慣例', () => {
    fixture();
    patch('zh-TW', 'settings', (d) => (d['Command Palette'] = '命令面板'));
    patch('zh-CN', 'ide', (d) => (d['Terminal'] = '終端機'));
    const errs = errors();
    expect(errs.some((m) => m.includes('命令選擇區'))).toBe(true);
    expect(errs.some((m) => m.includes('繁體字'))).toBe(true);
  });

  it('保護詞清單格式錯誤', () => {
    fixture();
    write(path.join(dir, 'protected-terms.json'), '{"terms": ["", "MCP"]}');
    expect(errors().some((m) => m.includes('不可含空字串'))).toBe(true);
  });
});
