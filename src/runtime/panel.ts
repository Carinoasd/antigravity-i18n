/**
 * 介面內背景設定面板（renderer 端）。
 *
 * 由主行程掛鉤在每次視窗 `dom-ready` 時注入：
 *
 *   (function () {
 *     var applyBackground = <applyBackground 原始碼>;
 *     (<antigravityI18nPanel 原始碼>)(applyBackground, { cli, presets, maxBytes, version });
 *   })();
 *
 * - `Ctrl + Alt + B`（macOS `Cmd + Option + B`）開關面板，`Esc` 或點面板外關閉
 * - 在「設定 → 外觀（Appearance）」頁面時，右下角顯示「背景設定」小按鈕
 * - 選圖、切換預設、調整參數**立即生效**，並存進 IndexedDB（`antigravity-i18n`）
 * - 優先順序：IndexedDB 內的介面設定 > 主行程從 `background.json` 讀入的 CLI 設定
 * - IndexedDB 不可用時降級為「只在目前視窗生效」，絕不拋錯
 * - 「掃描未翻譯英文」：列出本頁仍是英文、詞庫沒有對應的介面字串，可複製成 JSON 或前往 GitHub 回報
 *   （跳過與 overlay 相同的保護區與表單內容）
 * - 桌布收藏夾（IndexedDB `gallery` store，資料庫版本 2）：單張 ≤ 10 MB、最多 12 張、總容量 ≤ 30 MB；
 *   自動輪播（關閉／每次開啟視窗／15、30、60 分鐘）。平時只在記憶體保留目前這一張圖片與收藏的 id，
 *   縮圖只在面板開啟時讀取、關閉即釋放
 * - 外觀微調：CJK 介面字型最佳化、毛玻璃卡片模式（各自獨立的 <style>，開關立即生效／移除）
 * - 五語即時切換（繁中／簡中／日文／韓文／English 原文），由翻譯 runtime 的 setLang() 免重整完成
 *
 * ⚠️ 此函式會被 `toString()` 序列化：必須完全自足（不可引用模組層級變數、import 或其他
 *    函式），任何錯誤只能 `console.warn`。`applyBackground` 由掛鉤以參數傳入。
 */

import type { BackgroundPayload } from './background.js';

export interface PanelPreset {
  label: string;
  image: string;
}

export interface PanelConfig {
  /** 主行程從 background.json 讀入的 CLI 設定（沒有或停用時為 null） */
  cli: BackgroundPayload | null;
  presets: Record<string, PanelPreset>;
  maxBytes: number;
  version: number;
}

export type PanelSource = 'cli' | 'image' | 'preset' | 'gallery';

/** 存在 IndexedDB 的介面設定 */
export interface PanelSettings {
  enabled: boolean;
  /** cli：沿用 CLI 的背景來源，只覆寫參數；image：介面選的圖片；preset：內建預設 */
  source: PanelSource;
  dataUrl?: string;
  preset?: string;
  /** source 為 gallery 時：收藏夾中的圖片 id（圖片本身不重複存進設定） */
  galleryId?: string;
  opacity: number;
  blur: number;
  position: string;
  size: 'cover' | 'contain';
  /** 空字串表示不套用遮罩 */
  tint: string;
  mode: 'overlay' | 'underlay';
  updatedAt?: string;
}

export type SlideshowMode = 'off' | 'on-launch' | '15m' | '30m' | '60m';

/** 面板偏好（與背景設定分開存放：按「重設」只會清除背景設定） */
export interface PanelPrefs {
  /** CJK 介面字型最佳化 */
  cjkFont: boolean;
  /** 毛玻璃卡片模式 */
  glass: boolean;
  slideshow: SlideshowMode;
}

/** 收藏夾中的一張圖片（IndexedDB `gallery` store，keyPath 為 id） */
export interface GalleryItem {
  id: string;
  dataUrl: string;
  /** 小縮圖（JPEG data URL）；無法產生時不存在：小圖直接用原圖顯示，大圖顯示編號 */
  thumb?: string;
  /** dataUrl 的 FNV-1a 雜湊（去重用） */
  hash: string;
  addedAt: string;
}

export interface GalleryMeta {
  id: string;
  /** 圖片位元組數（由 dataUrl 計算，不信任儲存的值） */
  size: number;
  thumb: string;
  hash: string;
  addedAt: string;
}

/** IndexedDB 版本：1 只有 settings；2 新增 gallery */
export const PANEL_DB_VERSION = 2;
export const GALLERY_MAX_ITEMS = 12;
export const GALLERY_MAX_TOTAL = 30 * 1024 * 1024;
export const SLIDESHOW_MS: Record<SlideshowMode, number> = { off: 0, 'on-launch': 0, '15m': 15 * 60_000, '30m': 30 * 60_000, '60m': 60 * 60_000 };
/** CJK 介面字型堆疊（只套用在一般介面，不影響程式碼等寬字型） */
export const CJK_FONT_STACK = '"PingFang TC", "Microsoft JhengHei UI", "Noto Sans CJK TC", "Hiragino Sans", "Malgun Gothic", sans-serif';

/** 「前往 GitHub 回報」的連結（缺少翻譯的 issue 範本） */
export const MISSING_TRANSLATION_URL = 'https://github.com/Carinoasd/antigravity-i18n/issues/new?template=missing-translation.yml';
/** 掃描結果的字串長度上限：超過視為段落（多半是正文）而略過 */
export const SCAN_MAX_LEN = 120;

export interface PanelHandle {
  readonly isOpen: boolean;
  /** IndexedDB 是否可用（false 表示只在目前視窗生效） */
  readonly persistent: boolean;
  /** 讀取 IndexedDB 並套用背景後 resolve */
  readonly ready: Promise<void>;
  open(): void;
  close(): void;
  toggle(): void;
  /** 目前的介面設定；null 表示完全跟隨 CLI */
  settings(): PanelSettings | null;
  /** 主行程重新注入時更新 CLI 設定 */
  updateCli(p: BackgroundPayload | null): void;
  /** 掃描本頁未翻譯的英文介面字串（去重、排序），並更新面板上的預覽 */
  scan(): string[];
  /** 最近一次掃描結果輸出成 `{ "Original Text": "" }` 格式的 JSON */
  scanJson(): string;
  /** 目前的面板偏好 */
  prefs(): PanelPrefs;
  /** 變更偏好（立即生效並寫入 IndexedDB） */
  setPrefs(patch: Partial<PanelPrefs>): void;
  /** 讀取收藏夾（縮圖與大小），同時更新面板上的縮圖列 */
  gallery(): Promise<GalleryMeta[]>;
  /** 把目前的背景圖片加入收藏夾；成功時回傳新 id */
  addToGallery(): Promise<string | null>;
  /** 切換到收藏夾中的某張圖片 */
  selectGallery(id: string): Promise<boolean>;
  /** 從收藏夾刪除 */
  removeGallery(id: string): Promise<boolean>;
  /** 輪播：切換到下一張收藏 */
  next(): Promise<boolean>;
  /** 切換介面語系（zh-TW / zh-CN / ja / ko / en） */
  setLang(lang: string): void;
}

