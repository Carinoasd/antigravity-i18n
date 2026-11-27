import path from 'node:path';
import pc from 'picocolors';
import { defaultLocalesDir, validateLocales } from '../core/locales.js';
import { LANGS } from '../types.js';
import { sym } from './common.js';

export interface ValidateOptions {
  dir?: string;
}

export async function validateCommand(opts: ValidateOptions = {}): Promise<number> {
  const dir = opts.dir ? path.resolve(opts.dir) : defaultLocalesDir();
  const report = validateLocales(dir);
  const errors = report.issues.filter((i) => i.level === 'error');
  const warnings = report.issues.filter((i) => i.level === 'warning');

  console.log(pc.bold('\n詞庫驗證'));
  console.log(`${sym.dot} 詞庫目錄：${pc.dim(dir)}`);
  const counts = LANGS.map((l) => `${l}：${report.keyCount[l]} 條`).join('　');
  console.log(`${sym.dot} 模組數：${report.moduleCount}　${counts}\n`);

  for (const i of errors) console.log(`${sym.fail} ${pc.red(i.file)}${i.key ? pc.dim(` 「${i.key}」`) : ''}：${i.message}`);
  for (const i of warnings) console.log(`${sym.warn} ${pc.yellow(i.file)}${i.key ? pc.dim(` 「${i.key}」`) : ''}：${i.message}`);

  if (report.ok) {
    console.log(`\n${sym.ok} ${pc.green('驗證通過')}（${warnings.length} 個警告）\n`);
    return 0;
  }
  console.log(`\n${sym.fail} ${pc.red(`驗證失敗：${errors.length} 個錯誤`)}\n`);
  return 1;
}
