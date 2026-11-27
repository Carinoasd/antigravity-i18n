#!/usr/bin/env node
import { Argument, Command, Option } from 'commander';
import pc from 'picocolors';
import { applyCommand } from './commands/apply.js';
import {
  bgClearCommand,
  bgPresetCommand,
  bgPresetsCommand,
  bgSetCommand,
  bgStatusCommand,
  bgToggleCommand,
} from './commands/bg.js';
import { CliError } from './commands/common.js';
import { launchCommand } from './commands/launch.js';
import { restoreCommand } from './commands/restore.js';
import { rulesCommand } from './commands/rules.js';
import { shortcutCommand } from './commands/shortcut.js';
import { statusCommand } from './commands/status.js';
import { launchInteractive, shouldLaunchUi, uiCommand } from './commands/ui.js';
import { validateCommand } from './commands/validate.js';
import { LocaleError, readToolVersion } from './core/locales.js';

const program = new Command();

const targetOption = (): Option =>
  new Option('-t, --target <target>', '目標：app | ide | cli | all').default('all');
const langOption = (): Option => new Option('-l, --lang <lang>', '語系：zh-TW | zh-CN | ja | ko');

program
  .name('antigravity-i18n')
  .description('Google Antigravity 繁體中文（zh-TW）／簡體中文（zh-CN）／日文（ja）／韓文（ko）多語系在地化與背景自訂工具')
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
  .addOption(new Option('-l, --lang <lang>', '語系：zh-TW | zh-CN | ja | ko | none（僅背景模式：只掛載背景與 Ctrl+Alt+B 面板，限 app）').makeOptionMandatory())
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
  $ antigravity-i18n apply --lang none --target app          # 維持英文，只要背景與 Ctrl+Alt+B 面板

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
  $ antigravity-i18n bg set /mnt/c/Users/me/Pictures/bg.webp --mode underlay --tint "rgba(0,0,0,0.25)"
  $ antigravity-i18n bg presets
  $ antigravity-i18n bg preset aurora --opacity 0.2
  $ antigravity-i18n bg preset midnight --tint "#00000040"
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
  .option('--tint <cssColor>', '可讀性遮罩顏色，例如 "rgba(0,0,0,0.25)"、"#00000040"；none 表示不套用')
  .action(async (imagePath: string, opts) => run(() => bgSetCommand(imagePath, opts)));
bg.command('preset <name>')
  .description('套用內建的純 CSS 漸層預設（不需圖片檔）')
  .option('--opacity <0.01-1>', '不透明度', '0.12')
  .option('--blur <px>', '模糊程度（像素）', '0')
  .option('--tint <cssColor>', '可讀性遮罩顏色；none 表示不套用')
  .addOption(new Option('--mode <mode>', 'overlay 或 underlay').choices(['overlay', 'underlay']).default('overlay'))
  .action(async (name: string, opts) => run(() => bgPresetCommand(name, opts)));
bg.command('presets').description('列出所有內建背景預設').action(async () => run(() => bgPresetsCommand()));
bg.command('status').description('顯示背景圖設定與狀態').action(async () => run(() => bgStatusCommand()));
bg.command('on').description('啟用背景圖').action(async () => run(() => bgToggleCommand(true)));
bg.command('off').description('暫時停用背景圖（保留設定）').action(async () => run(() => bgToggleCommand(false)));
bg.command('clear').description('清除背景圖設定檔').action(async () => run(() => bgClearCommand()));

