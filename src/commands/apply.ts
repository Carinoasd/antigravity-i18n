import pc from 'picocolors';
import { loadDictionary, readToolVersion } from '../core/locales.js';
import { applyTarget, type ApplyResult } from '../core/patcher.js';
import { TARGET_LABELS, TARGET_MODULES } from '../types.js';
import { CliError, getToolHome, parseLang, parseTargets, pct, resolveTargets, sym, warn } from './common.js';

export interface ApplyOptions {
  lang?: string;
  target?: string;
  path?: string;
  dryRun?: boolean;
  force?: boolean;
}

function printTopHits(r: ApplyResult, n = 5): void {
  const top = Object.entries(r.stats.hitsByKey)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  if (top.length === 0) return;
  console.log(`  ${pc.dim('命中最多：')}${top.map(([k, c]) => `${k} ×${c}`).join(pc.dim('、'))}`);
}

export async function applyCommand(opts: ApplyOptions): Promise<number> {
  const lang = parseLang(opts.lang)!;
  const { selector, ids } = parseTargets(opts.target);
  const home = getToolHome();
  const toolVersion = readToolVersion();
  const resolved = resolveTargets(ids, opts.path);

  console.log(pc.bold(`\n${opts.dryRun ? '預覽（dry-run）' : '套用'}中文化：${lang}\n`));

  let failures = 0;
  let processed = 0;
  for (const { id, target } of resolved) {
    console.log(pc.bold(`■ ${id}  ${pc.dim(TARGET_LABELS[id])}`));
    if (!target) {
      if (selector === 'all') {
        console.log(`  ${pc.dim('未偵測到安裝，略過')}\n`);
        continue;
      }
      throw new CliError(`找不到 ${TARGET_LABELS[id]} 的安裝位置，請以 --path 手動指定`);
    }
    console.log(`  ${sym.dot} 安裝路徑：${target.installRoot}`);
    const dict = loadDictionary(lang, TARGET_MODULES[id]);
    let r: ApplyResult;
    try {
      r = await applyTarget(target, { lang, dict, toolHome: home, dryRun: opts.dryRun, force: opts.force, toolVersion });
    } catch (e) {
      failures++;
      console.log(`  ${sym.fail} ${pc.red((e as Error).message)}\n`);
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
          `  ${sym.info} 已套用過 ${r.previousLang}，為避免重複覆蓋已略過。` +
            `${r.previousLang !== lang ? `切換為 ${lang} ` : '重新套用'}請加上 ${pc.bold('--force')}\n`,
        );
        continue;
      default:
        break;
    }
    const s = r.stats;
    console.log(`  ${sym.dot} 命中詞彙：${s.matchedKeys}/${s.totalKeys}（預計覆蓋率 ${pc.bold(pct(s.coverage))}），共 ${s.totalHits} 處替換`);
    console.log(`  ${sym.dot} ${r.status === 'dry-run' ? '將修改' : '已修改'}檔案：${r.files.length} 個`);
    for (const f of r.files) console.log(`     ${pc.dim(`[${f.role}]`)} ${f.path} ${pc.dim(`(${f.hits} 處)`)}`);
    printTopHits(r);
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
    console.log(`${sym.info} 也可以改用零侵入模式：${pc.bold(`antigravity-i18n rules install --lang ${lang}`)}\n`);
    return 1;
  }
  return failures > 0 ? 1 : 0;
}
