/**
 * 自訂背景圖：會被 `toString()` 序列化、內嵌進 app.asar 主行程掛鉤的兩個函式。
 *
 * - {@link readBackgroundPayload}：在 **Electron 主行程** 執行，每次視窗 `dom-ready`
 *   時讀取 `background.json` 與圖片，轉成 data URL。換圖不需要重新打包 app.asar。
 * - {@link applyBackground}：在 **renderer** 執行，注入 `<style>` 與背景圖層。
 *
 * ⚠️ 兩者都必須完全自足：不可引用模組層級變數、import 或其他函式（常數請寫在函式內）。
 *    任何錯誤只能 `console.warn`，絕不可拋出，以免影響 App 啟動與翻譯 runtime。
 */

export type BackgroundSize = 'cover' | 'contain' | 'auto';
export type BackgroundMode = 'overlay' | 'underlay';

/** 主行程傳給 renderer 的背景圖資料 */
export interface BackgroundPayload {
  dataUrl: string;
  opacity: number;
  blur: number;
  size: BackgroundSize;
  position: string;
  mode: BackgroundMode;
}

interface FsLike {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc?: BufferEncoding): string | Buffer;
  statSync(p: string): { size: number; mtimeMs: number; isFile(): boolean };
}
interface PathLike {
  join(...parts: string[]): string;
  extname(p: string): string;
}
interface OsLike {
  homedir(): string;
}

/** 讀取快取：圖片與設定檔都沒變時，不重複讀檔與 base64 編碼 */
export interface BackgroundCache {
  key?: string;
  payload?: BackgroundPayload | null;
}

export function readBackgroundPayload(
  fs: FsLike,
  path: PathLike,
  os: OsLike,
  env: Record<string, string | undefined>,
  platform: string,
  cache?: BackgroundCache,
): BackgroundPayload | null {
  const MAX_BYTES = 10 * 1024 * 1024;
  const MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const warn = (msg: string): null => {
    console.warn(`[antigravity-i18n] background: ${msg}`);
    return null;
  };
  try {
    if (env.ANTIGRAVITY_I18N_NO_BG === '1') return null;
    const override = env.ANTIGRAVITY_I18N_HOME;
    const home = override && override.trim() !== '' ? override : path.join(os.homedir(), '.antigravity-i18n');
    const file = path.join(home, 'background.json');
    if (!fs.existsSync(file)) return null;
    const cfgStat = fs.statSync(file);
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(String(fs.readFileSync(file, 'utf8')).replace(/^﻿/, '')) as Record<string, unknown>;
    } catch {
      return warn(`無法解析 ${file}`);
    }
    if (!cfg || cfg.enabled !== true) return null;
    const winPath = typeof cfg.windowsPath === 'string' ? cfg.windowsPath : '';
    const img = platform === 'win32' && winPath ? winPath : typeof cfg.imagePath === 'string' ? cfg.imagePath : '';
    if (!img) return warn('設定檔缺少 imagePath');
    const mime = MIME[path.extname(img).toLowerCase()];
    if (!mime) return warn(`不支援的圖片格式：${img}`);
    if (!fs.existsSync(img)) return warn(`找不到圖片：${img}`);
    const st = fs.statSync(img);
    if (!st.isFile()) return warn(`不是檔案：${img}`);
    if (st.size > MAX_BYTES) return warn(`圖片超過 10 MB：${img}`);

    const key = `${file}|${cfgStat.mtimeMs}|${cfgStat.size}|${img}|${st.mtimeMs}|${st.size}`;
    if (cache && cache.key === key && cache.payload !== undefined) return cache.payload;

    // 手動編輯的設定檔也要再驗證一次
    const num = (v: unknown, def: number, min: number, max: number): number => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };
    const size = cfg.size === 'contain' || cfg.size === 'auto' ? cfg.size : 'cover';
    const mode = cfg.mode === 'underlay' ? 'underlay' : 'overlay';
    const position =
      typeof cfg.position === 'string' && /^[A-Za-z0-9%.\s-]{1,64}$/.test(cfg.position) ? cfg.position.trim() : 'center';
    const data = fs.readFileSync(img) as Buffer;
    const payload: BackgroundPayload = {
      dataUrl: `data:${mime};base64,${data.toString('base64')}`,
      opacity: num(cfg.opacity, 0.12, 0.01, 1),
      blur: num(cfg.blur, 0, 0, 100),
      size,
      position,
      mode,
    };
    if (cache) {
      cache.key = key;
      cache.payload = payload;
    }
    return payload;
  } catch (e) {
    return warn((e as Error)?.message ?? String(e));
  }
}

export function applyBackground(p: BackgroundPayload): void {
  const ID = 'antigravity-i18n-bg';
  const STYLE_ID = 'antigravity-i18n-bg-style';
  const g = globalThis as unknown as { document?: Document; MutationObserver?: typeof MutationObserver; __ANTIGRAVITY_I18N_BG__?: { stop(): void } };
  try {
    const doc = g.document;
    if (!doc || !doc.documentElement || !p || typeof p.dataUrl !== 'string' || !/^data:image\/[a-z+.-]+;base64,/.test(p.dataUrl)) return;
    // 重新注入（例如同頁再次 dom-ready）時先移除舊的
    if (g.__ANTIGRAVITY_I18N_BG__) g.__ANTIGRAVITY_I18N_BG__.stop();
    doc.getElementById(ID)?.remove();
    doc.getElementById(STYLE_ID)?.remove();

    const overlay = p.mode !== 'underlay';
    const rules = [
      `#${ID}{`,
      'position:fixed;inset:0;top:0;right:0;bottom:0;left:0;',
      'pointer-events:none;user-select:none;',
      `z-index:${overlay ? 99999 : -1};`,
      `background-image:url("${p.dataUrl}");`,
      `background-size:${p.size};background-position:${p.position};background-repeat:no-repeat;`,
      `opacity:${p.opacity};`,
      `filter:${p.blur > 0 ? `blur(${p.blur}px)` : 'none'};`,
      '}',
    ];
    // underlay：讓根元素背景透明，背景圖才能從底層透出
    if (!overlay) rules.push('html,body{background-color:transparent !important;}');

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = rules.join('');
    const layer = doc.createElement('div');
    layer.id = ID;
    layer.setAttribute('data-antigravity-i18n-skip', '');
    layer.setAttribute('aria-hidden', 'true');

    const mount = (): void => {
      if (!style.isConnected) (doc.head || doc.documentElement).appendChild(style);
      if (!layer.isConnected) (doc.body || doc.documentElement).appendChild(layer);
    };
    mount();

    // 框架重繪 <body> 時把背景圖層補回來
    let observer: MutationObserver | null = null;
    if (typeof g.MutationObserver === 'function') {
      observer = new g.MutationObserver(() => {
        if (!style.isConnected || !layer.isConnected) mount();
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });
    }
    g.__ANTIGRAVITY_I18N_BG__ = {
      stop: () => {
        observer?.disconnect();
        layer.remove();
        style.remove();
      },
    };
  } catch (e) {
    console.warn('[antigravity-i18n] background apply failed:', (e as Error)?.message);
  }
}
