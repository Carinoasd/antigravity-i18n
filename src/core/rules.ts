import fs from 'node:fs';
import path from 'node:path';
import { geminiRulesDir } from '../config/paths.js';
import { LANGS, type Lang } from '../types.js';

/**
 * 零侵入模式：不修改任何安裝檔，只在 `~/.gemini/config/rules/` 放一份
 * `trigger: always_on` 的全域規則，讓 Agent 全程以中文回覆。
 */

export const MANAGED_MARKER = '<!-- managed-by: antigravity-i18n -->';

export function rulesFileName(lang: Lang): string {
  return `language-${lang.toLowerCase()}.md`;
}

export function rulesFilePath(userHome: string, lang: Lang): string {
  return path.join(geminiRulesDir(userHome), rulesFileName(lang));
}

const CONTENT: Record<Lang, { description: string; body: string }> = {
  'zh-TW': {
    description: '一律使用繁體中文（台灣）回覆，並在說明介面操作時附註英文按鈕名稱',
    body: `# 語言規則：繁體中文（台灣）

- 所有回覆、Implementation Plan、Task 清單、Walkthrough 與程式碼說明，一律使用**繁體中文（台灣用語）**撰寫。
- 使用台灣慣用的技術術語：專案、設定、終端機、權限、工作區、擴充功能、命令選擇區、檔案、資料夾、程式碼、伺服器、預設。
- 說明介面操作時，請在中文名稱後以括號附註**英文原文**按鈕或選單名稱，方便對照尚未中文化的介面，例如：
  - 點選「設定（Settings）」→「權限（Permissions）」
  - 按下「全部接受（Accept All）」或「審查變更（Review Changes）」
- 以下內容保持英文原樣、不要翻譯：程式碼、終端機指令、檔案路徑、設定鍵值、API 名稱、錯誤訊息原文，以及斜線指令（如 \`/plan\`、\`/swarm\`）。
- 專有名詞保留英文：MCP、Git、SSH、Diff、Worktree、Agent、API、JSON。
- Git commit message 與程式碼註解遵循專案既有慣例；若專案沒有慣例，使用繁體中文。
- 即使使用者以其他語言提問，仍以繁體中文回覆，除非使用者明確要求改用其他語言。
`,
  },
  'zh-CN': {
    description: '始终使用简体中文回复，并在说明界面操作时附注英文按钮名称',
    body: `# 语言规则：简体中文

- 所有回复、Implementation Plan、Task 清单、Walkthrough 与代码说明，始终使用**简体中文**撰写。
- 使用中国大陆惯用的技术术语：项目、设置、终端、权限、工作区、扩展、命令面板、文件、文件夹、代码、服务器、默认。
- 说明界面操作时，请在中文名称后用括号附注**英文原文**按钮或菜单名称，方便对照尚未汉化的界面，例如：
  - 点击「设置（Settings）」→「权限（Permissions）」
  - 点击「全部接受（Accept All）」或「审查更改（Review Changes）」
- 以下内容保持英文原样、不要翻译：代码、终端命令、文件路径、配置键名、API 名称、错误信息原文，以及斜杠命令（如 \`/plan\`、\`/swarm\`）。
- 专有名词保留英文：MCP、Git、SSH、Diff、Worktree、Agent、API、JSON。
- Git commit message 与代码注释遵循项目既有惯例；若项目没有惯例，使用简体中文。
- 即使用户使用其他语言提问，仍以简体中文回复，除非用户明确要求改用其他语言。
`,
  },
  ja: {
    description: '常に日本語で回答し、UI操作を説明する際は英語のボタン名を併記する',
    body: `# 言語ルール：日本語

- すべての回答、Implementation Plan、Task リスト、Walkthrough、コード説明は**自然で正確な日本語**で記述してください。
- 日本の開発環境で一般的な技術用語を使用してください：プロジェクト、設定、ターミナル、権限、ワークスペース、拡張機能、コマンドパレット、ファイル、フォルダー、コード、サーバー、デフォルト。
- UI操作を説明する際は、日本語名の後ろに括弧で**英語原文**のボタン名やメニュー名を併記し、未翻訳のUIと照合しやすくしてください。例：
  - 「設定（Settings）」→「権限（Permissions）」を開く
  - 「すべて承認（Accept All）」または「変更をレビュー（Review Changes）」をクリックする
- 以下の内容は翻訳せず英語のまま保持してください：コード、ターミナルコマンド、ファイルパス、設定キー、API名、エラーメッセージ原文、およびスラッシュコマンド（例：\`/plan\`、\`/swarm\`）。
- 固有名詞・技術略語は英語のまま保持してください：MCP、Git、SSH、Diff、Worktree、Agent、API、JSON。
- Git コミットメッセージやコードコメントはプロジェクトの既存ルールに従い、特に定めがない場合は日本語で記述してください。
- ユーザーが他の言語で質問した場合でも、明示的な指示がない限り日本語で回答してください。
`,
  },
  ko: {
    description: '항상 한국어로 답변하며, UI 조작을 설명할 때 영문 버튼 이름을 함께 표기합니다',
    body: `# 언어 규칙: 한국어

- 모든 답변, Implementation Plan, Task 목록, Walkthrough 및 코드 설명은 **자연스럽고 정확한 한국어**로 작성하세요.
- 한국 개발 환경에서 널리 쓰이는 기술 용어를 사용하세요: 프로젝트, 설정, 터미널, 권한, 작업 영역, 확장 프로그램, 명령 팔레트, 파일, 폴더, 코드, 서버, 기본값.
- UI 조작을 설명할 때는 한국어 이름 뒤에 괄호로 **영문 원문** 버튼이나 메뉴 이름을 함께 표기하여 미번역 화면과 대조하기 쉽게 해주세요. 예:
  - 「설정 (Settings)」→「권한 (Permissions)」 열기
  - 「모두 수락 (Accept All)」 또는 「변경 사항 검토 (Review Changes)」 클릭
- 다음 항목은 번역하지 말고 원문 그대로 유지하세요: 코드, 터미널 명령어, 파일 경로, 설정 키, API 이름, 오류 메시지 원문 및 슬래시 명령어(예: \`/plan\`, \`/swarm\`).
- 고유명사와 기술 약어는 영문 그대로 유지하세요: MCP, Git, SSH, Diff, Worktree, Agent, API, JSON.
- Git 커밋 메시지와 코드 주석은 프로젝트의 기존 규칙을 따르며, 별도 규칙이 없으면 한국어로 작성하세요.
- 사용자가 다른 언어로 질문하더라도 명시적으로 변경을 요청하지 않는 한 한국어로 답변하세요.
`,
  },
};

