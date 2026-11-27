import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
