import pc from 'picocolors';
import { listManifests } from '../core/backup.js';
import {
  BACKGROUND_DEFAULTS,
  BackgroundError,
  backgroundStatus,
  clearBackground,
  setBackground,
  setBackgroundEnabled,
  setPreset,
  type BackgroundConfig,
  type WriteResult,
} from '../core/background.js';
import { BACKGROUND_PRESETS } from '../core/presets.js';
import { HOOK_VERSION } from '../core/runtime.js';
import { CliError, getToolHome, sym, warn } from './common.js';

export interface BgSetOptions {
  opacity?: string;
  blur?: string;
  size?: string;
  position?: string;
  mode?: string;
  tint?: string;
}

export interface BgPresetOptions {
  opacity?: string;
  blur?: string;
  tint?: string;
  mode?: string;
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
}

function paramsLine(cfg: BackgroundConfig): string {
  const tint = `遮罩：${cfg.tint ?? '無'}`;
  if (cfg.kind === 'preset') return `不透明度：${cfg.opacity}　模糊：${cfg.blur}px　模式：${cfg.mode}　${tint}`;
  return `不透明度：${cfg.opacity}　模糊：${cfg.blur}px　尺寸：${cfg.size}　位置：${cfg.position}　模式：${cfg.mode}　${tint}`;
}

function printConfig(cfg: BackgroundConfig): void {
  console.log(`  ${sym.dot} ${paramsLine(cfg)}`);
}

/** 背景功能的掛鉤狀態（結構化，供圖形控制台依介面語系顯示） */
export type HookHintInfo = { code: 'not-applied' } | { code: 'no-runtime' } | { code: 'old-hook'; current: number; latest: number };

export function hookHintInfo(home: string): HookHintInfo | null {
  const manifests = listManifests(home, 'app').map((m) => m.manifest);
  if (manifests.length === 0) return { code: 'not-applied' };
  if (!manifests.some((m) => m.runtime)) return { code: 'no-runtime' };
  if (!manifests.some((m) => (m.runtime?.hookVersion ?? 1) >= HOOK_VERSION)) {
    return { code: 'old-hook', current: Math.max(...manifests.map((m) => m.runtime?.hookVersion ?? 1)), latest: HOOK_VERSION };
  }
  return null;
}

/** 背景圖需要 App 已套用 v2 以上的主行程掛鉤（CLI 用的文字說明） */
export function hookHint(home: string): string | null {
  const info = hookHintInfo(home);
  if (!info) return null;
  if (info.code === 'not-applied') {
    return '尚未對 App 套用中文化。背景圖由 App 主行程掛鉤載入，請執行：antigravity-i18n apply --lang zh-TW --target app';
  }
  if (info.code === 'no-runtime') {
    return 'App 是以 --no-runtime 套用的，沒有主行程掛鉤，背景圖不會生效。請執行：antigravity-i18n apply --lang <語系> --target app --force';
  }
  // old-hook
  const v = info.current;
  const missing =
    v < 2
      ? '不支援背景圖'
      : v < 3
        ? '不支援內建預設（bg preset）、遮罩（--tint）與介面內背景面板（Ctrl+Alt+B）'
        : v < 4
          ? '沒有介面內背景面板（Ctrl+Alt+B）'
          : v < 5
            ? '介面面板（Ctrl+Alt+B）沒有「掃描未翻譯英文」工具'
            : v < 6
              ? '介面面板（Ctrl+Alt+B）沒有桌布收藏夾與輪播、外觀微調與五語即時切換'
              : '介面面板（Ctrl+Alt+B）本身只有繁體中文，沒有五語介面';
  return `App 的主行程掛鉤為舊版（v${v}，目前為 v${info.latest}），${missing}。請重新套用一次：antigravity-i18n apply --lang <語系> --target app --force`;
}

function printWrite(r: WriteResult): void {
  console.log(`  ${sym.dot} 設定檔：${pc.dim(r.file)}`);
  if (r.mirror) console.log(`  ${sym.dot} Windows 側設定檔：${pc.dim(r.mirror)}`);
  for (const w of r.warnings) warn(w);
}

function wrap(fn: () => number): number {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BackgroundError) throw new CliError(e.message);
    throw e;
  }
}

export async function bgSetCommand(imagePath: string, opts: BgSetOptions): Promise<number> {
  return wrap(() => {
    const home = getToolHome();
    const r = setBackground(home, imagePath, opts);
    console.log(`${sym.ok} 已設定背景圖：${r.config.imagePath}`);
    if (r.config.windowsPath) console.log(`  ${sym.dot} Windows 路徑：${r.config.windowsPath}`);
    printConfig(r.config);
    printWrite(r);
    const hint = hookHint(home);
    if (hint) warn(hint);
    else console.log(pc.dim('  重新開啟 Antigravity 視窗（或重新載入）後生效，不需要重新套用 app.asar。'));
    return 0;
  });
}