export function antigravityI18nPanel(applyBackground: (p: BackgroundPayload) => void, cfg: PanelConfig): void {
  const MARK = '__ANTIGRAVITY_I18N_PANEL__';
  const g = globalThis as unknown as Record<string, unknown> & {
    document?: Document;
    indexedDB?: IDBFactory;
    localStorage?: Storage;
    FileReader?: typeof FileReader;
    MutationObserver?: typeof MutationObserver;
    location?: Location;
    __ANTIGRAVITY_I18N_BG__?: { stop(): void };
    __ANTIGRAVITY_I18N__?: {
      enabled?: boolean;
      lang?: string;
      availableLangs?: string[];
      stop(): void;
      resume?: () => void;
      setLang?: (lang: string) => void;
      translate?: (text: string) => string | null;
    };
    navigator?: Navigator;
    getComputedStyle?: (el: Element) => CSSStyleDeclaration;
    createImageBitmap?: (b: Blob) => Promise<ImageBitmap>;
    atob?: (s: string) => string;
    Blob?: typeof Blob;
    setInterval?: typeof setInterval;
    clearInterval?: typeof clearInterval;
  };
  const warn = (msg: string, e?: unknown): void => {
    console.warn(`[antigravity-i18n] panel: ${msg}`, e instanceof Error ? e.message : (e ?? ''));
  };

  try {
    // 同一份文件只安裝一次；重複注入時只更新 CLI 設定
    const existing = g[MARK] as PanelHandle | undefined;
    if (existing) {
      existing.updateCli(cfg.cli);
      return;
    }
    const doc = g.document;
    if (!doc || !doc.documentElement) return;

    const DB_NAME = 'antigravity-i18n';
    const DB_VERSION = 2;
    const STORE = 'settings';
    const GALLERY = 'gallery';
    const KEY = 'background';
    const PREFS_KEY = 'prefs';
    const MAX_ITEMS = 12;
    const MAX_TOTAL = 30 * 1024 * 1024;
    const THUMB_MAX = 200 * 1024;
    const ID_RE = /^g[a-z0-9]{6,32}$/;
    const HASH_RE = /^[0-9a-f]{8}$/;
    const SLIDES: Record<string, number> = { off: 0, 'on-launch': 0, '15m': 15 * 60_000, '30m': 30 * 60_000, '60m': 60 * 60_000 };
    const FONT_STACK = '"PingFang TC", "Microsoft JhengHei UI", "Noto Sans CJK TC", "Hiragino Sans", "Malgun Gothic", sans-serif';
    const LANG_LABELS: [string, string][] = [
      ['zh-TW', '繁體中文'],
      ['zh-CN', '简体中文'],
      ['ja', '日本語'],
      ['ko', '한국어'],
      ['en', 'English（原文）'],
    ];
    const I18N_KEY = 'antigravity-i18n:i18n-disabled';
    const SKIP = 'data-antigravity-i18n-skip';
    const MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    const DATA_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
    const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];
    const TINTS: [string, string][] = [
      ['', '無'],
      ['rgba(0,0,0,0.25)', '暗色 25%'],
      ['rgba(0,0,0,0.45)', '深暗 45%'],
      ['rgba(10,25,60,0.35)', '深藍 35%'],
    ];
    const APPEARANCE = ['Appearance', '外觀', '外观', '外観', '모양', '외관'];
    const presets = cfg.presets && typeof cfg.presets === 'object' ? cfg.presets : {};
    const maxBytes = typeof cfg.maxBytes === 'number' && cfg.maxBytes > 0 ? cfg.maxBytes : 10 * 1024 * 1024;
    const hasPreset = (n: unknown): n is string =>
      typeof n === 'string' && Object.prototype.hasOwnProperty.call(presets, n) && typeof presets[n]?.image === 'string';

    let cli: BackgroundPayload | null = cfg.cli ?? null;
    let ui: PanelSettings | null = null;
    let prefs: PanelPrefs = { cjkFont: false, glass: false, slideshow: 'off' };
    /** source 為 gallery 時目前顯示的圖片（只在記憶體保留這一張） */
    let galleryImage: string | null = null;
    /** 收藏的 id（依加入時間排序）；圖片本身不常駐記憶體 */
    let galleryKeys: string[] = [];
    let db: IDBDatabase | null = null;
    let persistent = false;
    let isOpen = false;

    // ── 設定 ──────────────────────────────────────────────
    const clamp = (v: unknown, def: number, min: number, max: number): number => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };
    const fromCli = (): PanelSettings => ({
      enabled: true,
      source: 'cli',
      opacity: clamp(cli?.opacity, 0.12, 0.01, 1),
      blur: clamp(cli?.blur, 0, 0, 32),
      position: cli && POSITIONS.includes(cli.position) ? cli.position : 'center',
      size: cli?.size === 'contain' ? 'contain' : 'cover',
      tint: TINTS.some((t) => t[0] === cli?.tint) ? (cli?.tint ?? '') : '',
      mode: cli?.mode === 'underlay' ? 'underlay' : 'overlay',
    });
    /** IndexedDB 內的資料可能被竄改：一律重新驗證 */
    const sanitize = (raw: unknown): PanelSettings | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const source: PanelSource = r.source === 'image' || r.source === 'preset' || r.source === 'gallery' ? r.source : 'cli';
      const s: PanelSettings = {
        enabled: r.enabled !== false,
        source,
        opacity: clamp(r.opacity, 0.12, 0.01, 1),
        blur: clamp(r.blur, 0, 0, 32),
        position: typeof r.position === 'string' && POSITIONS.includes(r.position) ? r.position : 'center',
        size: r.size === 'contain' ? 'contain' : 'cover',
        tint: TINTS.some((t) => t[0] === r.tint) ? (r.tint as string) : '',
        mode: r.mode === 'underlay' ? 'underlay' : 'overlay',
        updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
      };
      if (source === 'image') {
        if (typeof r.dataUrl !== 'string' || !DATA_RE.test(r.dataUrl)) return null;
        s.dataUrl = r.dataUrl;
      }
      if (source === 'preset') {
        if (!hasPreset(r.preset)) return null;
        s.preset = r.preset;
      }
      if (source === 'gallery') {
        if (typeof r.galleryId !== 'string' || !ID_RE.test(r.galleryId)) return null;
        s.galleryId = r.galleryId;
      }
      return s;
    };

    // ── 收藏夾的驗證工具 ──────────────────────────────────
    /** base64 data URL 解碼後的位元組數 */
    const bytesOf = (dataUrl: string): number => {
      const b64 = dataUrl.length - dataUrl.indexOf(',') - 1;
      const pad = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
      return Math.max(0, Math.floor((b64 * 3) / 4) - pad);
    };
    /** FNV-1a 32-bit（去重用，不是安全雜湊） */
    const fnv = (str: string): string => {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    };
    const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
    /** IndexedDB 內的收藏可能被竄改：一律重新驗證格式與大小 */
    const validItem = (raw: unknown): GalleryItem | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
      if (typeof r.dataUrl !== 'string' || !DATA_RE.test(r.dataUrl) || bytesOf(r.dataUrl) > maxBytes) return null;
      const thumb = typeof r.thumb === 'string' && r.thumb.length <= THUMB_MAX && DATA_RE.test(r.thumb) ? r.thumb : undefined;
      return {
        id: r.id,
        dataUrl: r.dataUrl,
        thumb,
        hash: typeof r.hash === 'string' && HASH_RE.test(r.hash) ? r.hash : fnv(r.dataUrl),
        addedAt: typeof r.addedAt === 'string' ? r.addedAt.slice(0, 40) : '',
      };
    };
    const sanitizePrefs = (raw: unknown): PanelPrefs => {
      const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      return {
        cjkFont: r.cjkFont === true,
        glass: r.glass === true,
        slideshow: typeof r.slideshow === 'string' && Object.prototype.hasOwnProperty.call(SLIDES, r.slideshow) ? (r.slideshow as SlideshowMode) : 'off',
      };
    };
    const current = (): PanelSettings => ui ?? fromCli();

    const payloadFor = (s: PanelSettings): BackgroundPayload | null => {
      if (!s.enabled) return null;
      const common = {
        opacity: s.opacity,
        blur: s.blur,
        size: s.size,
        position: s.position,
        mode: s.mode,
        tint: s.tint || undefined,
      };
      if (s.source === 'image' && s.dataUrl) return { kind: 'image', image: `url("${s.dataUrl}")`, ...common };
      if (s.source === 'gallery' && galleryImage) return { kind: 'image', image: `url("${galleryImage}")`, ...common };
      if (s.source === 'preset' && hasPreset(s.preset)) {
        return { kind: 'preset', image: presets[s.preset]!.image, preset: s.preset, ...common, size: 'cover', position: 'center' };
      }
      if (s.source === 'cli' && cli) {
        // 介面沒動過時完全沿用 CLI（含自訂 tint）；動過參數則以介面為準
        if (!ui) return cli;
        return { ...cli, ...common, ...(cli.kind === 'preset' ? { size: 'cover' as const, position: 'center' } : {}) };
      }
      return null;
    };

    const stopBg = (): void => {
      try {
        g.__ANTIGRAVITY_I18N_BG__?.stop();
      } catch (e) {
        warn('stop background failed', e);
      }
      g.__ANTIGRAVITY_I18N_BG__ = undefined;
    };
    const render = (): void => {
      const p = payloadFor(current());
      if (p) applyBackground(p);
      else stopBg();
    };

    // ── IndexedDB ────────────────────────────────────────
    const openDb = (): Promise<IDBDatabase | null> =>
      new Promise((resolve) => {
        let done = false;
        const finish = (v: IDBDatabase | null): void => {
          if (!done) {
            done = true;
            resolve(v);
          }
        };
        try {
          const idb = g.indexedDB;
          if (!idb) return finish(null);
          const req = idb.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            try {
              // v1 → v2：保留既有的 settings，只新增 gallery
              if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
              if (!req.result.objectStoreNames.contains(GALLERY)) req.result.createObjectStore(GALLERY, { keyPath: 'id' });
            } catch (e) {
              warn('upgrade failed', e);
            }
          };
          req.onsuccess = () => finish(req.result);
          req.onerror = () => finish(null);
          req.onblocked = () => finish(null);
          setTimeout(() => finish(null), 1500);
        } catch (e) {
          warn('indexedDB unavailable', e);
          finish(null);
        }
      });
    const idbRequest = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store: string = STORE): Promise<T | undefined> =>
      new Promise((resolve, reject) => {
        try {
          if (!db) return resolve(undefined);
          const req = fn(db.transaction(store, mode).objectStore(store));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } catch (e) {
          reject(e);
        }
      });

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const persist = (): void => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        if (!db || !ui) return;
        idbRequest('readwrite', (s) => s.put({ ...ui, updatedAt: new Date().toISOString() }, KEY)).catch((e) => {
          persistent = false;
          say('無法寫入 IndexedDB，變更只在目前視窗生效', true);
          warn('save failed', e);
        });
      }, 150);
    };

    // ── 介面 ──────────────────────────────────────────────
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] => {
      const n = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text !== undefined) n.textContent = text;
      return n;
    };

    const style = el('style', { id: 'antigravity-i18n-panel-style' });
    style.textContent = [
      '#antigravity-i18n-panel[hidden],#antigravity-i18n-bg-launcher[hidden]{display:none !important;}',
      '#antigravity-i18n-panel{position:fixed;top:56px;right:16px;z-index:2147483000;width:300px;max-height:calc(100vh - 80px);overflow:auto;',
      'box-sizing:border-box;padding:12px 14px;border-radius:10px;background:rgba(28,28,32,0.97);color:#e8e8ea;',
      'font:13px/1.45 system-ui,-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;',
      'box-shadow:0 8px 28px rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.08);}',
      '#antigravity-i18n-panel *{box-sizing:border-box;}',
      '#antigravity-i18n-panel .agi18n-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-weight:600;font-size:14px;}',
      '#antigravity-i18n-panel .agi18n-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;}',
      '#antigravity-i18n-panel .agi18n-sub{margin:10px 0 4px;color:#a8a8b0;font-size:12px;}',
      '#antigravity-i18n-panel input[type=range]{flex:1;min-width:0;}',
      '#antigravity-i18n-panel select{background:#1d1d22;color:#e8e8ea;border:1px solid #44444c;border-radius:5px;padding:2px 4px;}',
      '#antigravity-i18n-panel button,#antigravity-i18n-panel .agi18n-btn{cursor:pointer;background:#2c2c34;color:#e8e8ea;border:1px solid #46464f;border-radius:6px;padding:4px 8px;font:inherit;}',
      '#antigravity-i18n-panel button:hover,#antigravity-i18n-panel .agi18n-btn:hover{background:#3a3a44;}',
      '#antigravity-i18n-panel .agi18n-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}',
      '#antigravity-i18n-panel .agi18n-presets button{height:44px;padding:0;border-radius:6px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.8);font-size:12px;background-size:cover;}',
      '#antigravity-i18n-panel .agi18n-presets button[aria-pressed=true]{outline:2px solid #6ea8ff;outline-offset:1px;}',
      '#antigravity-i18n-panel .agi18n-msg{min-height:18px;margin-top:8px;font-size:12px;color:#9fd29f;}',
      '#antigravity-i18n-panel .agi18n-msg[data-warn]{color:#f0c674;}',
      '#antigravity-i18n-panel .agi18n-foot{margin-top:6px;color:#8a8a92;font-size:11px;}',
      '#antigravity-i18n-panel .agi18n-scan-list{margin:6px 0 0;padding:6px 8px;max-height:120px;overflow:auto;list-style:none;border-radius:6px;background:#1d1d22;font:11px/1.5 ui-monospace,Consolas,monospace;}',
      '#antigravity-i18n-panel .agi18n-scan-list:empty{display:none;}',
      '#antigravity-i18n-panel .agi18n-scan-list li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '#antigravity-i18n-panel a.agi18n-btn{text-decoration:none;display:inline-block;}',
      '#antigravity-i18n-panel .agi18n-gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px;}',
      '#antigravity-i18n-panel .agi18n-gallery:empty{display:none;}',
      '#antigravity-i18n-panel .agi18n-thumb{position:relative;}',
      '#antigravity-i18n-panel .agi18n-thumb>button[data-agi18n-gallery]{width:100%;height:42px;padding:0;border-radius:6px;background-size:cover;background-position:center;}',
      '#antigravity-i18n-panel .agi18n-thumb>button[aria-pressed=true]{outline:2px solid #6ea8ff;outline-offset:1px;}',
      '#antigravity-i18n-panel .agi18n-thumb>button[data-agi18n-gallery-del]{position:absolute;top:-6px;right:-6px;width:18px;height:18px;padding:0;border-radius:50%;font-size:10px;line-height:16px;}',
      '#antigravity-i18n-panel .agi18n-quota{color:#a8a8b0;font-size:11px;}',
      '#antigravity-i18n-panel button:disabled{opacity:0.5;cursor:default;}',
      '#antigravity-i18n-bg-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483000;cursor:pointer;padding:5px 10px;border-radius:999px;',
      'background:rgba(40,40,46,0.9);color:#e8e8ea;border:1px solid rgba(255,255,255,0.15);font:12px system-ui,sans-serif;opacity:0.8;}',
      '#antigravity-i18n-bg-launcher:hover{opacity:1;}',
    ].join('');

    const panel = el('div', { id: 'antigravity-i18n-panel', role: 'dialog', 'aria-label': '背景設定', [SKIP]: '', hidden: '' });
    const head = el('div', { class: 'agi18n-head' });
    head.append(el('span', {}, '背景設定'), el('button', { type: 'button', 'data-agi18n': 'close', 'aria-label': '關閉' }, '✕'));

    const enabledBox = el('input', { type: 'checkbox', 'data-agi18n': 'enabled' });
    const enabledRow = el('label', { class: 'agi18n-row' });
    enabledRow.append(el('span', {}, '啟用背景'), enabledBox);

    const fileInput = el('input', { type: 'file', accept: MIMES.join(','), 'data-agi18n': 'file', style: 'display:none' });
    const fileBtn = el('label', { class: 'agi18n-btn', 'data-agi18n': 'pick' }, '選擇本機圖片…');
    fileBtn.append(fileInput);

    const presetGrid = el('div', { class: 'agi18n-presets' });
    for (const name of Object.keys(presets)) {
      if (!hasPreset(name)) continue;
      const b = el('button', { type: 'button', 'data-agi18n-preset': name, title: name }, presets[name]!.label);
      // 預設本身就是只含漸層與顏色的 CSS（掛鉤已驗證），可直接當作縮圖
      b.style.backgroundImage = presets[name]!.image;
      presetGrid.append(b);
    }

    const range = (key: string, min: string, max: string, step: string): [HTMLInputElement, HTMLSpanElement, HTMLLabelElement] => {
      const input = el('input', { type: 'range', min, max, step, 'data-agi18n': key });
      const out = el('span', { 'data-agi18n-value': key });
      const row = el('label', { class: 'agi18n-row' });
      return [input, out, row];
    };
    const [opacityIn, opacityOut, opacityRow] = range('opacity', '0.01', '1', '0.01');
    opacityRow.append(el('span', {}, '不透明度'), opacityIn, opacityOut);
    const [blurIn, blurOut, blurRow] = range('blur', '0', '32', '1');
    blurRow.append(el('span', {}, '模糊'), blurIn, blurOut);

    const select = (key: string, label: string, options: [string, string][]): [HTMLSelectElement, HTMLLabelElement] => {
      const s = el('select', { 'data-agi18n': key });
      for (const [v, t] of options) s.append(el('option', { value: v }, t));
      const row = el('label', { class: 'agi18n-row' });
      row.append(el('span', {}, label), s);
      return [s, row];
    };
    const [positionSel, positionRow] = select('position', '對齊', [
      ['center', '置中'],
      ['top', '靠上'],
      ['bottom', '靠下'],
      ['left', '靠左'],
      ['right', '靠右'],
    ]);
    const [sizeSel, sizeRow] = select('size', '縮放', [
      ['cover', '填滿（cover）'],
      ['contain', '完整顯示（contain）'],
    ]);
    const [tintSel, tintRow] = select('tint', '遮罩', TINTS);
    const [modeSel, modeRow] = select('mode', '圖層', [
      ['overlay', '覆蓋在介面上（overlay）'],
      ['underlay', '放在介面底層（underlay）'],
    ]);

    const resetBtn = el('button', { type: 'button', 'data-agi18n': 'reset' }, '重設（改回 CLI 設定）');
    // 介面語言：五語免重整切換（翻譯 runtime 沒有載入時整列隱藏）
    const langSel = el('select', { 'data-agi18n': 'i18n', 'aria-label': '介面語言' });
    const i18nRow = el('label', { class: 'agi18n-row' });
    const i18nTitle = el('div', { class: 'agi18n-sub' }, '語言');
    i18nRow.append(el('span', {}, '介面語言'), langSel);

    // 桌布收藏夾與自動輪播
    const galleryTitle = el('div', { class: 'agi18n-sub' }, '桌布收藏夾');
    const addBtn = el('button', { type: 'button', 'data-agi18n': 'gallery-add' }, '加入目前圖片');
    const nextBtn = el('button', { type: 'button', 'data-agi18n': 'gallery-next' }, '下一張');
    const quota = el('span', { class: 'agi18n-quota', 'data-agi18n': 'gallery-quota' });
    const galleryRow = el('div', { class: 'agi18n-row' });
    galleryRow.append(addBtn, nextBtn, quota);
    const galleryGrid = el('div', { class: 'agi18n-gallery', 'data-agi18n': 'gallery' });
    const [slideSel, slideRow] = select('slideshow', '自動輪播', [
      ['off', '關閉'],
      ['on-launch', '每次開啟視窗換下一張'],
      ['15m', '每 15 分鐘'],
      ['30m', '每 30 分鐘'],
      ['60m', '每 60 分鐘'],
    ]);

    // 外觀微調
    const lookTitle = el('div', { class: 'agi18n-sub' }, '外觀微調');
    const fontBox = el('input', { type: 'checkbox', 'data-agi18n': 'cjk-font' });
    const fontRow = el('label', { class: 'agi18n-row' });
    fontRow.append(el('span', {}, 'CJK 介面字型最佳化'), fontBox);
    const glassBox = el('input', { type: 'checkbox', 'data-agi18n': 'glass' });
    const glassRow = el('label', { class: 'agi18n-row' });
    glassRow.append(el('span', {}, '毛玻璃卡片模式'), glassBox);

    const fontStyle = el('style', { id: 'antigravity-i18n-font', [SKIP]: '' });
    const MONO = ['code', 'pre', 'kbd', 'samp', '.monaco-editor', '.xterm', '[class*="mono"]'];
    // 只設定在 body 與表單控制項（字型會繼承）；程式碼、編輯器、終端機與 mono 類別一律排除
    fontStyle.textContent = [
      `html body{font-family:${FONT_STACK};}`,
      `html body :is(button,input,select,textarea,optgroup):not(:where(${MONO.join(',')},${MONO.map((m) => `${m} *`).join(',')})){font-family:${FONT_STACK};}`,
    ].join('');
    const glassStyle = el('style', { id: 'antigravity-i18n-glass', [SKIP]: '' });
    const GLASS_TARGETS = [
      '[role="dialog"]',
      '[role="menu"]',
      '[role="listbox"]',
      '[role="tooltip"]',
      '.monaco-dialog-box',
      '.quick-input-widget',
      '.notification-toast',
      '.monaco-menu-container',
      '[class~="card"]',
      '[class*="-card"]',
      '[class*="card-"]',
      '[class*="Card"]',
      '[class*="modal"]',
      '[class*="Modal"]',
      '[class*="popover"]',
      '[class*="Popover"]',
      '[class*="dropdown"]',
      '[class*="Dropdown"]',
    ];
    glassStyle.textContent =
      `:is(${GLASS_TARGETS.join(',')}):not([${SKIP}]):not(:where(.monaco-editor,.monaco-editor *,.xterm,.xterm *,code,pre)){` +
      'background-color:rgba(30,30,36,0.55);background-color:color-mix(in srgb,Canvas 62%,transparent) !important;' +
      '-webkit-backdrop-filter:blur(10px) saturate(1.15);backdrop-filter:blur(10px) saturate(1.15);' +
      'border-color:color-mix(in srgb,CanvasText 14%,transparent);}';
    const scanTitle = el('div', { class: 'agi18n-sub' }, '掃描未翻譯英文');
    const scanBtn = el('button', { type: 'button', 'data-agi18n': 'scan' }, '掃描本頁');
    const scanCount = el('span', { 'data-agi18n': 'scan-count' });
    const scanRow = el('div', { class: 'agi18n-row' });
    scanRow.append(scanBtn, scanCount);
    const scanList = el('ul', { class: 'agi18n-scan-list', 'data-agi18n': 'scan-list' });
    const copyBtn = el('button', { type: 'button', 'data-agi18n': 'scan-copy', disabled: '' }, '複製 JSON');
    const reportLink = el(
      'a',
      { class: 'agi18n-btn', 'data-agi18n': 'scan-report', href: 'https://github.com/Carinoasd/antigravity-i18n/issues/new?template=missing-translation.yml', target: '_blank', rel: 'noopener noreferrer' },
      '前往 GitHub 回報',
    );
    const scanActions = el('div', { class: 'agi18n-row' });
    scanActions.append(copyBtn, reportLink);
    const msg = el('div', { class: 'agi18n-msg', 'data-agi18n': 'msg', 'aria-live': 'polite' });
    const foot = el('div', { class: 'agi18n-foot' }, 'Ctrl+Alt+B（macOS：⌘+⌥+B）開關．Esc 關閉');

    panel.append(
      head,
      enabledRow,
      el('div', { class: 'agi18n-sub' }, '背景來源'),
      fileBtn,
      el('div', { class: 'agi18n-sub' }, '內建漸層'),
      presetGrid,
      el('div', { class: 'agi18n-sub' }, '外觀'),
      opacityRow,
      blurRow,
      positionRow,
      sizeRow,
      tintRow,
      modeRow,
      el('div', { class: 'agi18n-row' }),
      resetBtn,
      galleryTitle,
      galleryRow,
      galleryGrid,
      slideRow,
      lookTitle,
      fontRow,
      glassRow,
      i18nTitle,
      i18nRow,
      scanTitle,
      scanRow,
      scanList,
      scanActions,
      msg,
      foot,
    );

    const launcher = el('button', { type: 'button', id: 'antigravity-i18n-bg-launcher', [SKIP]: '', hidden: '', title: '背景設定（Ctrl+Alt+B）' }, '🖼 背景設定');

    const say = (text: string, isWarn = false): void => {
      msg.textContent = text;
      if (isWarn) msg.setAttribute('data-warn', '');
      else msg.removeAttribute('data-warn');
    };

    const sync = (): void => {
      const s = current();
      enabledBox.checked = s.enabled;
      opacityIn.value = String(s.opacity);
      opacityOut.textContent = s.opacity.toFixed(2);
      blurIn.value = String(s.blur);
      blurOut.textContent = `${s.blur}px`;
      positionSel.value = s.position;
      sizeSel.value = s.size;
      tintSel.value = s.tint;
      modeSel.value = s.mode;
      const active = s.source === 'preset' ? s.preset : s.source === 'cli' && cli?.kind === 'preset' ? cli.preset : undefined;
      presetGrid.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-agi18n-preset') === active)));
      const ov = g.__ANTIGRAVITY_I18N__;
      const langs = ov && Array.isArray(ov.availableLangs) && ov.availableLangs.length > 0 ? ov.availableLangs : ov ? [ov.lang ?? 'zh-TW', 'en'] : [];
      const wanted = LANG_LABELS.filter((l) => langs.includes(l[0]));
      if (langSel.options.length !== wanted.length || wanted.some((l, i) => langSel.options[i]?.value !== l[0])) {
        langSel.textContent = '';
        for (const [v, t] of wanted) langSel.append(el('option', { value: v }, t));
      }
      langSel.disabled = !ov;
      if (ov) langSel.value = ov.enabled === false ? 'en' : (ov.lang ?? 'zh-TW');
      fontBox.checked = prefs.cjkFont;
      glassBox.checked = prefs.glass;
      slideSel.value = prefs.slideshow;
      addBtn.disabled = !persistent;
      nextBtn.disabled = !persistent || galleryKeys.length === 0;
      // 僅背景模式（--lang none）沒有翻譯層：隱藏中／英文切換
      i18nRow.hidden = !ov;
      i18nTitle.hidden = !ov;
    };

    /** 套用一次介面變更：立即重繪、同步控制項、排程寫入 IndexedDB */
    const update = (patch: Partial<PanelSettings>): void => {
      ui = { ...current(), ...patch };
      render();
      sync();
      persist();
    };

    const mount = (): void => {
      if (!style.isConnected) (doc.head || doc.documentElement).appendChild(style);
      if (prefs.cjkFont && !fontStyle.isConnected) (doc.head || doc.documentElement).appendChild(fontStyle);
      if (prefs.glass && !glassStyle.isConnected) (doc.head || doc.documentElement).appendChild(glassStyle);
      const host = doc.body || doc.documentElement;
      if (!panel.isConnected) host.appendChild(panel);
      if (!launcher.isConnected) host.appendChild(launcher);
    };

    const open = (): void => {
      mount();
      sync();
      panel.hidden = false;
      isOpen = true;
      // 縮圖只在面板開啟時讀取
      refreshGallery().catch((e) => warn('gallery load failed', e));
    };
    const close = (): void => {
      panel.hidden = true;
      isOpen = false;
      // 關閉即釋放縮圖（data URL 字串）
      galleryGrid.textContent = '';
    };

    // ── 外觀微調 ──────────────────────────────────────────
    const applyAppearance = (): void => {
      const head = doc.head || doc.documentElement;
      if (prefs.cjkFont) {
        if (!fontStyle.isConnected) head.appendChild(fontStyle);
      } else fontStyle.remove();
      if (prefs.glass) {
        if (!glassStyle.isConnected) head.appendChild(glassStyle);
      } else glassStyle.remove();
    };
    const savePrefs = (): void => {
      if (!db) return;
      idbRequest('readwrite', (s) => s.put({ ...prefs }, PREFS_KEY)).catch((e) => {
        say('無法寫入 IndexedDB，變更只在目前視窗生效', true);
        warn('save prefs failed', e);
      });
    };

    // ── 桌布收藏夾 ────────────────────────────────────────
    const loadKeys = async (): Promise<void> => {
      const keys = await idbRequest('readonly', (s) => s.getAllKeys(), GALLERY);
      galleryKeys = (keys ?? [])
        .filter((k): k is string => typeof k === 'string' && ID_RE.test(k))
        .sort()
        .slice(0, MAX_ITEMS);
    };
    const getItem = async (id: string): Promise<GalleryItem | null> => (ID_RE.test(id) ? validItem(await idbRequest('readonly', (s) => s.get(id), GALLERY)) : null);
    /** 以游標逐筆讀取（同一時間只解析一筆），只保留縮圖與大小；超過張數或總容量上限的資料一律忽略 */
    const scanGallery = (): Promise<GalleryMeta[]> =>
      new Promise((resolve, reject) => {
        try {
          if (!db) return resolve([]);
          const req = db.transaction(GALLERY, 'readonly').objectStore(GALLERY).openCursor();
          const out: GalleryMeta[] = [];
          let total = 0;
          req.onsuccess = () => {
            const c = req.result;
            if (!c) return resolve(out);
            const it = validItem(c.value);
            if (it) {
              const size = bytesOf(it.dataUrl);
              if (out.length < MAX_ITEMS && total + size <= MAX_TOTAL) {
                total += size;
                // 沒有縮圖時只有小圖才直接當縮圖；大圖改顯示編號，避免把整張圖片字串留在 DOM 與記憶體
                const thumb = it.thumb ?? (it.dataUrl.length <= THUMB_MAX ? it.dataUrl : '');
                out.push({ id: it.id, size, thumb, hash: it.hash, addedAt: it.addedAt });
              }
            }
            c.continue();
          };
          req.onerror = () => reject(req.error);
        } catch (e) {
          reject(e);
        }
      });
    const renderGallery = (list: GalleryMeta[]): void => {
      galleryGrid.textContent = '';
      const total = list.reduce((n, m) => n + m.size, 0);
      quota.textContent = `${list.length}/${MAX_ITEMS} 張．${mb(total)}/${mb(MAX_TOTAL)} MB`;
      const active = ui?.source === 'gallery' ? ui.galleryId : undefined;
      for (const m of list) {
        const cell = el('div', { class: 'agi18n-thumb' });
        const pick = el('button', { type: 'button', 'data-agi18n-gallery': m.id, title: `${mb(m.size)} MB`, 'aria-pressed': String(m.id === active) });
        // 縮圖已通過 DATA_RE 驗證（只含 base64 字元），可安全放進 url("…")
        if (m.thumb) pick.style.backgroundImage = `url("${m.thumb}")`;
        else pick.textContent = String(galleryGrid.childElementCount + 1);
        const del = el('button', { type: 'button', 'data-agi18n-gallery-del': m.id, title: '從收藏夾刪除', 'aria-label': '從收藏夾刪除' }, '✕');
        cell.append(pick, del);
        galleryGrid.append(cell);
      }
    };
    const refreshGallery = async (): Promise<GalleryMeta[]> => {
      if (!db) {
        quota.textContent = '無法使用 IndexedDB，收藏夾停用';
        return [];
      }
      const list = await scanGallery();
      await loadKeys();
      if (isOpen) renderGallery(list);
      sync();
      return list;
    };
    /** 小縮圖（JPEG，寬 120px）；環境不支援 createImageBitmap / canvas 時回傳 undefined */
    const makeThumb = async (dataUrl: string): Promise<string | undefined> => {
      try {
        if (typeof g.createImageBitmap !== 'function' || typeof g.atob !== 'function' || typeof g.Blob !== 'function') return undefined;
        const comma = dataUrl.indexOf(',');
        const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
        const bin = g.atob(dataUrl.slice(comma + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bmp = await g.createImageBitmap(new g.Blob([bytes], { type: mime }));
        const canvas = doc.createElement('canvas');
        canvas.width = 120;
        canvas.height = Math.max(1, Math.min(90, Math.round((bmp.height * 120) / Math.max(1, bmp.width))));
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close?.();
        const out = canvas.toDataURL('image/jpeg', 0.7);
        return out.length <= THUMB_MAX && DATA_RE.test(out) ? out : undefined;
      } catch (e) {
        warn('thumbnail failed', e);
        return undefined;
      }
    };
    /** 目前背景的圖片（介面選的圖片，或 CLI 的圖片） */
    const currentImage = (): string | null => {
      if (ui?.source === 'image' && ui.dataUrl) return ui.dataUrl;
      if (ui?.source === 'gallery') return galleryImage;
      if ((!ui || ui.source === 'cli') && cli?.kind === 'image') {
        const m = /^url\("(data:[^"]+)"\)$/.exec(cli.image);
        if (m?.[1] && DATA_RE.test(m[1])) return m[1];
      }
      return null;
    };
    let galleryBusy = false;
    const exclusive = async <T>(fallback: T, fn: () => Promise<T>): Promise<T> => {
      if (galleryBusy) return fallback;
      galleryBusy = true;
      try {
        return await fn();
      } catch (e) {
        warn('gallery failed', e);
        say('收藏夾操作失敗', true);
        return fallback;
      } finally {
        galleryBusy = false;
      }
    };
    const showGalleryImage = (item: GalleryItem): void => {
      galleryImage = item.dataUrl;
      update({ enabled: true, source: 'gallery', galleryId: item.id, dataUrl: undefined, preset: undefined });
      galleryGrid.querySelectorAll('[data-agi18n-gallery]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-agi18n-gallery') === item.id)));
    };
    const addToGallery = (): Promise<string | null> =>
      exclusive<string | null>(null, async () => {
        if (!db) {
          say('此環境無法使用 IndexedDB，收藏夾無法使用', true);
          return null;
        }
        const src = currentImage();
        if (!src) {
          say('目前的背景不是圖片：請先「選擇本機圖片…」再加入收藏', true);
          return null;
        }
        const size = bytesOf(src);
        if (size > maxBytes) {
          say(`圖片 ${mb(size)} MB 超過單張上限 ${mb(maxBytes)} MB`, true);
          return null;
        }
        const list = await scanGallery();
        const hash = fnv(src);
        const dup = list.find((m) => m.hash === hash && m.size === size);
        if (dup) {
          say('這張圖片已在收藏夾中');
          return dup.id;
        }
        if (list.length >= MAX_ITEMS) {
          say(`收藏夾最多 ${MAX_ITEMS} 張，請先刪除不需要的圖片`, true);
          return null;
        }
        const used = list.reduce((n, m) => n + m.size, 0);
        if (used + size > MAX_TOTAL) {
          say(`收藏夾總容量上限 ${mb(MAX_TOTAL)} MB（已用 ${mb(used)} MB，這張 ${mb(size)} MB），請先刪除不需要的圖片`, true);
          return null;
        }
        const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
        const item: GalleryItem = { id, dataUrl: src, thumb: await makeThumb(src), hash, addedAt: new Date().toISOString() };
        await idbRequest('readwrite', (s) => s.put(item), GALLERY);
        // 改為引用收藏：設定裡不再重複存放同一張圖片
        showGalleryImage(item);
        await refreshGallery();
        say(`已加入收藏夾（${galleryKeys.length}/${MAX_ITEMS}）`);
        return id;
      });
    const selectGallery = (id: string): Promise<boolean> =>
      exclusive(false, async () => {
        const item = await getItem(id);
        if (!item) {
          say('這張收藏已損毀或不存在，已略過', true);
          return false;
        }
        showGalleryImage(item);
        return true;
      });
    const removeGallery = (id: string): Promise<boolean> =>
      exclusive(false, async () => {
        if (!db || !ID_RE.test(id)) return false;
        await idbRequest('readwrite', (s) => s.delete(id), GALLERY);
        if (ui?.source === 'gallery' && ui.galleryId === id) {
          galleryImage = null;
          update({ source: 'cli', galleryId: undefined });
          say(cli ? '已刪除目前的桌布，改回 CLI 設定' : '已刪除目前的桌布');
        } else {
          say('已從收藏夾刪除');
        }
        await refreshGallery();
        return true;
      });
    /** 輪播：依加入順序切換到下一張；損毀的收藏直接略過 */
    const nextGallery = (): Promise<boolean> =>
      exclusive(false, async () => {
        if (!db) return false;
        await loadKeys();
        const keys = galleryKeys;
        if (keys.length === 0) return false;
        const cur = ui?.source === 'gallery' ? (ui.galleryId ?? '') : '';
        const at = keys.indexOf(cur);
        for (let t = 1; t <= keys.length; t++) {
          const item = await getItem(keys[(at + t + keys.length) % keys.length]!);
          if (item) {
            if (item.id !== cur || keys.length === 1) showGalleryImage(item);
            return true;
          }
        }
        return false;
      });

    /** 定時輪播：同一時間只會有一個 interval，變更模式時一律先清除舊的 */
    let slideTimer: ReturnType<typeof setInterval> | null = null;
    const schedule = (): void => {
      const clear = g.clearInterval ?? clearInterval;
      const every = g.setInterval ?? setInterval;
      if (slideTimer !== null) {
        clear(slideTimer);
        slideTimer = null;
      }
      const ms = SLIDES[prefs.slideshow] ?? 0;
      if (ms > 0 && db) {
        slideTimer = every(() => {
          nextGallery().catch((e) => warn('slideshow failed', e));
        }, ms);
      }
    };
    const setPrefs = (patch: Partial<PanelPrefs>): void => {
      prefs = sanitizePrefs({ ...prefs, ...patch });
      applyAppearance();
      schedule();
      sync();
      savePrefs();
    };
    const toggle = (): void => (isOpen ? close() : open());

    // ── 掃描未翻譯英文 ────────────────────────────────────
    // 純數字／符號（沒有連續兩個英文字母）、整段是網址、Email、檔案路徑或快捷鍵的字串都不列入
    /** 與 overlay.ts 的 PROTECTED 完全相同（測試逐字比對）：程式碼、編輯器、終端機、可編輯區域與 Markdown 正文 */
    const PROTECTED = [
      'code',
      'pre',
      'kbd',
      'samp',
      'script',
      'style',
      'noscript',
      'template',
      'svg',
      'math',
      '.monaco-editor',
      '.xterm',
      '[contenteditable]:not([contenteditable="false"])',
      '[role="textbox"]',
      '.markdown',
      '.markdown-body',
      '.prose',
      '[class*="markdown"]',
      '[class*="Markdown"]',
      '[data-antigravity-i18n-skip]',
    ].join(',');
    const FORM = 'input,textarea,select';
    const SCAN_ATTRS = ['title', 'placeholder', 'aria-label'];
    const MAX_LEN = 120;
    const MAX_RESULTS = 500;
    const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/i;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\|~?\/|\.{1,2}[\\/])\S*$|^[\w.-]+(?:[\\/][\w.-]+)*[\\/][\w-]+\.[A-Za-z0-9]{1,6}$|^[\w-]+(?:\.[\w-]+)*\.[A-Za-z0-9]{1,6}$/;
    const SHORTCUT_RE = /^(?:(?:Ctrl|Control|Cmd|Command|Alt|Option|Shift|Meta|Win|Super|Fn|⌘|⌥|⇧|⌃)\s*[+-]\s*)+\S{1,12}$/i;
    /** 已含中日韓文字的字串多半是譯文（或已在地化），不列入 */
    const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
    let scanned: string[] = [];

    const isHidden = (e: Element): boolean => {
      if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return true;
      try {
        const cs = g.getComputedStyle?.(e);
        return !!cs && (cs.display === 'none' || cs.visibility === 'hidden');
      } catch {
        return false;
      }
    };

    const scan = (): string[] => {
      const ov = g.__ANTIGRAVITY_I18N__;
      const tr = ov && typeof ov.translate === 'function' ? ov.translate : null;
      const found = new Set<string>();
      const consider = (raw: string | null | undefined): void => {
        if (!raw || found.size >= MAX_RESULTS) return;
        const t = raw.replace(/\s+/g, ' ').trim();
        if (t === '' || t.length > MAX_LEN || found.has(t)) return;
        if (!/[A-Za-z]{2,}/.test(t) || CJK_RE.test(t)) return;
        if (URL_RE.test(t) || EMAIL_RE.test(t) || PATH_RE.test(t) || SHORTCUT_RE.test(t)) return;
        if (tr) {
          try {
            if (tr(t) !== null) return;
          } catch {
            return;
          }
        }
        found.add(t);
      };
      const considerAttrs = (e: Element): void => {
        for (const a of SCAN_ATTRS) consider(e.getAttribute(a));
      };
      const root = doc.body || doc.documentElement;
      if (root && !root.matches(PROTECTED)) {
        const tw = doc.createTreeWalker(root, 1 | 4, {
          acceptNode(n: Node): number {
            if (n.nodeType !== 1) return 1;
            const e = n as Element;
            if (e.matches(PROTECTED) || isHidden(e)) return 2;
            // 表單欄位：只看提示屬性，絕不讀取使用者輸入的內容
            if (e.matches(FORM)) {
              considerAttrs(e);
              return 2;
            }
            return 1;
          },
        });
        considerAttrs(root);
        let n: Node | null;
        while ((n = tw.nextNode())) {
          if (n.nodeType === 3) consider(n.nodeValue);
          else considerAttrs(n as Element);
        }
      }
      scanned = Array.from(found).sort();
      return scanned;
    };
    const scanJson = (): string => {
      const out: Record<string, string> = {};
      for (const k of scanned) out[k] = '';
      return JSON.stringify(out, null, 2);
    };
    const renderScan = (): void => {
      scanList.textContent = '';
      for (const t of scanned.slice(0, 50)) scanList.append(el('li', { title: t }, t));
      if (scanned.length > 50) scanList.append(el('li', {}, `…以及另外 ${scanned.length - 50} 筆`));
      scanCount.textContent = `找到 ${scanned.length} 筆`;
      copyBtn.disabled = scanned.length === 0;
    };
    const copyText = (text: string): Promise<boolean> => {
      const fallback = (): boolean => {
        const prev = doc.activeElement as HTMLElement | null;
        try {
          const ta = el('textarea', { readonly: '', [SKIP]: '', style: 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;' });
          ta.value = text;
          (doc.body || doc.documentElement).appendChild(ta);
          ta.focus();
          ta.select();
          const ok = typeof doc.execCommand === 'function' && doc.execCommand('copy');
          ta.remove();
          return !!ok;
        } catch (e) {
          warn('copy fallback failed', e);
          return false;
        } finally {
          try {
            prev?.focus?.();
          } catch {
            /* ignore */
          }
        }
      };
      try {
        const cb = g.navigator?.clipboard;
        if (cb && typeof cb.writeText === 'function') {
          return cb.writeText(text).then(
            () => true,
            () => fallback(),
          );
        }
      } catch {
        /* 改用 textarea */
      }
      return Promise.resolve(fallback());
    };

    // ── 事件 ──────────────────────────────────────────────
    const on = (target: EventTarget, type: string, fn: (e: Event) => void, capture = false): void => {
      target.addEventListener(
        type,
        (e) => {
          try {
            fn(e);
          } catch (err) {
            warn(`${type} handler failed`, err);
          }
        },
        capture,
      );
    };

    on(enabledBox, 'change', () => update({ enabled: enabledBox.checked }));
    on(opacityIn, 'input', () => update({ opacity: clamp(opacityIn.value, 0.12, 0.01, 1) }));
    on(blurIn, 'input', () => update({ blur: clamp(blurIn.value, 0, 0, 32) }));
    on(positionSel, 'change', () => update({ position: POSITIONS.includes(positionSel.value) ? positionSel.value : 'center' }));
    on(sizeSel, 'change', () => update({ size: sizeSel.value === 'contain' ? 'contain' : 'cover' }));
    on(tintSel, 'change', () => update({ tint: TINTS.some((t) => t[0] === tintSel.value) ? tintSel.value : '' }));
    on(modeSel, 'change', () => update({ mode: modeSel.value === 'underlay' ? 'underlay' : 'overlay' }));
    on(presetGrid, 'click', (e) => {
      const b = (e.target as Element | null)?.closest?.('[data-agi18n-preset]');
      const name = b?.getAttribute('data-agi18n-preset');
      if (!hasPreset(name)) return;
      update({ enabled: true, source: 'preset', preset: name, dataUrl: undefined });
      say(`已套用「${presets[name]!.label}」${persistent ? '' : '（只在目前視窗生效）'}`, !persistent);
    });
    on(fileInput, 'change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > maxBytes) {
        say(`圖片大小 ${(file.size / 1024 / 1024).toFixed(1)} MB 超過上限 ${Math.round(maxBytes / 1024 / 1024)} MB，請選擇較小的圖片`, true);
        return;
      }
      if (!MIMES.includes(file.type)) {
        say('只支援 PNG、JPEG、WebP、GIF 圖片', true);
        return;
      }
      const Reader = g.FileReader;
      if (!Reader) {
        say('此環境無法讀取本機檔案', true);
        return;
      }
      const reader = new Reader();
      reader.onload = () => {
        const url = typeof reader.result === 'string' ? reader.result : '';
        if (!DATA_RE.test(url)) {
          say('無法讀取這張圖片', true);
          return;
        }
        update({ enabled: true, source: 'image', dataUrl: url, preset: undefined });
        say(persistent ? `已套用「${file.name}」並儲存` : `已套用「${file.name}」（只在目前視窗生效）`, !persistent);
      };
      reader.onerror = () => say('讀取圖片失敗', true);
      reader.readAsDataURL(file);
    });
    on(resetBtn, 'click', () => {
      ui = null;
      if (saveTimer) clearTimeout(saveTimer);
      if (db) idbRequest('readwrite', (s) => s.delete(KEY)).catch((e) => warn('reset failed', e));
      render();
      sync();
      say(cli ? '已改回 CLI 設定（background.json）' : '已清除介面設定；目前沒有 CLI 背景設定，背景已關閉');
    });
    on(langSel, 'change', () => {
      const ov = g.__ANTIGRAVITY_I18N__;
      if (!ov) return;
      const v = langSel.value;
      const label = LANG_LABELS.find((l) => l[0] === v)?.[1] ?? v;
      if (typeof ov.setLang === 'function') {
        // 翻譯 runtime 會先還原英文原文、再以新語系重譯整份文件，並記住選擇
        ov.setLang(v);
      } else {
        // 舊版 runtime：只能停用／啟用翻譯
        try {
          if (v === 'en') g.localStorage?.setItem(I18N_KEY, '1');
          else g.localStorage?.removeItem(I18N_KEY);
        } catch {
          /* 無法記住選擇 */
        }
        if (v === 'en') ov.stop();
        else ov.resume?.();
      }
      sync();
      say(v === 'en' ? '已切換為英文原文' : `已切換為${label}`);
    });
    on(addBtn, 'click', () => void addToGallery());
    on(nextBtn, 'click', () => {
      nextGallery()
        .then((ok) => {
          if (!ok) say('收藏夾沒有圖片：先加入幾張再輪播', true);
        })
        .catch((e) => warn('next failed', e));
    });
    on(galleryGrid, 'click', (e) => {
      const t = e.target as Element | null;
      const del = t?.closest?.('[data-agi18n-gallery-del]')?.getAttribute('data-agi18n-gallery-del');
      if (del) {
        void removeGallery(del);
        return;
      }
      const id = t?.closest?.('[data-agi18n-gallery]')?.getAttribute('data-agi18n-gallery');
      if (id) void selectGallery(id);
    });
    on(slideSel, 'change', () => {
      setPrefs({ slideshow: slideSel.value as SlideshowMode });
      say(prefs.slideshow === 'off' ? '已關閉自動輪播' : `已設定自動輪播：${slideSel.options[slideSel.selectedIndex]?.textContent ?? ''}`);
    });
    on(fontBox, 'change', () => setPrefs({ cjkFont: fontBox.checked }));
    on(glassBox, 'change', () => setPrefs({ glass: glassBox.checked }));
    on(panel, 'click', (e) => {
      if ((e.target as Element | null)?.closest?.('[data-agi18n="close"]')) close();
    });
    on(launcher, 'click', () => toggle());
    on(scanBtn, 'click', () => {
      scan();
      renderScan();
      if (!g.__ANTIGRAVITY_I18N__) say('目前沒有載入翻譯（僅背景模式），列出的是本頁所有英文字串', true);
      else say(scanned.length > 0 ? `找到 ${scanned.length} 筆未翻譯的英文，可複製 JSON 後到 GitHub 回報` : '這一頁沒有找到未翻譯的英文');
    });
    on(copyBtn, 'click', () => {
      if (scanned.length === 0) return;
      copyText(scanJson())
        .then((ok) => say(ok ? `已複製 ${scanned.length} 筆到剪貼簿` : '無法存取剪貼簿，請改用開發者工具複製', !ok))
        .catch((e) => warn('copy failed', e));
    });

    on(
      g as unknown as EventTarget,
      'keydown',
      (ev) => {
        const e = ev as KeyboardEvent;
        const isB = e.code === 'KeyB' || (typeof e.key === 'string' && e.key.toLowerCase() === 'b');
        if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && isB) {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        } else if (isOpen && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      },
      true,
    );
    on(
      doc,
      'mousedown',
      (e) => {
        if (!isOpen) return;
        const t = e.target as Node | null;
        if (t && (panel.contains(t) || launcher.contains(t))) return;
        close();
      },
      true,
    );

    // 「設定 → 外觀」頁面出現時顯示小按鈕，離開即隱藏
    const onAppearancePage = (): boolean => {
      try {
        if (/appearance/i.test(String(g.location?.href ?? ''))) return true;
      } catch {
        /* ignore */
      }
      const nodes = doc.querySelectorAll('h1,h2,h3,h4,[role="heading"],[aria-selected="true"],[aria-current]:not([aria-current="false"])');
      for (const n of Array.from(nodes)) {
        if (n.closest(`[${SKIP}]`)) continue;
        if (APPEARANCE.includes((n.textContent ?? '').trim())) return true;
      }
      return false;
    };
    let checkTimer: ReturnType<typeof setTimeout> | null = null;
    const checkLauncher = (): void => {
      checkTimer = null;
      mount();
      launcher.hidden = !onAppearancePage();
    };
    if (typeof g.MutationObserver === 'function') {
      new g.MutationObserver(() => {
        // 框架重繪 <body> 時補回面板；外觀頁偵測做節流
        if (!panel.isConnected || !launcher.isConnected || !style.isConnected || (prefs.cjkFont && !fontStyle.isConnected) || (prefs.glass && !glassStyle.isConnected)) mount();
        if (!checkTimer) checkTimer = setTimeout(checkLauncher, 250);
      }).observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    }

    // ── 啟動：讀取 IndexedDB → 決定套用介面設定或 CLI 設定 ──
    mount();
    checkLauncher();
    const ready = openDb()
      .then(async (d) => {
        db = d;
        persistent = !!d;
        if (d) {
          try {
            ui = sanitize(await idbRequest('readonly', (s) => s.get(KEY)));
          } catch (e) {
            warn('load failed', e);
          }
          try {
            prefs = sanitizePrefs(await idbRequest('readonly', (s) => s.get(PREFS_KEY)));
            await loadKeys();
            if (ui?.source === 'gallery') {
              const item = await getItem(ui.galleryId ?? '');
              // 收藏被刪除或損毀：改回 CLI 設定
              if (item) galleryImage = item.dataUrl;
              else ui = { ...ui, source: 'cli', galleryId: undefined };
            }
          } catch (e) {
            warn('load gallery failed', e);
          }
        }
      })
      .catch((e) => warn('init failed', e))
      .then(async () => {
        try {
          applyAppearance();
          // 每次開啟視窗換下一張（nextGallery 會一併寫入設定）
          if (prefs.slideshow === 'on-launch' && galleryKeys.length > 0) await nextGallery();
          render();
          schedule();
          sync();
          if (!persistent) say('此環境無法使用 IndexedDB：介面中的變更只在目前視窗生效，重新開啟後會改回 CLI 設定', true);
        } catch (e) {
          warn('render failed', e);
        }
      });

    const handle: PanelHandle = {
      get isOpen() {
        return isOpen;
      },
      get persistent() {
        return persistent;
      },
      ready,
      open,
      close,
      toggle,
      settings: () => (ui ? { ...ui } : null),
      scan: () => {
        try {
          scan();
          renderScan();
        } catch (e) {
          warn('scan failed', e);
        }
        return [...scanned];
      },
      scanJson,
      prefs: () => ({ ...prefs }),
      setPrefs: (patch) => {
        try {
          setPrefs(patch);
        } catch (e) {
          warn('setPrefs failed', e);
        }
      },
      gallery: () => refreshGallery().catch((e) => (warn('gallery failed', e), [])),
      addToGallery,
      selectGallery,
      removeGallery,
      next: nextGallery,
      setLang: (lang) => {
        if (!LANG_LABELS.some((l) => l[0] === lang)) return;
        langSel.value = lang;
        langSel.dispatchEvent(new (doc.defaultView?.Event ?? Event)('change'));
      },
      updateCli: (p) => {
        cli = p ?? null;
        if (!ui || ui.source === 'cli') render();
        sync();
      },
    };
    g[MARK] = handle;
  } catch (e) {
    warn('install failed', e);
  }
}
