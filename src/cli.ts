#!/usr/bin/env node
import { Argument, Command, Option } from 'commander';
import pc from 'picocolors';
import { applyCommand } from './commands/apply.js';
import { bgClearCommand, bgSetCommand, bgStatusCommand, bgToggleCommand } from './commands/bg.js';
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
  .option('--no-runtime', 'app 目標：停用執行期 DOM 注入層，只套用靜態字串替換')
  .addHelpText(
    'after',
    `
範例：
  $ antigravity-i18n apply --lang zh-TW --dry-run
  $ antigravity-i18n apply --lang zh-TW --target ide
  $ antigravity-i18n apply --lang zh-CN --target app --path "/Applications/Antigravity App.app" --force
  $ antigravity-i18n apply --lang zh-TW --target app --no-runtime

app 目標採雙層機制：
  靜態層      翻譯 app.asar 內主行程的原生選單、系統匣、更新提示與載入畫面
  執行期注入層 將詞庫與 runtime 寫入 app.asar，視窗載入後即時翻譯 UI（排除程式碼、
              編輯器、終端機、輸入框與 AI 回覆正文）；可用 --no-runtime 停用`,
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

const bg = program
  .command('bg')
  .alias('background')
  .description('自訂 Antigravity App 背景圖（換圖不需重新套用 app.asar）')
  .addHelpText(
    'after',
    `
範例：
  $ antigravity-i18n bg set ~/Pictures/wallpaper.jpg
  $ antigravity-i18n bg set ./bg.png --opacity 0.2 --blur 4 --size contain --position "top right"
  $ antigravity-i18n bg set /mnt/c/Users/me/Pictures/bg.webp --mode underlay
  $ antigravity-i18n bg off
  $ antigravity-i18n bg status

背景圖由 App 主行程掛鉤載入，需先執行一次 apply --target app（預設啟用執行期注入層）。`,
  );

bg.command('set <imagePath>')
  .description('設定背景圖（.png / .jpg / .jpeg / .webp / .gif，上限 10 MB）')
  .option('--opacity <0.01-1>', '不透明度', '0.12')
  .option('--blur <px>', '模糊程度（像素）', '0')
  .addOption(new Option('--size <size>', '背景尺寸').choices(['cover', 'contain', 'auto']).default('cover'))
  .option('--position <cssPosition>', 'CSS background-position，例如 center、top right、50% 20%', 'center')
  .addOption(new Option('--mode <mode>', 'overlay：覆蓋在介面上（不擋點擊）；underlay：放在介面底層').choices(['overlay', 'underlay']).default('overlay'))
  .action(async (imagePath: string, opts) => run(() => bgSetCommand(imagePath, opts)));
bg.command('status').description('顯示背景圖設定與狀態').action(async () => run(() => bgStatusCommand()));
bg.command('on').description('啟用背景圖').action(async () => run(() => bgToggleCommand(true)));
bg.command('off').description('暫時停用背景圖（保留設定）').action(async () => run(() => bgToggleCommand(false)));
bg.command('clear').description('清除背景圖設定檔').action(async () => run(() => bgClearCommand()));

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
