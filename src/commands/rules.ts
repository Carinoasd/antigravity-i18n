import pc from 'picocolors';
import { installRules, removeRules, rulesStatus } from '../core/rules.js';
import { CliError, parseLang, sym, userHome } from './common.js';

export interface RulesOptions {
  lang?: string;
  home?: string;
  force?: boolean;
}

export async function rulesCommand(action: string, opts: RulesOptions): Promise<number> {
  const home = userHome(opts.home);
  switch (action) {
    case 'install': {
      const lang = parseLang(opts.lang ?? 'zh-TW')!;
      const r = installRules(home, lang, { force: opts.force });
      const verb = { created: '已建立', updated: '已更新', unchanged: '已是最新版本' }[r.action];
      console.log(`${sym.ok} ${verb}全域規則（${lang}）：${r.path}`);
      for (const p of r.removedOther) console.log(`${sym.dot} 已移除另一語系的規則以避免衝突：${pc.dim(p)}`);
      console.log(pc.dim('  重新開啟 Antigravity 對話後生效；此模式不會修改任何安裝檔。'));
      return 0;
    }
    case 'remove': {
      const lang = parseLang(opts.lang, false);
      const r = removeRules(home, lang, { force: opts.force });
      for (const p of r.removed) console.log(`${sym.ok} 已移除：${p}`);
      for (const s of r.skipped) console.log(`${sym.warn} 略過 ${s.path}：${s.reason}`);
      if (r.removed.length === 0 && r.skipped.length === 0) console.log(`${sym.info} 沒有需要移除的規則檔`);
      return r.skipped.length > 0 ? 1 : 0;
    }
    case 'status': {
      for (const r of rulesStatus(home)) {
        if (!r.exists) {
          console.log(`${sym.dot} ${r.lang}：${pc.dim('未安裝')}  ${pc.dim(r.path)}`);
          continue;
        }
        const tag = r.managed ? (r.upToDate ? pc.green('已安裝（最新）') : pc.yellow('已安裝（可更新，請重新 install）')) : pc.yellow('已存在（非本工具建立）');
        console.log(`${sym.ok} ${r.lang}：${tag}  trigger=${r.trigger ?? '?'}  ${pc.dim(r.path)}`);
      }
      return 0;
    }
    default:
      throw new CliError(`未知的動作「${action}」，可用值：install、remove、status`);
  }
}
