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

  it('每個語系至少 450 條字串', () => {
    const report = validateLocales(dir);
    for (const lang of LANGS) {
      expect(report.keyCount[lang]).toBeGreaterThanOrEqual(450);
    }
  });

  it('所有模組的四個語系（zh-TW / zh-CN / ja / ko）key 完全一致', () => {
    for (const mod of LOCALE_MODULES) {
      const tw = Object.keys(loadModule(dir, 'zh-TW', mod)).sort();
      expect(tw.length).toBeGreaterThan(0);
      for (const lang of LANGS) {
        if (lang === 'zh-TW') continue;
        expect(Object.keys(loadModule(dir, lang, mod)).sort()).toEqual(tw);
      }
    }
  });

  it('使用正確的地區慣用語（繁中 / 簡中 / 日文 / 韓文）', () => {
    const tw = loadDictionary('zh-TW', LOCALE_MODULES);
    const cn = loadDictionary('zh-CN', LOCALE_MODULES);
    const ja = loadDictionary('ja', LOCALE_MODULES);
    const ko = loadDictionary('ko', LOCALE_MODULES);
    expect(tw['Settings']).toBe('設定');
    expect(cn['Settings']).toBe('设置');
    expect(ja['Settings']).toBe('設定');
    expect(ko['Settings']).toBe('설정');
    expect(tw['Terminal']).toBe('終端機');
    expect(cn['Terminal']).toBe('终端');
    expect(ja['Terminal']).toBe('ターミナル');
    expect(ko['Terminal']).toBe('터미널');
    expect(tw['Extensions']).toBe('擴充功能');
    expect(cn['Extensions']).toBe('扩展');
    expect(ja['Extensions']).toBe('拡張機能');
    expect(ko['Extensions']).toBe('확장 프로그램');
    expect(tw['Command Palette']).toBe('命令選擇區');
    expect(cn['Command Palette']).toBe('命令面板');
    expect(ja['Command Palette']).toBe('コマンドパレット');
    expect(ko['Command Palette']).toBe('명령 팔레트');
    expect(tw['Projects']).toBe('專案');
    expect(cn['Projects']).toBe('项目');
    expect(ja['Projects']).toBe('プロジェクト');
    expect(ko['Projects']).toBe('프로젝트');
    expect(tw['Paste']).toBe('貼上');
    expect(cn['Paste']).toBe('粘贴');
    expect(tw['Toggle Full Screen']).toBe('切換全螢幕');
    expect(cn['Toggle Full Screen']).toBe('切换全屏');
    expect(tw['Models & Usage']).toBe('模型與用量');
    expect(ja['Models & Usage']).toBe('モデルと使用量');
    expect(ko['Models & Usage']).toBe('모델 및 사용량');
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
    expect(normalizeLang('ja')).toBe('ja');
    expect(normalizeLang('ja-JP')).toBe('ja');
    expect(normalizeLang('jp')).toBe('ja');
    expect(normalizeLang('ko')).toBe('ko');
    expect(normalizeLang('ko_KR')).toBe('ko');
    expect(normalizeLang('kr')).toBe('ko');
    expect(normalizeLang('fr')).toBeNull();
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

  it('不同語系 key 不一致', () => {
    fixture();
    patch('zh-TW', 'sidebar', (d) => (d['Only In TW'] = '只有台灣'));
    const errs = errors();
    expect(errs.some((m) => m.includes('zh-TW 有、zh-CN 沒有'))).toBe(true);
    expect(errs.some((m) => m.includes('zh-TW 有、ja 沒有'))).toBe(true);
    expect(errs.some((m) => m.includes('zh-TW 有、ko 沒有'))).toBe(true);
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

  it('跨模組同名 key 譯文不一致', () => {
    fixture();
    patch('zh-TW', 'menu', (d) => (d['Copy'] = '拷貝'));
    expect(errors().some((m) => m.includes('同名 key 譯文不一致'))).toBe(true);
  });

  it('跨模組同名 key 譯文相同時不報錯也不警告', () => {
    const report = validateLocales(defaultLocalesDir());
    expect(report.issues).toEqual([]);
  });

  it('保護詞清單格式錯誤', () => {
    fixture();
    write(path.join(dir, 'protected-terms.json'), '{"terms": ["", "MCP"]}');
    expect(errors().some((m) => m.includes('不可含空字串'))).toBe(true);
  });
});
