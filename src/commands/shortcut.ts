import pc from 'picocolors';
import { detectTarget } from '../config/paths.js';
import { FileLockError, formatFsError } from '../core/errors.js';
import { resolveLaunchTarget } from '../core/launcher.js';
import {
  ShortcutError,
  defaultShortcutEnv,
  installShortcut,
  removeShortcut,
  shortcutStatus,
  type ShortcutEnv,
  type ShortcutKind,
  type ShortcutResult,
} from '../core/shortcut.js';
import type { ApplyLang } from '../types.js';
import { CliError, getToolHome, parseApplyLang, sym, warn } from './common.js';

export interface ShortcutCommandOptions {
  name?: string;
  lang?: string;
  path?: string;
  dir?: string;
  force?: boolean;
}

export interface ShortcutCommandDeps {
  env: ShortcutEnv;
  /** 回傳 Antigravity App 的安裝根目錄（圖示、WSL 判斷用） */
  installRoot: (customPath?: string) => string | undefined;
}

export const KIND_LABEL: Record<ShortcutKind, string> = {
  'windows-lnk': 'Windows 桌面捷徑（.lnk）',
  'wsl-lnk': 'Windows 桌面捷徑（.lnk，透過 wsl.exe 執行）',
  'macos-command': 'macOS 桌面腳本（.command）',
  'linux-desktop': 'Linux 應用程式選單項目（.desktop）',
};

export function defaultShortcutDeps(): ShortcutCommandDeps {
  const toolHome = getToolHome();
  return {
    env: defaultShortcutEnv(),
    installRoot: (customPath) => resolveLaunchTarget({ toolHome, detect: (p) => detectTarget('app', { customPath: p }) }, customPath)?.installRoot,
  };
}

function print(r: ShortcutResult): void {
  console.log(`${sym.dot} 類型：${KIND_LABEL[r.kind]}`);
  console.log(`${sym.dot} 位置：${r.file}`);
  console.log(`${sym.dot} 執行：${pc.dim(r.command)}`);
  for (const w of r.warnings) warn(w);
}

export async function shortcutCommand(action: string, opts: ShortcutCommandOptions, deps: ShortcutCommandDeps = defaultShortcutDeps()): Promise<number> {
  const lang: ApplyLang | undefined = opts.lang === undefined ? undefined : parseApplyLang(opts.lang);
  const so = { name: opts.name, lang, path: opts.path, dir: opts.dir, force: opts.force };
  const root = deps.installRoot(opts.path);
  try {
    if (action === 'install') {
      const r = installShortcut(so, deps.env, root);
      console.log(`${sym.ok} ${pc.green('已建立捷徑')}「${r.name}」`);
      print(r);
      console.log(pc.dim('  之後從這個捷徑開啟 Antigravity：若官方剛自動更新，會先自動重新套用再啟動（不常駐任何背景程式）。'));
      return 0;
    }
    if (action === 'remove') {
      const r = removeShortcut(so, deps.env, root);
      if (r.removed) console.log(`${sym.ok} 已移除捷徑：${r.file}`);
      else console.log(`${sym.info} 沒有找到捷徑：${pc.dim(r.file)}`);
      return 0;
    }
    if (action === 'status') {
      const r = shortcutStatus(so, deps.env, root);
      const state = !r.exists ? pc.dim('未建立') : r.managed ? pc.green('已建立') : pc.yellow('同名檔案已存在（非本工具建立）');
      console.log(`${sym.dot} 捷徑「${r.name}」：${state}`);
      print(r);
      return 0;
    }
  } catch (e) {
    if (e instanceof ShortcutError) throw new CliError(e.message);
    if (e instanceof FileLockError) throw new CliError(formatFsError(e));
    throw e;
  }
  throw new CliError(`不支援的動作「${action}」，可用值：install、remove、status`);
}
