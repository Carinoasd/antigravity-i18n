import pc from 'picocolors';
import { listManifests, manifestPathFor } from '../core/backup.js';
import { restoreManifest } from '../core/patcher.js';
import { TARGET_LABELS } from '../types.js';
import { getToolHome, parseTargets, resolveTargets, sym } from './common.js';

export interface RestoreOptions {
  target?: string;
  path?: string;
  force?: boolean;
}

export async function restoreCommand(opts: RestoreOptions): Promise<number> {
  const { ids } = parseTargets(opts.target);
  const home = getToolHome();
  console.log(pc.bold('\n還原原始檔案\n'));

  // 以 manifest 為準：即使目前偵測不到安裝，也能依紀錄還原
  const jobs: { id: (typeof ids)[number]; file: string }[] = [];
  if (opts.path) {
    for (const { id, target } of resolveTargets(ids, opts.path)) {
      if (target) jobs.push({ id, file: manifestPathFor(home, target) });
    }
  } else {
    for (const id of ids) for (const { file } of listManifests(home, id)) jobs.push({ id, file });
  }
  const existing = jobs.filter((j) => listManifests(home, j.id).some((m) => m.file === j.file));

  if (existing.length === 0) {
    console.log(`${sym.info} 沒有可還原的套用紀錄（manifest）。\n`);
    return 0;
  }

  let failures = 0;
  for (const { id, file } of existing) {
    console.log(pc.bold(`■ ${id}  ${pc.dim(TARGET_LABELS[id])}`));
    try {
      const r = await restoreManifest(file, { toolHome: home, force: opts.force });
      console.log(`  ${sym.dot} 安裝路徑：${r.installRoot}`);
      for (const f of r.files) {
        const icon = f.action === 'restored' ? sym.ok : f.action === 'skipped' ? sym.dot : sym.fail;
        console.log(`  ${icon} ${f.path}${f.reason ? pc.dim(`（${f.reason}）`) : ''}`);
      }
      if (r.status === 'blocked') {
        failures++;
        console.log(`  ${sym.fail} ${pc.red('還原中止，未修改任何檔案')}\n`);
      } else {
        console.log(`  ${sym.ok} ${pc.green(r.status === 'restored' ? '已校驗 SHA-256 並還原完成' : '檔案已是原始版本，已清除套用紀錄')}\n`);
      }
    } catch (e) {
      failures++;
      console.log(`  ${sym.fail} ${pc.red((e as Error).message)}\n`);
    }
  }
  return failures > 0 ? 1 : 0;
}
