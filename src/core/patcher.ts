import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApplyLang, DetectedTarget, Dictionary, Manifest, ManifestFile, ManifestFileRole, TargetId, TranslateStats } from '../types.js';
import { electronAsarArchiver, type AsarArchiver, type AsarWriteEntry } from './asar.js';
import {
  atomicCopy,
  atomicWrite,
  backupFile,
  manifestPathFor,
  newBackupDir,
  readManifest,
  removeBackupDir,
  restoreFromBackup,
  sha256,
  sha256File,
  verifyBackup,
  writeManifest,
} from './backup.js';
import {
  HOOK_VERSION,
  RUNTIME_FILE_NAME,
  buildRuntimeScript,
  countRuntimeEntries,
  detectModuleFormat,
  hasHook,
  injectHook,
  parsePackageJson,
  resolveMainEntry,
  runtimeEntryPath,
  type RuntimeLayerInfo,
} from './runtime.js';
import { Translator, emptyStats, mergeHits } from './translator.js';

/** asar 內會被翻譯的副檔名 */
export const CONTENT_EXTS = ['.js', '.mjs', '.cjs', '.json', '.html', '.htm'];

export interface PatchContext {
  /** none：僅背景模式（只適用於 asar 目標，dict 應為空物件） */
  lang: ApplyLang;
  dict: Dictionary;
  /** 工具資料目錄（存放 manifests / backups） */
  toolHome: string;
  dryRun?: boolean;
  force?: boolean;
  archiver?: AsarArchiver;
  toolVersion?: string;
  now?: Date;
  /** asar 目標是否啟用執行期 DOM 注入層（預設 true） */
  runtime?: boolean;
}

export type ApplyStatus = 'applied' | 'dry-run' | 'already-applied' | 'unsupported' | 'no-match';

export interface ApplyResult {
  target: TargetId;
  installRoot: string;
  status: ApplyStatus;
  lang: ApplyLang;
  previousLang?: ApplyLang;
  stats: TranslateStats;
  files: { path: string; hits: number; role: ManifestFileRole }[];
  warnings: string[];
  manifestPath: string;
  /** asar 目標：執行期注入層資訊 */
  runtime?: RuntimeLayerInfo;
  /** asar 目標：封存檔內會被修改或新增的檔案 */
  asarEntries?: AsarEntryChange[];
}

export interface AsarEntryChange {
  path: string;
  /** static：靜態字串替換；hook：注入主行程掛鉤；runtime：新增的 runtime 檔案 */
  kind: 'static' | 'hook' | 'runtime';
  hits: number;
}

export type FileState = 'original' | 'patched' | 'changed' | 'missing';

interface SourceInfo {
  /** 原始（未中文化）內容所在檔案：目前檔案或備份檔 */
  from: string;
  sha256: string;
  state: FileState;
}

interface PlannedWrite {
  path: string;
  role: ManifestFileRole;
  source: SourceInfo;
  hits: number;
  data?: Buffer;
  /** 大型檔案（asar）改以暫存檔提供內容 */
  fromFile?: string;
}

function isAsarContent(p: string): boolean {
  const parts = p.split('/');
  // 第三方套件與測試用的 mock（例如 dist/__mocks__/electron.js）不翻譯
  if (parts.includes('node_modules') || parts.includes('__mocks__')) return false;
  if (path.posix.basename(p) === 'package.json') return false;
  return CONTENT_EXTS.includes(path.posix.extname(p).toLowerCase());
}

/** VS Code product.json checksums 使用的格式：base64(sha256) 去除尾端 = */
export function vscodeChecksum(data: Buffer): string {
  return Buffer.from(sha256(data), 'hex').toString('base64').replace(/=+$/, '');
}

async function resolveSource(p: string, mf: ManifestFile | undefined, warnings: string[]): Promise<SourceInfo | null> {
  if (!fs.existsSync(p)) {
    if (mf) warnings.push(`找不到先前修補過的檔案：${p}`);
    return null;
  }
  const current = await sha256File(p);
  if (!mf) return { from: p, sha256: current, state: 'original' };
  if (current === mf.patchedSha256) {
    const v = await verifyBackup(mf.backupPath, mf.originalSha256);
    if (!v.ok) {
      throw new Error(`${p} 目前為已中文化狀態，但備份不可用（${v.reason}）。請重新安裝 Antigravity 後再套用。`);
    }
    return { from: mf.backupPath, sha256: mf.originalSha256, state: 'patched' };
  }
  if (current === mf.originalSha256) return { from: p, sha256: current, state: 'original' };
  warnings.push(`偵測到 ${path.basename(p)} 的 SHA-256 已改變（可能是官方版本更新），將以目前版本作為新的原始檔重新備份。`);
  return { from: p, sha256: current, state: 'changed' };
}

