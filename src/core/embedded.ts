import path from 'node:path';

/**
 * 單檔執行檔（Node.js SEA）的內嵌資源。
 *
 * `scripts/build-sea.mjs` 以 esbuild 的 `define` 把 `locales/` 全部檔案與
 * `package.json` 的版本號內嵌成 `__AGI18N_EMBEDDED__`。執行檔旁邊沒有
 * `locales/` 資料夾，因此詞庫與版本改從這裡讀取。
 *
 * 一般開發（tsc / vitest）與 `npx` 模式中這個識別字不存在，維持讀取實體檔案。
 */

export interface EmbeddedResources {
  version: string;
  /** `locales/` 下的檔案：相對路徑（`/` 分隔，例如 `zh-TW/chat.json`）→ 已解析的 JSON */
  locales: Record<string, unknown>;
}

declare const __AGI18N_EMBEDDED__: EmbeddedResources | undefined;

/** 單檔模式下的虛擬詞庫目錄 */
export const EMBEDDED_LOCALES_DIR = '<embedded>/locales';

let override: EmbeddedResources | null | undefined;

export function getEmbedded(): EmbeddedResources | null {
  if (override !== undefined) return override;
  return typeof __AGI18N_EMBEDDED__ !== 'undefined' ? __AGI18N_EMBEDDED__ : null;
}

/** 測試用：模擬單檔模式（傳入 undefined 恢復預設行為） */
export function setEmbeddedForTest(resources: EmbeddedResources | null | undefined): void {
  override = resources;
}

/** 是否以單檔執行檔（內嵌資源）模式執行 */
export function isStandalone(): boolean {
  return getEmbedded() !== null;
}

/** 檔案位於虛擬詞庫目錄時，回傳其相對路徑（`/` 分隔）；否則 null */
export function embeddedKey(file: string): string | null {
  const norm = file.split(path.sep).join('/').replace(/\\/g, '/');
  const prefix = `${EMBEDDED_LOCALES_DIR}/`;
  return norm.startsWith(prefix) ? norm.slice(prefix.length) : null;
}