program
  .command('launch')
  .description('智慧啟動 Antigravity App：偵測到官方自動更新覆蓋 app.asar 時先自動重新套用，再啟動並立即結束（不常駐）')
  .addOption(new Option('-l, --lang <lang>', '重新套用時使用的語系：zh-TW | zh-CN | ja | ko | none（預設沿用上次套用的語系）'))
  .option('-p, --path <customPath>', '手動指定 App 安裝路徑')
  .option('--no-reapply', '不檢查、不重新套用，只啟動 Antigravity')
  .addHelpText(
    'after',
    `
流程：
  1. 讀取上次套用的 manifest，比對目前 app.asar 的 SHA-256（以檔案大小與修改時間快取，未變更時毫秒級跳過）
  2. 雜湊不同（官方剛自動更新）或掛鉤為舊版 → 備份新版原始檔後自動重新套用
     Antigravity 已在執行而鎖住檔案時，只提示並略過本次重新套用，不影響啟動
  3. 以 detached 方式啟動 Antigravity，本工具立即結束（0 MB 常駐記憶體）

範例：
  $ antigravity-i18n launch
  $ antigravity-i18n launch --lang zh-CN
  $ antigravity-i18n launch --path "/Applications/Antigravity App.app" --no-reapply

建議搭配桌面捷徑使用：antigravity-i18n shortcut install`,
  )
  .action(async (opts) => run(() => launchCommand(opts)));

program
  .command('shortcut')
  .description('建立／移除指向 launch 的桌面捷徑（Windows .lnk、WSL、macOS .command、Linux .desktop）')
  .addArgument(new Argument('<action>', 'install | remove | status').choices(['install', 'remove', 'status']))
  .option('-n, --name <name>', '捷徑顯示名稱', 'Antigravity (i18n)')
  .addOption(new Option('-l, --lang <lang>', '捷徑啟動時重新套用的語系：zh-TW | zh-CN | ja | ko | none（預設沿用上次套用的語系）'))
  .option('-p, --path <customPath>', '手動指定 App 安裝路徑（同時傳給 launch）')
  .option('--dir <dir>', '捷徑所在目錄（預設為桌面；Linux 為 ~/.local/share/applications）')
  .option('-f, --force', '覆蓋或移除非本工具建立的同名檔案')
  .addHelpText(
    'after',
    `
範例：
  $ antigravity-i18n shortcut install
  $ antigravity-i18n shortcut install --name "Antigravity 中文版" --lang zh-TW
  $ antigravity-i18n shortcut status
  $ antigravity-i18n shortcut remove

各平台產物：
  Windows  桌面 .lnk（Antigravity 圖示、最小化執行避免黑窗閃爍）
  WSL      Windows 桌面 .lnk，透過 wsl.exe -d <發行版> 執行 launch（需偵測到 Windows 側 Antigravity）
  macOS    ~/Desktop/<名稱>.command
  Linux    ~/.local/share/applications/antigravity-i18n.desktop

捷徑只執行一次 launch，不安裝任何常駐程式；移除捷徑即完全移除。`,
  )
  .action(async (action: string, opts) => run(() => shortcutCommand(action, opts)));

program
  .command('ui')
  .description('開啟本機圖形控制台（只監聽 127.0.0.1）；不帶任何參數執行 antigravity-i18n 時也會自動開啟')
  .option('--port <n>', '監聽的埠號；0 表示自動挑選可用埠', '0')
  .option('--no-open', '不要自動開啟瀏覽器，只顯示網址')
  .action(async (opts) => run(() => uiCommand(opts)));

program
  .command('validate')
  .description('CI 用詞庫驗證：JSON 語法、空值、多語系 key 一致、佔位符與保護詞')
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

/** 不使用頂層 await：單檔執行檔以 CommonJS 打包 */
async function main(): Promise<void> {
  if (shouldLaunchUi(process.argv, process.env, Boolean(process.stdin.isTTY), Boolean(process.stdout.isTTY))) {
    // 直接執行 antigravity-i18n（npx 或雙擊單檔執行檔）：在互動式終端機中開啟圖形控制台；
    // 發生錯誤時印出訊息並等使用者按 Enter，避免視窗一閃而過
    process.exitCode = await launchInteractive();
  } else if (process.argv.length <= 2) {
    // 非互動環境（CI、管線）：維持顯示說明
    program.outputHelp();
  } else {
    await program.parseAsync(process.argv);
  }
}

main().catch((e: unknown) => {
  console.error(`${pc.red('✖')} ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
