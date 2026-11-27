import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as asar from '@electron/asar';

export function tmpDir(prefix = 'agi18n-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function write(file: string, content: string | Buffer): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

export function rm(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * 建立 asar fixture，並等到檔案完全寫入磁碟才回傳。
 *
 * `@electron/asar` 的 createPackageWithOptions() 在內部以 `return out.end()` 結束：
 * promise resolve 時寫入串流可能尚未 flush。直接拿來當 fixture，在 CPU 忙碌時
 * 偶爾會讀到半寫入的檔案（讀出 NUL 位元組，或備份校驗失敗）。
 */
export async function packAsar(src: string, dest: string, options: Parameters<typeof asar.createPackageWithOptions>[2] = {}): Promise<void> {
  const ws = (await asar.createPackageWithOptions(src, dest, options)) as NodeJS.WritableStream & { closed?: boolean };
  if (ws.closed) return;
  await new Promise<void>((resolve, reject) => {
    ws.once('close', () => resolve());
    ws.once('error', reject);
  });
}
