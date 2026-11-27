import { describe, expect, it } from 'vitest';
import { Translator, isDistinctive, mergeHits, emptyStats, translateContent } from '../src/core/translator.js';

const dict = {
  Settings: '設定',
  Run: '執行',
  Off: '關閉',
  'Accept All': '全部接受',
  "No, I don't trust the authors": '否，我不信任作者',
  '{count} files changed': '已變更 {count} 個檔案',
  'Reading file %s': '正在讀取檔案 %s',
  'Open Diff': '開啟 Diff',
};

describe('code 模式（JS bundle）', () => {
  const t = new Translator(dict);

  it('在 UI 語境替換短字串', () => {
    const src = `const a={label:"Settings",title:'Run'};x.jsx("span",{children:"Off"});`;
    const r = t.translate(src, { filename: 'main.js' });
    expect(r.output).toBe(`const a={label:"設定",title:'執行'};x.jsx("span",{children:"關閉"});`);
    expect(r.totalHits).toBe(3);
  });

  it('非 UI 語境的短字串不替換（避免破壞列舉值與邏輯）', () => {
    const src = `if(mode==="Off"){run("Run")}const k={type:"Settings"};`;
    const r = t.translate(src, { filename: 'main.js' });
    expect(r.output).toBe(src);
    expect(r.changed).toBe(false);
  });

  it('長字串在任何位置都會替換', () => {
    const src = `foo("Accept All");bar(\`{count} files changed\`)`;
    const r = t.translate(src, { filename: 'a.js' });
    expect(r.output).toBe(`foo("全部接受");bar(\`已變更 {count} 個檔案\`)`);
  });

  it('處理單引號跳脫', () => {
    const src = `m('No, I don\\'t trust the authors');n("No, I don't trust the authors")`;
    const r = t.translate(src, { filename: 'a.js' });
    expect(r.output).toBe(`m('否，我不信任作者');n("否，我不信任作者")`);
    expect(r.hits["No, I don't trust the authors"]).toBe(2);
  });

  it('localize() 與 createElement() 語境', () => {
    const src = `localize("settings.title","Settings");React.createElement("b",null,"Run")`;
    expect(t.translate(src, { filename: 'a.js' }).output).toBe(`localize("settings.title","設定");React.createElement("b",null,"執行")`);
  });

  it('不替換部分相符字串', () => {
    const src = `{label:"Settings Sync"}`;
    expect(t.translate(src, { filename: 'a.js' }).changed).toBe(false);
  });

  it('保留佔位符', () => {
    const r = t.translate(`{message:"Reading file %s"}`, { filename: 'a.js' });
    expect(r.output).toBe(`{message:"正在讀取檔案 %s"}`);
  });
});

describe('json 模式', () => {
  const t = new Translator(dict);

  it('nls.messages.json 的所有字串都會替換', () => {
    const src = JSON.stringify(['Settings', 'Off', 'Something else']);
    const r = t.translate(src, { filename: 'out/nls.messages.json' });
    expect(JSON.parse(r.output)).toEqual(['設定', '關閉', 'Something else']);
  });

  it('一般 JSON 只替換 UI 屬性的值，不動 key 與設定值', () => {
    const src = `{\n  "Settings": "Settings",\n  "title": "Settings",\n  "default": "Off",\n  "enumDescriptions": ["Off"]\n}\n`;
    const r = t.translate(src, { filename: 'package.json' });
    expect(JSON.parse(r.output)).toEqual({ Settings: 'Settings', title: '設定', default: 'Off', enumDescriptions: ['關閉'] });
    expect(r.output.endsWith('\n')).toBe(true);
    expect(r.output).toContain('\n  "title"');
  });

  it('保留 BOM', () => {
    const r = t.translate('﻿{"label":"Run"}', { filename: 'x.json' });
    expect(r.output).toBe('﻿{"label":"執行"}');
  });

  it('無效 JSON 退回 code 模式', () => {
    const r = t.translate('{label:"Run",', { filename: 'broken.json' });
    expect(r.output).toBe('{label:"執行",');
  });
});

describe('html 模式', () => {
  it('替換文字節點、屬性與內嵌 script', () => {
    const src = `<button title="Settings"> Run </button><script>x={label:"Off"}</script><p>Open Diff</p>`;
    const r = translateContent(src, dict, { filename: 'index.html' });
    expect(r.output).toBe(`<button title="設定"> 執行 </button><script>x={label:"關閉"}</script><p>開啟 Diff</p>`);
    expect(r.totalHits).toBe(4);
  });
});

describe('統計', () => {
  it('isDistinctive', () => {
    expect(isDistinctive('Accept All')).toBe(true);
    expect(isDistinctive('Run')).toBe(false);
    expect(isDistinctive('Sign In')).toBe(false);
  });

  it('mergeHits 計算覆蓋率', () => {
    const s = emptyStats(4);
    mergeHits(s, { a: 2, b: 1 });
    mergeHits(s, { a: 1 });
    expect(s).toMatchObject({ matchedKeys: 2, totalHits: 4, coverage: 0.5 });
  });
});
