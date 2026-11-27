/** 支援的語系 */
export const LANGS = ['zh-TW', 'zh-CN'] as const;
export type Lang = (typeof LANGS)[number];

/** 支援的中文化目標 */
export const TARGET_IDS = ['app', 'ide', 'cli'] as const;
export type TargetId = (typeof TARGET_IDS)[number];
export type TargetSelector = TargetId | 'all';

/** 詞庫模組（每個語系各一份 JSON） */
export const LOCALE_MODULES = ['sidebar', 'settings', 'permissions', 'chat', 'ide', 'cli', 'menu'] as const;
export type LocaleModule = (typeof LOCALE_MODULES)[number];

/** 每個目標會載入哪些詞庫模組 */
export const TARGET_MODULES: Record<TargetId, readonly LocaleModule[]> = {
  app: ['sidebar', 'settings', 'permissions', 'chat', 'menu'],
  ide: ['sidebar', 'settings', 'permissions', 'chat', 'ide'],
  cli: ['cli', 'permissions', 'chat'],
};

export const TARGET_LABELS: Record<TargetId, string> = {
  app: 'Antigravity App（桌面版）',
  ide: 'Antigravity IDE',
  cli: 'Antigravity CLI（agy）',
};

/** 英文原文 → 譯文 */
export type Dictionary = Record<string, string>;

export interface ProtectedTermsFile {
  description?: string;
  terms: string[];
}

/**
 * 偵測到的安裝目標。
 * - `asar`：Electron `app.asar`，`files[0]` 為 asar 路徑
 * - `files`：直接修補純文字檔（JS / JSON / HTML）
 */
export interface DetectedTarget {
  id: TargetId;
  installRoot: string;
  kind: 'asar' | 'files';
  files: string[];
  /** VS Code 系列的 product.json（需同步更新 checksums，避免「安裝已損毀」警告） */
  productJson?: string;
  /** product.json checksums 的相對路徑基準（通常為 `<app>/out`） */
  checksumBase?: string;
  /** macOS Info.plist（需同步更新 ElectronAsarIntegrity） */
  infoPlist?: string;
  source: 'auto' | 'custom';
  supported: boolean;
  reason?: string;
}

export type ManifestFileRole = 'content' | 'checksum' | 'integrity';

export interface ManifestFile {
  path: string;
  role: ManifestFileRole;
  originalSha256: string;
  patchedSha256: string;
  backupPath: string;
  hits: number;
}

export interface TranslateStats {
  totalKeys: number;
  matchedKeys: number;
  totalHits: number;
  /** matchedKeys / totalKeys，0 ~ 1 */
  coverage: number;
  hitsByKey: Record<string, number>;
}

export interface Manifest {
  schemaVersion: 1;
  tool: 'antigravity-i18n';
  toolVersion: string;
  target: TargetId;
  lang: Lang;
  kind: DetectedTarget['kind'];
  installRoot: string;
  appliedAt: string;
  backupDir: string;
  files: ManifestFile[];
  stats: Omit<TranslateStats, 'hitsByKey'>;
  /** asar 目標的執行期注入層（未啟用時不存在） */
  runtime?: { entries: number; mainEntry: string; runtimeFile: string };
}
