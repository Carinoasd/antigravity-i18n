import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { geminiRulesDir } from '../src/config/paths.js';
import {
  MANAGED_MARKER,
  installRules,
  parseFrontmatter,
  removeRules,
  renderRules,
  rulesFileName,
  rulesFilePath,
  rulesStatus,
} from '../src/core/rules.js';
import { rm, tmpDir, write } from './helpers.js';

let home: string;
beforeEach(() => {
  home = tmpDir();
});
afterEach(() => rm(home));

describe('規則內容', () => {
  it('檔名', () => {
    expect(rulesFileName('zh-TW')).toBe('language-zh-tw.md');
    expect(rulesFileName('zh-CN')).toBe('language-zh-cn.md');
    expect(rulesFileName('ja')).toBe('language-ja.md');
    expect(rulesFileName('ko')).toBe('language-ko.md');
    expect(rulesFilePath(home, 'zh-TW')).toBe(path.join(home, '.gemini', 'config', 'rules', 'language-zh-tw.md'));
  });

  it.each(['zh-TW', 'zh-CN', 'ja', 'ko'] as const)('%s 含正確的 YAML frontmatter', (lang) => {
    const text = renderRules(lang);
    expect(text.startsWith('---\ntrigger: always_on\n')).toBe(true);
    const fm = parseFrontmatter(text)!;
    expect(fm.trigger).toBe('always_on');
    expect(fm.description?.length ?? 0).toBeGreaterThan(10);
    expect(text).toContain(MANAGED_MARKER);
    expect(text).toContain('Settings');
    expect(text).toContain('/plan');
  });

  it('各語系規則用語正確', () => {
    expect(renderRules('zh-TW')).toContain('繁體中文');
    expect(renderRules('zh-TW')).toContain('終端機');
    expect(renderRules('zh-CN')).toContain('简体中文');
    expect(renderRules('zh-CN')).toContain('命令面板');
    expect(renderRules('ja')).toContain('日本語');
    expect(renderRules('ja')).toContain('コマンドパレット');
    expect(renderRules('ko')).toContain('한국어');
    expect(renderRules('ko')).toContain('명령 팔레트');
  });
});

describe('install / remove / status', () => {
  it('安裝、重複安裝不變、狀態正確', () => {
    const r = installRules(home, 'zh-TW');
    expect(r.action).toBe('created');
    expect(fs.readFileSync(r.path, 'utf8')).toBe(renderRules('zh-TW'));
    expect(installRules(home, 'zh-TW').action).toBe('unchanged');
    const st = rulesStatus(home);
    expect(st.find((s) => s.lang === 'zh-TW')).toMatchObject({ exists: true, managed: true, upToDate: true, trigger: 'always_on' });
    expect(st.find((s) => s.lang === 'zh-CN')).toMatchObject({ exists: false });
  });

  it('切換語系時移除另一語系規則以避免衝突', () => {
    installRules(home, 'zh-TW');
    const r = installRules(home, 'zh-CN');
    expect(r.removedOther).toEqual([rulesFilePath(home, 'zh-TW')]);
    expect(fs.existsSync(rulesFilePath(home, 'zh-TW'))).toBe(false);
  });

  it('舊版受管規則會被更新', () => {
    const p = write(rulesFilePath(home, 'zh-TW'), `---\ntrigger: always_on\n---\n${MANAGED_MARKER}\nold`);
    expect(rulesStatus(home)[0]!.upToDate).toBe(false);
    expect(installRules(home, 'zh-TW').action).toBe('updated');
    expect(fs.readFileSync(p, 'utf8')).toBe(renderRules('zh-TW'));
  });

  it('不覆蓋、不刪除使用者自訂的同名規則（除非 --force）', () => {
    const p = write(rulesFilePath(home, 'zh-TW'), '# my own rule\n');
    expect(() => installRules(home, 'zh-TW')).toThrow(/--force/);
    expect(removeRules(home).skipped).toHaveLength(1);
    expect(fs.readFileSync(p, 'utf8')).toBe('# my own rule\n');
    expect(installRules(home, 'zh-TW', { force: true }).action).toBe('updated');
  });

  it('移除指定語系或全部', () => {
    installRules(home, 'zh-CN');
    expect(removeRules(home, 'zh-TW').removed).toEqual([]);
    expect(removeRules(home).removed).toEqual([rulesFilePath(home, 'zh-CN')]);
    expect(fs.readdirSync(geminiRulesDir(home))).toEqual([]);
  });
});
