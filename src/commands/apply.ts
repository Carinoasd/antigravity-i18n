import pc from 'picocolors';
import { formatFsError } from '../core/errors.js';
import { loadDictionary, loadRuntimeDicts, readToolVersion } from '../core/locales.js';
import { applyTarget, type ApplyResult } from '../core/patcher.js';
import { TARGET_LABELS, TARGET_MODULES } from '../types.js';
import { CliError, getToolHome, langLabel, parseApplyLang, parseTargets, pct, resolveTargets, sym, warn } from './common.js';

export interface ApplyOptions {
  lang?: string;
  target?: string;
  path?: string;
  dryRun?: boolean;
  force?: boolean;
  /** commander 的 --no-runtime 會設為 false */
  runtime?: boolean;
}

function printTopHits(r: ApplyResult, n = 5): void {
  const top = Object.entries(r.stats.hitsByKey)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  if (top.length === 0) return;
  console.log(`  ${pc.dim('命中最多：')}${top.map(([k, c]) => `${k} ×${c}`).join(pc.dim('、'))}`);
}

const CHANGE_LABEL = { static: '靜態', hook: '掛鉤', runtime: '新增' } as const;

/** 輸出套用 / 預覽摘要；asar 目標分開列出靜態層與執行期注入層 */
export function printSummary(r: ApplyResult): void {
  const s = r.stats;
  const dry = r.status === 'dry-run';
  const layer = r.runtime ? '靜態層' : '命中詞彙';
  if (r.lang === 'none') {
    console.log(`  ${sym.dot} 靜態層：${pc.dim('僅背景模式，不做任何翻譯')}`);
  } else {
    console.log(`  ${sym.dot} ${layer}：命中 ${s.matchedKeys}/${s.totalKeys} 條詞彙（覆蓋率 ${pc.bold(pct(s.coverage))}），共 ${s.totalHits} 處替換`);
  }
  if (r.runtime) {
    const rt = r.runtime;
    if (rt.enabled && rt.translation === false) {
      console.log(`  ${sym.dot} 執行期注入層：${dry ? '將掛載' : '已掛載'}背景與 Ctrl+Alt+B 介面面板（不載入翻譯 runtime），掛載於 ${rt.mainEntry}（${rt.format}）`);
    } else if (rt.enabled) {
      const pattern = rt.patternEntries > 0 ? `，其中 ${rt.patternEntries} 條含佔位符` : '';
      console.log(
        `  ${sym.dot} 執行期注入層：${dry ? '將隨' : '已隨'} runtime 載入 ${pc.bold(String(rt.entries))} 條詞彙${pattern}` +
          `，掛載於 ${rt.mainEntry}（${rt.format}）`,
      );
    } else {
      console.log(`  ${sym.dot} 執行期注入層：${pc.dim(`未啟用（${rt.reason ?? '未知原因'}）`)}`);
    }
  }
  console.log(`  ${sym.dot} ${dry ? '將修改' : '已修改'}檔案：${r.files.length} 個`);
  for (const f of r.files) console.log(`     ${pc.dim(`[${f.role}]`)} ${f.path} ${pc.dim(`(${f.hits} 處)`)}`);
  if (r.asarEntries && r.asarEntries.length > 0) {
    console.log(`  ${sym.dot} app.asar 內容：`);
    for (const c of r.asarEntries) {
      const hits = c.kind === 'runtime' ? '' : pc.dim(` (${c.hits} 處)`);
      console.log(`     ${pc.dim(`[${CHANGE_LABEL[c.kind]}]`)} ${c.path}${hits}`);
    }
  }
  printTopHits(r);
}

