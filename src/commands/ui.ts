import { spawn } from 'node:child_process';
import os from 'node:os';
import pc from 'picocolors';
import { isWsl } from '../config/paths.js';
import { readToolVersion } from '../core/locales.js';
import { startUiServer } from '../ui/server.js';
import { CliError, getToolHome, sym } from './common.js';

export interface UiCommandOptions {
  port?: string;
  /** commander 的 --no-open 會設為 false */
  open?: boolean;
}

export function parsePort(input: string | undefined): number {
  if (input === undefined) return 0;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new CliError(`--port 必須是 0 ~ 65535 的整數（收到「${input}」）`);
  return n;
}

/**
 * 不帶任何參數執行 `antigravity-i18n` 時，是否直接開啟圖形控制台。
 * 只在互動式終端機中啟動；CI 或非 TTY（例如被其他程式呼叫、輸出導向檔案）時維持顯示 --help。
 */
export function shouldLaunchUi(argv: string[], env: NodeJS.ProcessEnv, stdinTTY: boolean, stdoutTTY: boolean): boolean {
  if (argv.slice(2).length > 0) return false;
  const ci = env.CI;
  if (ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false') return false;
  return stdinTTY && stdoutTTY;
}

type Spawner = (cmd: string, args: string[]) => { on(event: 'error', fn: (e: Error) => void): unknown; unref(): void };

const defaultSpawner: Spawner = (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });

export interface OpenBrowserOptions {
  platform?: NodeJS.Platform;
  /**
   * 是否在 WSL 中執行；未指定時自動偵測（會讀取 /proc/version）。
   * 測試請明確指定，避免在真實 WSL 環境中得到不同結果。
   */
  wsl?: boolean;
  spawner?: Spawner;
}

/** 以系統預設瀏覽器開啟網址；失敗時回傳 false（呼叫端改為顯示網址） */
export function openBrowser(url: string, opts: OpenBrowserOptions = {}): boolean {
  const platform = opts.platform ?? process.platform;
  const wsl = opts.wsl ?? isWsl(process.env, platform);
  const spawner = opts.spawner ?? defaultSpawner;
  let cmd: string;
  let args: string[];
  if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'linux' && wsl) {
    // WSL：用 Windows 的預設瀏覽器開啟（127.0.0.1 在 WSL2 會自動轉送）
    cmd = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawner(cmd, args);
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * 印出提示並等使用者按 Enter（只在互動式終端機中等待）。
 * 用於單檔執行檔被雙擊開啟時：發生錯誤後若直接結束，Windows 的主控台視窗會一閃而過。
 */
export function waitForEnter(
  prompt = '按 Enter 鍵結束…',
  input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  if (!input.isTTY) return Promise.resolve();
  output.write(`\n${prompt}`);
  return new Promise((resolve) => {
    const done = (): void => {
      input.off('data', onData);
      input.off('end', done);
      (input as { pause?: () => void }).pause?.();
      resolve();
    };
    const onData = (chunk: Buffer | string): void => {
      if (String(chunk).includes('\n') || String(chunk).includes('\r')) done();
    };
    input.on('data', onData);
    input.once('end', done);
    (input as { resume?: () => void }).resume?.();
  });
}

/**
 * 不帶參數、在互動式終端機中啟動（例如雙擊單檔執行檔）時開啟控制台。
 * 任何未預期的錯誤都印出清楚的訊息，並等使用者按 Enter 才結束。
 */
export async function launchInteractive(
  start: () => Promise<number> = () => uiCommand({}),
  wait: (prompt?: string) => Promise<void> = waitForEnter,
): Promise<number> {
  try {
    return await start();
  } catch (e) {
    console.error(`\n${sym.fail} 無法啟動 Antigravity 中文化控制台：${e instanceof Error ? e.message : String(e)}`);
    if (process.env.DEBUG && e instanceof Error && e.stack) console.error(e.stack);
    console.error(pc.dim('  若問題持續發生，請到 https://github.com/Carinoasd/antigravity-i18n/issues 回報，並附上這段訊息。'));
    await wait();
    return 1;
  }
}

export async function uiCommand(opts: UiCommandOptions = {}): Promise<number> {
  const port = parsePort(opts.port);
  const srv = await startUiServer({ port, toolHome: getToolHome(), userHome: os.homedir(), toolVersion: readToolVersion() });
  console.log(pc.bold('\nAntigravity 中文化控制台\n'));
  console.log(`${sym.ok} 已在本機啟動：${pc.cyan(srv.url)}`);
  console.log(pc.dim('  只監聽 127.0.0.1，且每次啟動都會產生新的存取 Token；其他電腦無法連線。'));
  if (opts.open !== false && openBrowser(srv.url)) {
    console.log(`${sym.dot} 已嘗試以預設瀏覽器開啟；若沒有自動開啟，請手動複製上面的網址。`);
  }
  console.log(pc.dim('  按 Ctrl+C，或在網頁上按「關閉控制台」即可結束。\n'));

  const onSignal = (): void => void srv.close();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  await srv.closed;
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  console.log(`${sym.ok} 控制台已關閉`);
  return 0;
}
