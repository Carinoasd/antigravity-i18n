#!/usr/bin/env node
import { Argument, Command, Option } from 'commander';
import pc from 'picocolors';
import { applyCommand } from './commands/apply.js';
import { CliError } from './commands/common.js';
import { restoreCommand } from './commands/restore.js';
import { rulesCommand } from './commands/rules.js';
import { statusCommand } from './commands/status.js';
import { validateCommand } from './commands/validate.js';
import { LocaleError, readToolVersion } from './core/locales.js';

const program = new Command();

const targetOption = (): Option =>
  new Option('-t, --target <target>', '目標：app | ide | cli | all').default('all');
const langOption = (): Option => new Option('-l, --lang <lang>', '語系：zh-TW | zh-CN');

program
  .name('antigravity-i18n')
  .description('Google Antigravity 繁體中文（zh-TW）／簡體中文（zh-CN）中文化工具')
  .version(readToolVersion(), '-v, --version', '顯示版本')
  .helpOption('-h, --help', '顯示說明')
  .addHelpCommand('help [command]', '顯示指令說明')
  .showHelpAfterError('（加上 --help 查看用法）');

program
  .command('status')
  .alias('doctor')
  .description('掃描 app / ide / cli 安裝路徑、中文化狀態、備份與全域規則狀態')
  .addOption(targetOption())
  .option('-p, --path <customPath>', '手動指定安裝路徑（需搭配單一 --target）')
  .option('--home <customHome>', '自訂使用者家目錄（檢查全域規則用）')
  .action(async (opts) => run(() => statusCommand(opts)));

program
  .command('apply')
  .description('套用中文化（自動備份原始檔並寫入 manifest）')
  .addOption(langOption().makeOptionMandatory())
  .addOption(targetOption())
  .option('-p, --path <customPath>', '手動指定安裝路徑（需搭配單一 --target）')
  .option('--dry-run', '只預覽命中字串數與預計覆蓋率，不修改任何檔案')
  .option('-f, --force', '已套用過時仍強制重新套用（可用於切換語系）')
  .addHelpText(
    'after',
    `
範例：
  $ antigravity-i18n apply --lang zh-TW --dry-run
  $ antigravity-i18n apply --lang zh-TW --target ide
  $ antigravity-i18n apply --lang zh-CN --target app --path "/Applications/Antigravity App.app" --force`,
  )
  .action(async (opts) => run(() => applyCommand(opts)));

program
  .command('restore')
  .description('校驗備份 SHA-256 並一鍵無損還原')
  .addOption(targetOption())
  .option('-p, --path <customPath>', '手動指定安裝路徑（需搭配單一 --target）')
  .option('-f, --force', '即使檔案在套用後又被修改（例如官方更新）也強制還原')
  .action(async (opts) => run(() => restoreCommand(opts)));

program
  .command('rules')
  .description('零侵入模式：管理 ~/.gemini/config/rules 的中文回覆全域規則')
  .addArgument(new Argument('<action>', 'install | remove | status').choices(['install', 'remove', 'status']))
  .addOption(langOption())
  .option('--home <customHome>', '自訂使用者家目錄（預設為目前使用者家目錄）')
  .option('-f, --force', '覆蓋或移除非本工具建立的規則檔')
  .addHelpText(
    'after',
    `
範例：
  $ antigravity-i18n rules install --lang zh-TW
  $ antigravity-i18n rules status
  $ antigravity-i18n rules remove`,
  )
  .action(async (action: string, opts) => run(() => rulesCommand(action, opts)));

program
  .command('validate')
  .description('CI 用詞庫驗證：JSON 語法、空值、zh-TW/zh-CN key 一致、佔位符與保護詞')
  .option('-d, --dir <dir>', '詞庫目錄（預設為套件內建 locales/）')
  .action(async (opts) => run(() => validateCommand(opts)));

async function run(fn: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await fn();
  } catch (e) {
    if (e instanceof CliError || e instanceof LocaleError) {
      console.error(`${pc.red('✖')} ${e.message}${e instanceof LocaleError ? pc.dim(`（${e.file}）`) : ''}`);
    } else {
      console.error(`${pc.red('✖')} ${(e as Error).message}`);
      if (process.env.DEBUG) console.error(e);
    }
    process.exitCode = 1;
  }
}

await program.parseAsync(process.argv);
