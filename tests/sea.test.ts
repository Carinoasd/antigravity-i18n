import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchInteractive, waitForEnter } from '../src/commands/ui.js';
import { EMBEDDED_LOCALES_DIR, embeddedKey, isStandalone, setEmbeddedForTest, type EmbeddedResources } from '../src/core/embedded.js';
import { LocaleError, defaultLocalesDir, loadDictionary, loadModule, loadProtectedTerms, readToolVersion, validateLocales } from '../src/core/locales.js';
import { LOCALE_MODULES, TARGET_MODULES } from '../src/types.js';
import { rm, tmpDir } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 與 scripts/build-sea.mjs 相同的方式收集 locales/ */
function realEmbedded(): EmbeddedResources {
  const dir = path.join(root, 'locales');
  const locales: Record<string, unknown> = {};
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json')) locales[path.relative(dir, full).split(path.sep).join('/')] = JSON.parse(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return { version: '9.8.7', locales };
}

afterEach(() => {
  setEmbeddedForTest(undefined);
  vi.restoreAllMocks();
});

describe('單檔執行檔：內嵌詞庫與版本', () => {
  it('一般模式讀取實體檔案', () => {
    expect(isStandalone()).toBe(false);
    expect(defaultLocalesDir()).toBe(path.join(root, 'locales'));
    expect(readToolVersion()).toBe(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
  });

  it('內嵌模式：版本、7 個模組與保護詞都從內嵌資源讀取', () => {
    setEmbeddedForTest(realEmbedded());
    expect(isStandalone()).toBe(true);
    expect(defaultLocalesDir()).toBe(EMBEDDED_LOCALES_DIR);
    expect(readToolVersion()).toBe('9.8.7');
    for (const mod of LOCALE_MODULES) expect(Object.keys(loadModule(defaultLocalesDir(), 'zh-TW', mod)).length).toBeGreaterThan(0);
    expect(loadDictionary('zh-CN', TARGET_MODULES.app)['Settings']).toBe('设置');
    expect(loadProtectedTerms()).toContain('/plan');
    const report = validateLocales(defaultLocalesDir());
    expect(report.issues).toEqual([]);
    expect(report.keyCount['zh-TW']).toBeGreaterThanOrEqual(298);
  });

  it('內嵌模式不讀取磁碟上的 locales/', () => {
    const spy = vi.spyOn(fs, 'readFileSync');
    setEmbeddedForTest(realEmbedded());
    spy.mockClear();
    loadDictionary('zh-TW', LOCALE_MODULES);
    loadProtectedTerms();
    readToolVersion();
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('locales') || String(c[0]).endsWith('package.json'))).toEqual([]);
  });

  it('內嵌資源缺檔時回報 LocaleError', () => {
    const e = realEmbedded();
    delete e.locales['zh-CN/menu.json'];
    setEmbeddedForTest(e);
    expect(() => loadModule(defaultLocalesDir(), 'zh-CN', 'menu')).toThrow(LocaleError);
    expect(validateLocales(defaultLocalesDir()).ok).toBe(false);
  });

  it('validate --dir 指定實體目錄時仍讀取磁碟', () => {
    setEmbeddedForTest(realEmbedded());
    expect(validateLocales(path.join(root, 'locales')).ok).toBe(true);
  });

  it('embeddedKey 同時接受 / 與 \\\\ 分隔', () => {
    expect(embeddedKey(`${EMBEDDED_LOCALES_DIR}/zh-TW/chat.json`)).toBe('zh-TW/chat.json');
    expect(embeddedKey('<embedded>\\locales\\zh-CN\\ide.json')).toBe('zh-CN/ide.json');
    expect(embeddedKey(`${EMBEDDED_LOCALES_DIR}/protected-terms.json`)).toBe('protected-terms.json');
    expect(embeddedKey(path.join(root, 'locales', 'zh-TW', 'chat.json'))).toBeNull();
  });
});

describe('雙擊保護', () => {
  const tty = (): PassThrough & { isTTY: boolean } => Object.assign(new PassThrough(), { isTTY: true });

  it('互動式終端機：印出提示並等到按下 Enter', async () => {
    const input = tty();
    const output = new PassThrough();
    let done = false;
    const p = waitForEnter('按 Enter 鍵結束…', input, output).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    expect(String(output.read())).toContain('按 Enter 鍵結束…');
    input.write('x');
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    input.write('\r\n');
    await p;
    expect(done).toBe(true);
  });

  it('非互動（管線）時不等待', async () => {
    const output = new PassThrough();
    await waitForEnter('x', new PassThrough(), output);
    expect(output.read()).toBeNull();
  });

  it('啟動失敗時印出錯誤並等待；成功時不等待', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.join(' ')));
    const wait = vi.fn(() => Promise.resolve());
    const code = await launchInteractive(() => Promise.reject(new Error('listen EADDRINUSE')), wait);
    expect(code).toBe(1);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(errors.join('\n')).toContain('無法啟動 Antigravity 中文化控制台：listen EADDRINUSE');
    expect(errors.join('\n')).toContain('issues');

    const ok = vi.fn(() => Promise.resolve());
    expect(await launchInteractive(() => Promise.resolve(0), ok)).toBe(0);
    expect(ok).not.toHaveBeenCalled();
  });
});

describe('esbuild bundle（單檔執行檔的內容）', () => {
  it('打包後以 node 執行完整冒煙測試：內嵌詞庫、套用、注入腳本序列化、還原、控制台', () => {
    const out = tmpDir('agi18n-bundle-');
    try {
      const build = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-sea.mjs'), '--bundle-only', '--out', out], { encoding: 'utf8' });
      expect(build.status, build.stderr + build.stdout).toBe(0);
      const bundle = path.join(out, 'antigravity-i18n.cjs');
      const src = fs.readFileSync(bundle, 'utf8');
      // 不可開啟 keepNames：__name() helper 會讓序列化的注入腳本不再自足
      expect(src).not.toMatch(/var __name = /);
      expect(src).toContain('"zh-TW/settings.json"');

      const smoke = spawnSync(process.execPath, [path.join(root, 'scripts', 'smoke-sea.mjs'), '--', 'node', bundle], { encoding: 'utf8', timeout: 180_000 });
      expect(smoke.status, smoke.stdout + smoke.stderr).toBe(0);
      expect(smoke.stdout).toContain('全部通過');
      expect(smoke.stdout).not.toContain('✖');
    } finally {
      rm(out);
    }
  }, 240_000);
});