export async function bgPresetCommand(name: string, opts: BgPresetOptions): Promise<number> {
  return wrap(() => {
    const home = getToolHome();
    const r = setPreset(home, name, opts);
    const p = BACKGROUND_PRESETS[r.config.preset!]!;
    console.log(`${sym.ok} 已套用背景預設：${r.config.preset}（${p.label}）`);
    printConfig(r.config);
    printWrite(r);
    const hint = hookHint(home);
    if (hint) warn(hint);
    else console.log(pc.dim('  重新開啟 Antigravity 視窗（或重新載入）後生效，不需要重新套用 app.asar。'));
    return 0;
  });
}

export async function bgPresetsCommand(): Promise<number> {
  console.log(pc.bold('\n內建背景預設（純 CSS 漸層，不需圖片檔）\n'));
  const width = Math.max(...Object.keys(BACKGROUND_PRESETS).map((n) => n.length));
  for (const [name, p] of Object.entries(BACKGROUND_PRESETS)) {
    console.log(`  ${pc.bold(name.padEnd(width))}  ${p.label}　${pc.dim(p.description)}`);
  }
  console.log(pc.dim('\n  使用：antigravity-i18n bg preset <名稱> [--opacity 0.2] [--tint "rgba(0,0,0,0.25)"]\n'));
  return 0;
}

export async function bgToggleCommand(enabled: boolean): Promise<number> {
  return wrap(() => {
    const r = setBackgroundEnabled(getToolHome(), enabled);
    console.log(`${sym.ok} 背景圖已${enabled ? '啟用' : '停用（設定已保留，可用 bg on 重新啟用）'}`);
    printWrite(r);
    return 0;
  });
}

export async function bgClearCommand(): Promise<number> {
  return wrap(() => {
    const removed = clearBackground(getToolHome());
    if (removed.length === 0) console.log(`${sym.info} 沒有背景圖設定可清除`);
    for (const f of removed) console.log(`${sym.ok} 已刪除：${f}`);
    return 0;
  });
}

/** 輸出背景圖狀態（bg status 與 status 共用） */
export function printBackgroundStatus(home: string, indent = ''): void {
  let st: ReturnType<typeof backgroundStatus>;
  try {
    st = backgroundStatus(home);
  } catch (e) {
    console.log(`${indent}${sym.fail} ${pc.red((e as Error).message)}`);
    return;
  }
  const cfg = st.config;
  if (!cfg) {
    console.log(`${indent}${sym.dot} 背景圖：${pc.dim('未設定')}  ${pc.dim(st.file)}`);
    return;
  }
  const state = cfg.enabled ? pc.green('已啟用') : pc.yellow('已停用（設定保留）');
  console.log(`${indent}${sym.ok} 背景圖：${state}`);
  if (cfg.kind === 'preset') {
    const p = BACKGROUND_PRESETS[cfg.preset ?? ''];
    const known = p ? pc.green(p.label) : pc.red('未知的預設（請執行 bg presets 查看可用名稱）');
    console.log(`${indent}  ${sym.dot} 預設：${cfg.preset}（${known}）`);
  } else {
    const exists = st.imageExists ? pc.green(`存在，${formatBytes(st.imageSize ?? 0)}`) : pc.red('找不到檔案');
    console.log(`${indent}  ${sym.dot} 圖片：${cfg.imagePath}（${exists}）`);
    if (cfg.windowsPath) console.log(`${indent}  ${sym.dot} Windows 路徑：${cfg.windowsPath}`);
  }
  console.log(`${indent}  ${sym.dot} ${paramsLine(cfg)}`);
  console.log(`${indent}  ${sym.dot} 設定檔：${pc.dim(st.file)}`);
  if (st.mirror) {
    const sync = st.mirrorInSync ? pc.green('已同步') : pc.yellow('未同步（請重新執行 bg set 或 bg on）');
    console.log(`${indent}  ${sym.dot} Windows 側設定檔：${sync}  ${pc.dim(st.mirror)}`);
  }
}

export async function bgStatusCommand(): Promise<number> {
  const home = getToolHome();
  console.log(pc.bold('\n自訂背景圖（Antigravity App）\n'));
  printBackgroundStatus(home);
  const hint = hookHint(home);
  if (hint) warn(hint);
  console.log(pc.dim(`\n  預設值：不透明度 ${BACKGROUND_DEFAULTS.opacity}、模糊 ${BACKGROUND_DEFAULTS.blur}px、${BACKGROUND_DEFAULTS.size}、${BACKGROUND_DEFAULTS.position}、${BACKGROUND_DEFAULTS.mode}`));
  console.log(pc.dim('  暫時停用：bg off；臨時關閉：以 ANTIGRAVITY_I18N_NO_BG=1 啟動 Antigravity\n'));
  return 0;
}