/** 產生規則檔內容（含 YAML frontmatter） */
export function renderRules(lang: Lang): string {
  const c = CONTENT[lang];
  return `---
trigger: always_on
description: ${JSON.stringify(c.description)}
---
${MANAGED_MARKER}

${c.body}`;
}

/** 解析 YAML frontmatter（僅支援 `key: value` 單行格式） */
export function parseFrontmatter(text: string): Record<string, string> | null {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m?.[1]) return null;
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv?.[1]) continue;
    let v = (kv[2] ?? '').trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      try {
        v = JSON.parse(v) as string;
      } catch {
        /* keep raw */
      }
    } else if (v.startsWith("'") && v.endsWith("'")) {
      v = v.slice(1, -1);
    }
    out[kv[1]] = v;
  }
  return out;
}

export interface RulesFileStatus {
  lang: Lang;
  path: string;
  exists: boolean;
  managed: boolean;
  upToDate: boolean;
  trigger?: string;
}

export function rulesStatus(userHome: string): RulesFileStatus[] {
  return LANGS.map((lang) => {
    const p = rulesFilePath(userHome, lang);
    if (!fs.existsSync(p)) return { lang, path: p, exists: false, managed: false, upToDate: false };
    const text = fs.readFileSync(p, 'utf8');
    return {
      lang,
      path: p,
      exists: true,
      managed: text.includes(MANAGED_MARKER),
      upToDate: text === renderRules(lang),
      trigger: parseFrontmatter(text)?.trigger,
    };
  });
}

export interface InstallRulesResult {
  path: string;
  action: 'created' | 'updated' | 'unchanged';
  /** 為避免中英規則互相衝突而移除的另一語系規則檔 */
  removedOther: string[];
}

export function installRules(userHome: string, lang: Lang, opts: { force?: boolean } = {}): InstallRulesResult {
  const p = rulesFilePath(userHome, lang);
  const content = renderRules(lang);
  let action: InstallRulesResult['action'] = 'created';
  if (fs.existsSync(p)) {
    const current = fs.readFileSync(p, 'utf8');
    if (current === content) action = 'unchanged';
    else if (!current.includes(MANAGED_MARKER) && !opts.force) {
      throw new Error(`${p} 已存在且不是由 antigravity-i18n 建立，為避免覆蓋你的自訂規則已中止；確定要覆蓋請加上 --force`);
    } else action = 'updated';
  }
  if (action !== 'unchanged') {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  const removedOther: string[] = [];
  for (const other of LANGS) {
    if (other === lang) continue;
    const op = rulesFilePath(userHome, other);
    if (fs.existsSync(op) && fs.readFileSync(op, 'utf8').includes(MANAGED_MARKER)) {
      fs.rmSync(op);
      removedOther.push(op);
    }
  }
  return { path: p, action, removedOther };
}

export interface RemoveRulesResult {
  removed: string[];
  skipped: { path: string; reason: string }[];
}

/** 移除規則檔；未指定語系時移除全部由本工具管理的規則檔 */
export function removeRules(userHome: string, lang?: Lang, opts: { force?: boolean } = {}): RemoveRulesResult {
  const result: RemoveRulesResult = { removed: [], skipped: [] };
  for (const l of lang ? [lang] : [...LANGS]) {
    const p = rulesFilePath(userHome, l);
    if (!fs.existsSync(p)) continue;
    const managed = fs.readFileSync(p, 'utf8').includes(MANAGED_MARKER);
    if (!managed && !opts.force) {
      result.skipped.push({ path: p, reason: '不是由 antigravity-i18n 建立（加上 --force 仍可移除）' });
      continue;
    }
    fs.rmSync(p);
    result.removed.push(p);
  }
  return result;
}
