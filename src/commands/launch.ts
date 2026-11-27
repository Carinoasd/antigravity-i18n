import fs from 'node:fs';
import pc from 'picocolors';
import { detectTarget, isWsl } from '../config/paths.js';
import { loadDictionary, loadRuntimeDicts, readToolVersion } from '../core/locales.js';
import { LaunchError, smartLaunch, type LaunchDeps, type LaunchResult } from '../core/launcher.js';
import { TARGET_MODULES, type ApplyLang } from '../types.js';
import { CliError, getToolHome, langLabel, parseApplyLang, sym, warn } from './common.js';

export interface LaunchCommandOptions {
  lang?: string;
  path?: string;
  /** commander 的 --no-reapply 會設為 false */
  reapply?: boolean;
}

const REASON_LABEL = {
  updated: 'app.asar 與上次修補後不同（可能是官方剛自動更新）',
  'old-hook': '主行程掛鉤為舊版',
  'lang-changed': '指定了不同的語系',
} as const;

/** CLI 與測試共用的預設相依（偵測、詞庫、平台） */
export function defaultLaunchDeps(): LaunchDeps {
  return {
    toolHome: getToolHome(),
    toolVersion: readToolVersion(),
    detect: (customPath) => detectTarget('app', { customPath }),
    loadDict: (lang) => loadDictionary(lang, TARGET_MODULES.app),
    loadRuntimeDicts: () => loadRuntimeDicts(TARGET_MODULES.app),
    env: { platform: process.platform, wsl: isWsl(), exists: (p) => fs.existsSync(p) },
  };
}

export function printLaunchResult(r: LaunchResult): void {
  console.log(`${sym.dot} 安裝路徑：${r.installRoot}`);
  switch (r.status) {
    case 'up-to-date':
      console.log(`${sym.ok} 已是最新修補狀態（${langLabel(r.lang ?? 'none')}），略過重新套用${r.cached ? pc.dim('（雜湊快取命中）') : ''}`);
      break;
    case 'reapplied':
      console.log(`${sym.ok} ${pc.green('已重新套用')} ${langLabel(r.lang ?? 'none')}：${r.reasons.map((x) => REASON_LABEL[x]).join('、')}`);
      for (const w of r.apply?.warnings ?? []) warn(w);
      break;
    case 'locked':
      warn(`偵測到需要重新套用（${r.reasons.map((x) => REASON_LABEL[x]).join('、')}），但 Antigravity 可能正在執行、鎖住了檔案，本次先略過。`);
      console.log(pc.dim('  完全關閉 Antigravity（含系統匣圖示）後，再從捷徑開啟一次即可自動完成。'));
      break;
    case 'failed':
      warn(`重新套用失敗，仍會啟動 Antigravity：${r.error ?? '未知原因'}`);
      break;
    case 'not-applied':
      console.log(`${sym.info} 尚未套用過在地化（沒有 manifest），直接啟動。可先執行 ${pc.bold('antigravity-i18n apply --lang zh-TW --target app')}`);
      break;
    case 'disabled':
      console.log(`${sym.info} 已指定 --no-reapply，不檢查更新`);
      break;
  }
  console.log(`${sym.ok} 已啟動 Antigravity ${pc.dim(r.command.display)}`);
}

export async function launchCommand(opts: LaunchCommandOptions, deps: LaunchDeps = defaultLaunchDeps()): Promise<number> {
  const lang: ApplyLang | undefined = opts.lang === undefined ? undefined : parseApplyLang(opts.lang);
  let r: LaunchResult;
  try {
    r = await smartLaunch({ lang, path: opts.path, reapply: opts.reapply !== false }, deps);
  } catch (e) {
    if (e instanceof LaunchError) throw new CliError(e.message);
    throw e;
  }
  printLaunchResult(r);
  // 已經啟動 Antigravity；只有非鎖定的重套用失敗才回傳非 0，方便腳本察覺
  return r.status === 'failed' ? 1 : 0;
}
