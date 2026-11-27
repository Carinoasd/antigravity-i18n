/**
 * 自訂背景圖：會被 `toString()` 序列化、內嵌進 app.asar 主行程掛鉤的兩個函式。
 *
 * - {@link readBackgroundPayload}：在 **Electron 主行程** 執行，每次視窗 `dom-ready`
 *   時讀取 `background.json`，圖片轉成 data URL、預設則查內建漸層表。
 *   換圖或換預設都不需要重新打包 app.asar。
 * - {@link applyBackground}：在 **renderer** 執行，注入 `<style>` 與背景圖層。
 *
 * ⚠️ 兩者都必須完全自足：不可引用模組層級變數、import 或其他函式（常數請寫在函式內）。
 *    任何錯誤只能 `console.warn`，絕不可拋出，以免影響 App 啟動與翻譯 runtime。
 *
 * 設定檔向下相容：沒有 `kind` 欄位的舊設定一律視為圖片（`kind: "image"`）。
 */

export type BackgroundSize = 'cover' | 'contain' | 'auto';
export type BackgroundMode = 'overlay' | 'underlay';
export type BackgroundKind = 'image' | 'preset';

/** 主行程傳給 renderer 的背景資料 */
export interface BackgroundPayload {
  kind: BackgroundKind;
  /** CSS background-image 值：`url("data:image/...;base64,...")` 或漸層 */
  image: string;
  /** kind 為 preset 時的預設名稱 */
  preset?: string;
  /** 可讀性遮罩顏色（疊在背景上） */
  tint?: string;
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
  presets?: Record<string, string>,
): BackgroundPayload | null {
  const MAX_BYTES = 10 * 1024 * 1024;
  const MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const GRADIENT_RE = /^[A-Za-z0-9#%.,()\s-]+$/;
  const TINT_RE =
    /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgba?|hsla?)\(\s*[0-9.+\-%\s,/]*\d[0-9.+\-%\s,/]*(?:(?:deg|turn|rad|grad)[0-9.+\-%\s,/]*)?\)|transparent|black|white)$/i;
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

    // 手動編輯的設定檔也要再驗證一次
    const num = (v: unknown, def: number, min: number, max: number): number => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };
    const tintRaw = typeof cfg.tint === 'string' ? cfg.tint.trim() : '';
    let tint: string | undefined;
    if (tintRaw && tintRaw.toLowerCase() !== 'none') {
      if (TINT_RE.test(tintRaw) && tintRaw.length <= 64) tint = tintRaw;
      else warn(`已忽略不安全的 tint 值：${tintRaw}`);
    }
    const common = {
      opacity: num(cfg.opacity, 0.12, 0.01, 1),
      blur: num(cfg.blur, 0, 0, 100),
      size: (cfg.size === 'contain' || cfg.size === 'auto' ? cfg.size : 'cover') as BackgroundSize,
      position:
        typeof cfg.position === 'string' && /^[A-Za-z0-9%.\s-]{1,64}$/.test(cfg.position) ? cfg.position.trim() : 'center',
      mode: (cfg.mode === 'underlay' ? 'underlay' : 'overlay') as BackgroundMode,
      tint,
    };

    // ── 內建漸層預設 ──
    if (cfg.kind === 'preset') {
      const name = typeof cfg.preset === 'string' ? cfg.preset : '';
      const image = presets && Object.prototype.hasOwnProperty.call(presets, name) ? presets[name] : undefined;
      if (!image) return warn(`未知的預設「${name}」（若是新版工具才有的預設，請重新 apply --force 更新掛鉤）`);
      if (!GRADIENT_RE.test(image) || !/gradient\(/.test(image)) return warn(`預設「${name}」的 CSS 不合法`);
      return { kind: 'preset', image, preset: name, ...common, size: 'cover', position: 'center' };
    }

    // ── 圖片（沒有 kind 欄位的舊設定也走這裡） ──
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
    const data = fs.readFileSync(img) as Buffer;
    const payload: BackgroundPayload = { kind: 'image', image: `url("data:${mime};base64,${data.toString('base64')}")`, ...common };
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
  const IMAGE_RE = /^url\("data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+"\)$/;
  const GRADIENT_RE = /^[A-Za-z0-9#%.,()\s-]+$/;
  const TINT_RE =
    /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgba?|hsla?)\(\s*[0-9.+\-%\s,/]*\d[0-9.+\-%\s,/]*(?:(?:deg|turn|rad|grad)[0-9.+\-%\s,/]*)?\)|transparent|black|white)$/i;
  const g = globalThis as unknown as { document?: Document; MutationObserver?: typeof MutationObserver; __ANTIGRAVITY_I18N_BG__?: { stop(): void } };
  try {
    const doc = g.document;
    if (!doc || !doc.documentElement || !p || typeof p.image !== 'string') return;
    const valid = p.kind === 'preset' ? GRADIENT_RE.test(p.image) && /gradient\(/.test(p.image) : IMAGE_RE.test(p.image);
    if (!valid) return;
    const tint = typeof p.tint === 'string' && p.tint.length <= 64 && TINT_RE.test(p.tint) ? p.tint : '';
    const blur = typeof p.blur === 'number' && p.blur > 0 ? Math.min(p.blur, 100) : 0;

    // 重新注入（例如同頁再次 dom-ready）時先移除舊的
    if (g.__ANTIGRAVITY_I18N_BG__) g.__ANTIGRAVITY_I18N_BG__.stop();
    doc.getElementById(ID)?.remove();
    doc.getElementById(STYLE_ID)?.remove();

    const overlay = p.mode !== 'underlay';
    // blur 會讓邊緣像素向內混入透明區域，造成視窗四邊出現淡白／透明暈邊；
    // 讓圖層向外延伸 blur * 2 px，模糊的邊緣就會落在視窗外
    const edge = blur > 0 ? `-${blur * 2}px` : '0';
    // tint 以單色漸層疊在背景之上（同一圖層，跟著 opacity 一起淡化）
    const layers = tint ? `linear-gradient(${tint}, ${tint}), ${p.image}` : p.image;
    const sizes = tint ? `100% 100%, ${p.size}` : p.size;
    const positions = tint ? `center, ${p.position}` : p.position;
    const rules = [
      `#${ID}{`,
      `position:fixed;inset:${edge};top:${edge};right:${edge};bottom:${edge};left:${edge};`,
      'pointer-events:none;user-select:none;',
      `z-index:${overlay ? 99999 : -1};`,
      `background-image:${layers};`,
      `background-size:${sizes};background-position:${positions};background-repeat:no-repeat;`,
      `opacity:${p.opacity};`,
      `filter:${blur > 0 ? `blur(${blur}px)` : 'none'};`,
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
    if (p.kind === 'preset' && p.preset) layer.setAttribute('data-preset', p.preset);

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