export async function applyCommand(opts: ApplyOptions): Promise<number> {
  const lang = parseApplyLang(opts.lang);
  const { selector, ids } = parseTargets(opts.target);
  if (lang === 'none' && selector !== 'all' && selector !== 'app') {
    throw new CliError('僅背景模式（--lang none）只適用於 app 目標，請改用 --target app');
  }
  const home = getToolHome();
  const toolVersion = readToolVersion();
  const resolved = resolveTargets(ids, opts.path);

  console.log(
    pc.bold(
      lang === 'none'
        ? `\n${opts.dryRun ? '預覽（dry-run）' : '套用'}僅背景模式：只掛載背景與 Ctrl+Alt+B 介面面板，維持英文介面\n`
        : `\n${opts.dryRun ? '預覽（dry-run）' : '套用'}中文化：${lang}\n`,
    ),
  );

  let failures = 0;
  let processed = 0;
  for (const { id, target } of resolved) {
    console.log(pc.bold(`■ ${id}  ${pc.dim(TARGET_LABELS[id])}`));
    if (lang === 'none' && id !== 'app') {
      console.log(`  ${pc.dim('僅背景模式只適用於 app，略過')}\n`);
      continue;
    }
    if (!target) {
      if (selector === 'all') {
        console.log(`  ${pc.dim('未偵測到安裝，略過')}\n`);
        continue;
      }
      throw new CliError(`找不到 ${TARGET_LABELS[id]} 的安裝位置，請以 --path 手動指定`);
    }
    console.log(`  ${sym.dot} 安裝路徑：${target.installRoot}`);
    const dict = lang === 'none' ? {} : loadDictionary(lang, TARGET_MODULES[id]);
    let r: ApplyResult;
    try {
      r = await applyTarget(target, {
        lang,
        dict,
        toolHome: home,
        dryRun: opts.dryRun,
        force: opts.force,
        toolVersion,
        runtime: opts.runtime !== false,
        // app：四語一併打包進 runtime，介面面板可免重整切換
        runtimeDicts: id === 'app' && lang !== 'none' && opts.runtime !== false ? loadRuntimeDicts(TARGET_MODULES.app) : undefined,
      });
    } catch (e) {
      failures++;
      // EBUSY / EPERM / EACCES 會附上具體的處理步驟
      console.log(`${formatFsError(e).split('\n').map((l, i) => (i === 0 ? `  ${sym.fail} ${pc.red(l)}` : `  ${l}`)).join('\n')}\n`);
      continue;
    }
    processed++;
    for (const w of r.warnings) warn(w);
    switch (r.status) {
      case 'unsupported':
        failures += selector === 'all' ? 0 : 1;
        console.log(`  ${sym.warn} 此安裝目前不支援自動中文化\n`);
        continue;
      case 'already-applied':
        console.log(
          `  ${sym.info} 已套用過 ${langLabel(r.previousLang ?? lang)}，為避免重複覆蓋已略過。` +
            `${r.previousLang !== lang ? `切換為 ${langLabel(lang)} ` : '重新套用'}請加上 ${pc.bold('--force')}\n`,
        );
        continue;
      default:
        break;
    }
    printSummary(r);
    if (r.status === 'applied') {
      console.log(`  ${sym.ok} ${pc.green('完成！')}已備份原始檔並寫入 manifest：${pc.dim(r.manifestPath)}`);
      console.log(`  ${pc.dim('重新啟動 Antigravity 後生效；如需還原：antigravity-i18n restore --target ' + id)}`);
    } else if (r.status === 'dry-run') {
      console.log(`  ${sym.info} dry-run 模式，未修改任何檔案`);
    }
    console.log();
  }

  if (processed === 0 && failures === 0) {
    console.log(`${sym.warn} 沒有偵測到任何 Antigravity 安裝。可用 ${pc.bold('antigravity-i18n status')} 檢查，或以 --target 搭配 --path 手動指定。`);
    if (lang !== 'none') console.log(`${sym.info} 也可以改用零侵入模式：${pc.bold(`antigravity-i18n rules install --lang ${lang}`)}\n`);
    return 1;
  }
  return failures > 0 ? 1 : 0;
}
