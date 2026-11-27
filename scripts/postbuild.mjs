// 確保編譯後的 CLI 入口具有可執行權限（Windows 上 chmod 為 no-op）。
import { chmodSync, existsSync, readFileSync } from 'node:fs';

const entry = new URL('../dist/cli.js', import.meta.url);
if (!existsSync(entry)) {
  console.error('postbuild: dist/cli.js 不存在');
  process.exit(1);
}
const head = readFileSync(entry, 'utf8').slice(0, 32);
if (!head.startsWith('#!/usr/bin/env node')) {
  console.error('postbuild: dist/cli.js 缺少 shebang');
  process.exit(1);
}
chmodSync(entry, 0o755);
