import pc from 'picocolors';
import { listManifests } from '../core/backup.js';
import {
  BACKGROUND_DEFAULTS,
  BackgroundError,
  backgroundStatus,
  clearBackground,
  setBackground,
  setBackgroundEnabled,
  type BackgroundConfig,
  type WriteResult,
} from '../core/background.js';
import { HOOK_VERSION } from '../core/runtime.js';
import { CliError, getToolHome, sym, warn } from './common.js';

export interface BgSetOptions {
  opacity?: string;
  blur?: string;
  size?: string;
  position?: string;
  mode?: string;
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
}

function printConfig(cfg: BackgroundConfig): void {
  console.log(`  ${sym.dot} 不透明度：${cfg.opacity}　模糊：${cfg.blur}px　尺寸：${cfg.size}　位置：${cfg.position}　模式：${cfg.mode}`);
}

/** 背景圖需要 App 已套用 v2 以上的主行程掛鉤 */
export function hookHint(home: string): string | null {
  const manifests = listManifests(home, 'app').map((m) => m.manifest);
  if (manifests.length === 0) {
    return '尚未對 App 套用中文化。背景圖由 App 主行程掛鉤載入，請執行：antigravity-i18n apply --lang zh-TW --target app';
  }
  if (!manifests.some((m) => m.runtime)) {
    return 'App 是以 --no-runtime 套用的，沒有主行程掛鉤，背景圖不會生效。請執行：antigravity-i18n apply --lang <語系> --target app --force';
  }
  if (!manifests.some((m) => (m.runtime?.hookVersion ?? 1) >= HOOK_VERSION)) {
    return 'App 的主行程掛鉤為舊版，不支援背景圖。請重新套用一次：antigravity-i18n apply --lang <語系> --target app --force';
  }
  return null;
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
  const exists = st.imageExists ? pc.green(`存在，${formatBytes(st.imageSize ?? 0)}`) : pc.red('找不到檔案');
  console.log(`${indent}  ${sym.dot} 圖片：${cfg.imagePath}（${exists}）`);
  if (cfg.windowsPath) console.log(`${indent}  ${sym.dot} Windows 路徑：${cfg.windowsPath}`);
  console.log(
    `${indent}  ${sym.dot} 不透明度：${cfg.opacity}　模糊：${cfg.blur}px　尺寸：${cfg.size}　位置：${cfg.position}　模式：${cfg.mode}`,
  );
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
