#!/usr/bin/env node
/**
 * 打包單檔執行檔（Node.js SEA — Single Executable Application）。
 *
 *   node scripts/build-sea.mjs                 # 打包 dist-sea/antigravity-i18n-<平台>-<架構>[.exe]
 *   node scripts/build-sea.mjs --bundle-only   # 只產生 esbuild bundle（測試用，不需要 SEA）
 *   node scripts/build-sea.mjs --out <dir>
 *
 * 步驟（依 Node.js 官方 SEA 文件）：
 *   1. esbuild 把 src/cli.ts 打包成單一 CommonJS 檔，並以 define 內嵌 locales/ 與版本號
 *   2. node --experimental-sea-config 產生 blob
 *   3. 複製目前的 node 執行檔，以 postject 注入 blob
 *   4. macOS：注入前移除原簽章，注入後以 ad-hoc 簽章（codesign --sign -）
 *
 * ⚠️ 不可開啟 esbuild 的 keepNames：它會在函式內插入 __name() helper，
 *    讓 src/runtime/ 以 toString() 序列化的注入腳本不再自足。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const bundleOnly = args.includes('--bundle-only');
const outDir = path.resolve(root, opt('--out', 'dist-sea'));

/** SEA 的 sentinel fuse（Node.js 官方文件固定值） */
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const PLATFORM_LABEL = { win32: 'win', darwin: 'macos', linux: 'linux' };

export function executableName(platform = process.platform, arch = process.arch) {
  const label = PLATFORM_LABEL[platform] ?? platform;
  return `antigravity-i18n-${label}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}

/** 收集 locales/ 下所有 JSON（相對路徑以 / 分隔） */
function collectLocales(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json')) {
        const key = path.relative(dir, full).split(path.sep).join('/');
        out[key] = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, ''));
      }
    }
  };
  walk(dir);
  return out;
}

const log = (msg) => console.log(`[build-sea] ${msg}`);

async function bundle() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const locales = collectLocales(path.join(root, 'locales'));
  const embedded = { version: pkg.version, locales };
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, 'antigravity-i18n.cjs');
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'cli.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // 讓 bundle 本身在 Node 20 也能執行（SEA 執行檔則內含打包時的 Node 22）
    target: 'node20',
    minify: false,
    keepNames: false,
    legalComments: 'none',
    logLevel: 'warning',
    // @electron/asar 只在 Electron 中才會 require 這兩個模組
    external: ['original-fs', 'electron'],
    define: {
      __AGI18N_EMBEDDED__: JSON.stringify(embedded),
      'import.meta.url': '__agi18nImportMetaUrl',
    },
    banner: { js: 'const __agi18nImportMetaUrl = require("url").pathToFileURL(__filename).href;' },
  });
  log(`bundle：${path.relative(root, outfile)}（${(fs.statSync(outfile).size / 1024).toFixed(0)} KB，內嵌 ${Object.keys(locales).length} 個詞庫檔，v${pkg.version}）`);
  return outfile;
}

function run(cmd, cmdArgs) {
  execFileSync(cmd, cmdArgs, { stdio: 'inherit' });
}

async function buildExecutable(bundleFile) {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) throw new Error(`SEA 需要 Node.js 20 以上（目前 ${process.version}）；發布用執行檔請以 Node.js 22 打包`);
  const blob = path.join(outDir, 'sea-prep.blob');
  const config = path.join(outDir, 'sea-config.json');
  fs.writeFileSync(
    config,
    JSON.stringify({ main: bundleFile, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }, null, 2),
  );
  run(process.execPath, ['--experimental-sea-config', config]);

  const exe = path.join(outDir, executableName());
  fs.rmSync(exe, { force: true });
  fs.copyFileSync(process.execPath, exe);
  fs.chmodSync(exe, 0o755);
  if (process.platform === 'darwin') run('codesign', ['--remove-signature', exe]);

  const postject = require.resolve('postject/dist/cli.js');
  const injectArgs = [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SEA_FUSE];
  if (process.platform === 'darwin') injectArgs.push('--macho-segment-name', 'NODE_SEA');
  run(process.execPath, injectArgs);

  if (process.platform === 'darwin') run('codesign', ['--sign', '-', exe]);
  fs.rmSync(blob, { force: true });
  fs.rmSync(config, { force: true });
  log(`執行檔：${path.relative(root, exe)}（${(fs.statSync(exe).size / 1024 / 1024).toFixed(1)} MB，Node ${process.version}）`);
  return exe;
}

const bundleFile = await bundle();
if (!bundleOnly) await buildExecutable(bundleFile);
