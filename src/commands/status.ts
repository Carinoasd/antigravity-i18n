import pc from 'picocolors';
import { listManifests } from '../core/backup.js';
import { inspectManifest, inspectTarget } from '../core/patcher.js';
import { rulesStatus } from '../core/rules.js';
import { TARGET_IDS, TARGET_LABELS } from '../types.js';
import { getToolHome, pct, resolveTargets, sym, userHome } from './common.js';

export interface StatusOptions {
  path?: string;
  target?: string;
  home?: string;
}

const FILE_STATE_LABEL = {
  patched: pc.green('已中文化'),
  original: pc.dim('原始版本'),
  changed: pc.yellow('已被修改（可能為官方更新）'),
  missing: pc.red('檔案不存在'),
} as const;

export async function statusCommand(opts: StatusOptions = {}): Promise<number> {
  const home = getToolHome();
  console.log(pc.bold('\nAntigravity 中文化狀態\n'));
  console.log(`${sym.dot} 工具資料目錄：${pc.dim(home)}\n`);

  const ids = opts.target && opts.target !== 'all' ? [opts.target as (typeof TARGET_IDS)[number]] : [...TARGET_IDS];
  const resolved = resolveTargets(ids, opts.path);

  for (const { id, target } of resolved) {
    console.log(pc.bold(`■ ${id}  ${pc.dim(TARGET_LABELS[id])}`));
    if (!target) {
      console.log(`  ${sym.fail} 未偵測到安裝（可用 --path 手動指定）`);
      // 即使偵測不到，也列出殘留的 manifest，方便還原
      for (const { file, manifest } of listManifests(home, id)) {
        console.log(`  ${sym.warn} 找到先前的套用紀錄：${manifest.installRoot}（${manifest.lang}）`);
        console.log(`     ${pc.dim(file)}`);
      }
      console.log();
      continue;
    }
    console.log(`  ${sym.ok} 安裝路徑：${target.installRoot} ${pc.dim(`(${target.source === 'custom' ? '手動指定' : '自動偵測'}, ${target.kind})`)}`);
    if (!target.supported) {
      console.log(`  ${sym.warn} ${pc.yellow(`不支援：${target.reason ?? '未知原因'}`)}\n`);
      continue;
    }
    console.log(`  ${sym.dot} 可修補檔案：${target.files.length} 個`);
    const st = await inspectTarget(target, home);
    if (!st.manifest) {
      console.log(`  ${sym.dot} 中文化：${pc.dim('尚未套用')}\n`);
      continue;
    }
    const m = st.manifest;
    const label =
      st.state === 'applied'
        ? pc.green(`已套用 ${m.lang}`)
        : st.state === 'outdated'
          ? pc.yellow(`部分失效（${m.lang}，偵測到檔案變更，可能為官方更新，建議重新 apply）`)
          : pc.dim('已還原為原始版本（manifest 殘留）');
    console.log(`  ${sym.dot} 中文化：${label}`);
    console.log(`  ${sym.dot} 套用時間：${m.appliedAt}　工具版本：${m.toolVersion}`);
    console.log(`  ${sym.dot} ${m.runtime ? '靜態層' : ''}覆蓋率：${pct(m.stats.coverage)}（${m.stats.matchedKeys}/${m.stats.totalKeys} 條詞彙，共 ${m.stats.totalHits} 處）`);
    if (m.runtime) {
      console.log(`  ${sym.dot} 執行期注入層：已啟用（${m.runtime.entries} 條詞彙，掛載於 ${m.runtime.mainEntry}）`);
    } else if (m.kind === 'asar') {
      console.log(`  ${sym.dot} 執行期注入層：${pc.dim('未啟用')}`);
    }
    for (const f of st.files) {
      const b = f.backupOk ? pc.green('備份正常') : pc.red(`備份異常：${f.backupReason}`);
      console.log(`     ${pc.dim(f.role.padEnd(9))} ${FILE_STATE_LABEL[f.state]}　${b}`);
      console.log(`     ${pc.dim(f.path)}`);
    }
    console.log();
  }

  // 其他不在偵測結果中的 manifest（例如透過 --path 套用的自訂路徑）
  const seen = new Set(resolved.filter((r) => r.target).map((r) => r.target!.installRoot));
  const extra = listManifests(home).filter(({ manifest }) => ids.includes(manifest.target) && !seen.has(manifest.installRoot));
  if (extra.length > 0 && !opts.path) {
    console.log(pc.bold('■ 其他套用紀錄'));
    for (const { file, manifest } of extra) {
      const st = await inspectManifest(file);
      console.log(`  ${sym.dot} [${manifest.target}] ${manifest.installRoot}：${manifest.lang}，狀態 ${st.state}`);
    }
    console.log();
  }

  console.log(pc.bold('■ 全域規則（~/.gemini/config/rules）'));
  for (const r of rulesStatus(userHome(opts.home))) {
    if (!r.exists) {
      console.log(`  ${sym.dot} ${r.lang}：${pc.dim('未安裝')}`);
      continue;
    }
    const tag = r.managed ? (r.upToDate ? pc.green('已安裝（最新）') : pc.yellow('已安裝（可更新）')) : pc.yellow('已存在（非本工具建立）');
    console.log(`  ${sym.ok} ${r.lang}：${tag} ${pc.dim(`trigger=${r.trigger ?? '?'}`)}`);
    console.log(`     ${pc.dim(r.path)}`);
  }
  console.log();
  return 0;
}