function trackedPaths(t: DetectedTarget): { path: string; role: ManifestFileRole }[] {
  const out: { path: string; role: ManifestFileRole }[] = t.files.map((p) => ({ path: p, role: 'content' as const }));
  if (t.productJson) out.push({ path: t.productJson, role: 'checksum' });
  if (t.infoPlist) out.push({ path: t.infoPlist, role: 'integrity' });
  return out;
}

/** 套用中文化（或 dry-run 預覽） */
export async function applyTarget(t: DetectedTarget, ctx: PatchContext): Promise<ApplyResult> {
  const archiver = ctx.archiver ?? electronAsarArchiver;
  const manifestPath = manifestPathFor(ctx.toolHome, t);
  const warnings: string[] = [];
  const stats = emptyStats(Object.keys(ctx.dict).length);
  const base: ApplyResult = {
    target: t.id,
    installRoot: t.installRoot,
    status: 'unsupported',
    lang: ctx.lang,
    stats,
    files: [],
    warnings,
    manifestPath,
  };
  if (!t.supported) {
    if (t.reason) warnings.push(t.reason);
    return base;
  }
  const backgroundOnly = ctx.lang === 'none';
  if (backgroundOnly && t.kind !== 'asar') {
    warnings.push('僅背景模式（--lang none）只適用於 app 目標');
    return base;
  }
  if (backgroundOnly && ctx.runtime === false) {
    throw new Error('僅背景模式（--lang none）需要主行程掛鉤，不能與 --no-runtime 一起使用');
  }

  const existing = readManifest(manifestPath);
  const sources = new Map<string, SourceInfo>();
  for (const { path: p } of trackedPaths(t)) {
    const mf = existing?.files.find((f) => f.path === p);
    const src = await resolveSource(p, mf, warnings);
    if (src) sources.set(p, src);
  }
  // manifest 中有、但這次偵測不到的檔案也要納入（避免遺留已修補內容）
  for (const mf of existing?.files ?? []) {
    if (sources.has(mf.path)) continue;
    const src = await resolveSource(mf.path, mf, warnings);
    if (src) sources.set(mf.path, src);
  }

  const previouslyPatched = existing ? existing.files.filter((f) => sources.get(f.path)?.state === 'patched') : [];
  const fullyApplied = existing !== null && existing.files.length > 0 && previouslyPatched.length === existing.files.length;
  if (fullyApplied && !ctx.force) {
    return { ...base, status: 'already-applied', previousLang: existing.lang };
  }

  const translator = new Translator(ctx.dict);
  const planned: PlannedWrite[] = [];
  let tmpDir: string | null = null;

  try {
    if (t.kind === 'files') {
      for (const p of t.files) {
        const src = sources.get(p);
        if (!src) continue;
        const text = fs.readFileSync(src.from, 'utf8');
        const r = translator.translate(text, { filename: p });
        mergeHits(stats, r.hits);
        if (r.changed) planned.push({ path: p, role: 'content', source: src, hits: r.totalHits, data: Buffer.from(r.output, 'utf8') });
      }
    } else {
      const asarPath = t.files[0];
      const src = asarPath ? sources.get(asarPath) : undefined;
      if (!asarPath || !src) throw new Error('找不到 app.asar');
      const unpackedDir = `${asarPath}.unpacked`;
      const entries = archiver.list(src.from);
      const translated = new Map<string, Buffer>();
      const changes: AsarEntryChange[] = [];
      let asarHits = 0;
      // ── 靜態層：翻譯主行程原生選單、系統匣、更新提示、載入畫面等靜態字串 ──
      for (const e of entries) {
        // 僅背景模式不做任何靜態翻譯
        if (backgroundOnly) break;
        if (e.type !== 'file' || e.unpacked || !isAsarContent(e.path)) continue;
        const text = archiver.readFile(src.from, e.path).toString('utf8');
        const r = translator.translate(text, { filename: e.path });
        mergeHits(stats, r.hits);
        if (r.changed) {
          translated.set(e.path, Buffer.from(r.output, 'utf8'));
          changes.push({ path: e.path, kind: 'static', hits: r.totalHits });
          asarHits += r.totalHits;
        }
      }

      // ── 執行期注入層：寫入 runtime 並在主行程入口掛鉤 ──
      const writeList = [...entries];
      const counts = countRuntimeEntries(ctx.dict);
      let runtime: RuntimeLayerInfo = { enabled: false, ...counts };
      if (ctx.runtime === false) {
        runtime.reason = '已以 --no-runtime 停用';
      } else {
        const fileSet = new Set(entries.filter((e) => e.type === 'file' && !e.unpacked).map((e) => e.path));
        const pkg = fileSet.has('package.json') ? parsePackageJson(archiver.readFile(src.from, 'package.json').toString('utf8')) : null;
        const main = resolveMainEntry(pkg, fileSet);
        if (!main) {
          runtime.reason = '找不到 package.json 的 main 入口，僅套用靜態層';
          warnings.push(`app.asar：${runtime.reason}`);
        } else {
          const format = detectModuleFormat(main, pkg);
          const runtimeFile = runtimeEntryPath(main);
          const original = (translated.get(main) ?? archiver.readFile(src.from, main)).toString('utf8');
          if (hasHook(original)) warnings.push(`${main} 已含舊的 antigravity-i18n 注入標記，已移除後重新注入。`);
          translated.set(main, Buffer.from(injectHook(original, format, RUNTIME_FILE_NAME, { translate: !backgroundOnly }), 'utf8'));
          const staticChange = changes.find((c) => c.path === main);
          if (staticChange) staticChange.kind = 'hook';
          else changes.push({ path: main, kind: 'hook', hits: 0 });

          if (backgroundOnly) {
            // 僅背景模式：不寫入翻譯 runtime，只靠掛鉤載入背景與介面面板
            runtime = { enabled: true, entries: 0, patternEntries: 0, mainEntry: main, format, translation: false };
          } else {
            translated.set(runtimeFile, Buffer.from(buildRuntimeScript(ctx.dict, { lang: ctx.lang, version: ctx.toolVersion ?? '0.0.0' }), 'utf8'));
            changes.push({ path: runtimeFile, kind: 'runtime', hits: 0 });
            if (!fileSet.has(runtimeFile)) {
              const at = writeList.findIndex((e) => e.path === main);
              writeList.splice(at + 1, 0, { path: runtimeFile, type: 'file', unpacked: false });
            }
            runtime = { enabled: true, ...counts, mainEntry: main, runtimeFile, format, translation: true };
          }
        }
      }
      base.runtime = runtime;
      base.asarEntries = changes;
      if (process.platform === 'win32' || asarPath.startsWith('/mnt/')) {
        warnings.push('Windows 版 Electron 可能啟用 asar 完整性檢查；若套用後 App 無法啟動，請執行 restore 還原。');
      }

      if (translated.size > 0) {
        // dry-run 只列出預計修改的檔案，不建立暫存 asar
        let tmpAsar: string | undefined;
        if (!ctx.dryRun) {
          tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-i18n-'));
          tmpAsar = path.join(tmpDir, 'app.asar');
          const writeEntries: AsarWriteEntry[] = writeList.map((e) => {
            if (e.type !== 'file') return e;
            const data = translated.get(e.path);
            if (data) return { ...e, read: () => data };
            if (e.unpacked) return { ...e, read: () => fs.readFileSync(path.join(unpackedDir, ...e.path.split('/'))) };
            return { ...e, read: () => archiver.readFile(src.from, e.path) };
          });
          await archiver.write(tmpAsar, writeEntries);
        }
        planned.push({ path: asarPath, role: 'content', source: src, hits: asarHits, fromFile: tmpAsar });

        if (t.infoPlist && sources.has(t.infoPlist)) {
          const plistSrc = sources.get(t.infoPlist)!;
          const plist = fs.readFileSync(plistSrc.from);
          if (plist.subarray(0, 6).toString('latin1') === 'bplist') {
            warnings.push('Info.plist 為二進位格式，無法自動更新 ElectronAsarIntegrity；若 App 無法啟動請執行 restore。');
          } else {
            const text = plist.toString('utf8');
            const re = /(<key>Resources\/app\.asar<\/key>\s*<dict>[\s\S]*?<key>hash<\/key>\s*<string>)([0-9a-fA-F]+)(<\/string>)/;
            if (re.test(text)) {
              if (!tmpAsar) {
                planned.push({ path: t.infoPlist, role: 'integrity', source: plistSrc, hits: 0 });
              } else {
                const next = text.replace(re, `$1${archiver.headerHash(tmpAsar)}$3`);
                if (next !== text) planned.push({ path: t.infoPlist, role: 'integrity', source: plistSrc, hits: 0, data: Buffer.from(next, 'utf8') });
              }
            }
          }
        }
      }
    }

    // VS Code 系列：同步 product.json 的 checksums，避免「安裝似乎已損毀」提示
    if (t.productJson && t.checksumBase && sources.has(t.productJson) && planned.length > 0) {
      const pjSrc = sources.get(t.productJson)!;
      const raw = fs.readFileSync(pjSrc.from, 'utf8');
      try {
        const pj = JSON.parse(raw.replace(/^﻿/, '')) as { checksums?: Record<string, string> };
        if (pj.checksums) {
          let touched = false;
          for (const w of planned) {
            if (!w.data) continue;
            const rel = path.relative(t.checksumBase, w.path).split(path.sep).join('/');
            if (rel in pj.checksums) {
              pj.checksums[rel] = vscodeChecksum(w.data);
              touched = true;
            }
          }
          if (touched) {
            const indent = raw.match(/^\{\r?\n([ \t]+)/)?.[1] ?? '\t';
            const out = JSON.stringify(pj, null, indent) + (raw.endsWith('\n') ? '\n' : '');
            planned.push({ path: t.productJson, role: 'checksum', source: pjSrc, hits: 0, data: Buffer.from(out, 'utf8') });
          }
        }
      } catch {
        warnings.push('product.json 無法解析，略過 checksums 更新（IDE 可能顯示「安裝已損毀」提示，可忽略）。');
      }
    }

    base.files = planned.map((w) => ({ path: w.path, hits: w.hits, role: w.role }));

    if (ctx.dryRun) return { ...base, status: 'dry-run' };

    if (planned.length === 0) {
      warnings.push('詞庫沒有命中任何字串，未修改任何檔案。');
      return { ...base, status: 'no-match' };
    }

    // ── 正式寫入 ─────────────────────────────────────────────
    const backupDir = newBackupDir(ctx.toolHome, t, ctx.now ?? new Date());
    const records: ManifestFile[] = [];
    for (const [i, w] of planned.entries()) {
      const b = await backupFile(backupDir, i, w.path, w.source.from, w.source.sha256);
      records.push({
        path: w.path,
        role: w.role,
        originalSha256: w.source.sha256,
        patchedSha256: '',
        backupPath: b.backupPath,
        hits: w.hits,
      });
    }

    const written: number[] = [];
    try {
      for (const [i, w] of planned.entries()) {
        if (w.fromFile) {
          archiver.release(w.path);
          atomicCopy(w.fromFile, w.path);
        } else {
          atomicWrite(w.path, w.data!);
        }
        written.push(i);
        records[i]!.patchedSha256 = await sha256File(w.path);
      }
      // 先前修補過、但這次不再需要修改的檔案：還原成原始內容
      for (const mf of existing?.files ?? []) {
        const src = sources.get(mf.path);
        if (src?.state === 'patched' && !planned.some((w) => w.path === mf.path)) {
          await restoreFromBackup(mf.backupPath, mf.path, mf.originalSha256);
        }
      }
    } catch (e) {
      // 寫入失敗：回滾已寫入的檔案
      for (const i of written.reverse()) {
        const r = records[i]!;
        try {
          await restoreFromBackup(r.backupPath, r.path, r.originalSha256);
        } catch {
          /* 盡力而為 */
        }
      }
      removeBackupDir(ctx.toolHome, backupDir);
      throw e;
    }

    const manifest: Manifest = {
      schemaVersion: 1,
      tool: 'antigravity-i18n',
      toolVersion: ctx.toolVersion ?? '0.0.0',
      target: t.id,
      lang: ctx.lang,
      kind: t.kind,
      installRoot: t.installRoot,
      appliedAt: (ctx.now ?? new Date()).toISOString(),
      backupDir,
      files: records,
      stats: { totalKeys: stats.totalKeys, matchedKeys: stats.matchedKeys, totalHits: stats.totalHits, coverage: stats.coverage },
      runtime: base.runtime?.enabled
        ? {
            entries: base.runtime.entries,
            mainEntry: base.runtime.mainEntry!,
            ...(base.runtime.runtimeFile ? { runtimeFile: base.runtime.runtimeFile } : {}),
            hookVersion: HOOK_VERSION,
            translation: base.runtime.translation !== false,
          }
        : undefined,
    };
    writeManifest(manifestPath, manifest);
    if (existing && existing.backupDir !== backupDir) removeBackupDir(ctx.toolHome, existing.backupDir);

    if (t.kind === 'asar' && process.platform === 'darwin') {
      warnings.push(`macOS 修改 App 內容後需重新簽章：codesign --force --deep --sign - "${t.installRoot}"`);
    }
    return { ...base, status: 'applied', previousLang: existing?.lang };
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export type TargetState = 'not-applied' | 'applied' | 'outdated' | 'stale';

export interface TargetStatus {
  state: TargetState;
  manifest: Manifest | null;
  manifestPath: string;
  files: { path: string; role: ManifestFileRole; state: FileState; backupOk: boolean; backupReason?: string }[];
}

async function fileState(mf: ManifestFile): Promise<FileState> {
  if (!fs.existsSync(mf.path)) return 'missing';
  const h = await sha256File(mf.path);
  if (h === mf.patchedSha256) return 'patched';
  if (h === mf.originalSha256) return 'original';
  return 'changed';
}

/** 依 manifest 檢查目前的中文化與備份狀態 */
export async function inspectManifest(manifestPath: string): Promise<TargetStatus> {
  const manifest = readManifest(manifestPath);
  if (!manifest) return { state: 'not-applied', manifest: null, manifestPath, files: [] };
  const files: TargetStatus['files'] = [];
  for (const mf of manifest.files) {
    const v = await verifyBackup(mf.backupPath, mf.originalSha256);
    files.push({ path: mf.path, role: mf.role, state: await fileState(mf), backupOk: v.ok, backupReason: v.reason });
  }
  let state: TargetState;
  if (files.every((f) => f.state === 'patched')) state = 'applied';
  else if (files.every((f) => f.state === 'original')) state = 'stale';
  else state = 'outdated';
  return { state, manifest, manifestPath, files };
}

export async function inspectTarget(t: Pick<DetectedTarget, 'id' | 'installRoot'>, toolHome: string): Promise<TargetStatus> {
  return inspectManifest(manifestPathFor(toolHome, t));
}

export interface RestoreResult {
  target: TargetId;
  installRoot: string;
  status: 'restored' | 'already-original' | 'blocked';
  files: { path: string; action: 'restored' | 'skipped' | 'blocked'; reason?: string }[];
  warnings: string[];
}

export interface RestoreOptions {
  toolHome: string;
  force?: boolean;
  archiver?: AsarArchiver;
}

/** 依 manifest 校驗備份並無損還原 */
export async function restoreManifest(manifestPath: string, opts: RestoreOptions): Promise<RestoreResult> {
  const manifest = readManifest(manifestPath);
  if (!manifest) throw new Error(`找不到 manifest：${manifestPath}`);
  const archiver = opts.archiver ?? electronAsarArchiver;
  const result: RestoreResult = { target: manifest.target, installRoot: manifest.installRoot, status: 'restored', files: [], warnings: [] };

  // 第一階段：全部檢查完畢才動手（all-or-nothing）
  const plan: { mf: ManifestFile; action: 'restore' | 'skip' }[] = [];
  for (const mf of manifest.files) {
    const v = await verifyBackup(mf.backupPath, mf.originalSha256);
    if (!v.ok) {
      result.files.push({ path: mf.path, action: 'blocked', reason: `備份校驗失敗：${v.reason}` });
      continue;
    }
    const st = await fileState(mf);
    if (st === 'original') {
      plan.push({ mf, action: 'skip' });
    } else if (st === 'changed' && !opts.force) {
      result.files.push({
        path: mf.path,
        action: 'blocked',
        reason: '檔案在中文化後又被修改（可能是官方更新），還原會覆蓋新版本；確定要還原請加上 --force',
      });
    } else {
      plan.push({ mf, action: 'restore' });
    }
  }
  if (result.files.some((f) => f.action === 'blocked')) {
    result.status = 'blocked';
    return result;
  }

  for (const { mf, action } of plan) {
    if (action === 'skip') {
      result.files.push({ path: mf.path, action: 'skipped', reason: '已是原始版本' });
      continue;
    }
    if (mf.path.endsWith('.asar')) archiver.release(mf.path);
    await restoreFromBackup(mf.backupPath, mf.path, mf.originalSha256);
    result.files.push({ path: mf.path, action: 'restored' });
  }
  if (plan.every((p) => p.action === 'skip')) result.status = 'already-original';

  fs.rmSync(manifestPath, { force: true });
  removeBackupDir(opts.toolHome, manifest.backupDir);
  return result;
}
