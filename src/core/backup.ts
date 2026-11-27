import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backupsDir, manifestsDir } from '../config/paths.js';
import type { DetectedTarget, Manifest, TargetId } from '../types.js';

export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** 以串流計算檔案 SHA-256（適用於大型 asar） */
export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest('hex');
}

export function sha256FileSync(file: string): string {
  return sha256(fs.readFileSync(file));
}

/** 原子寫入：先寫暫存檔再 rename，並保留原檔權限 */
export function atomicWrite(file: string, data: Buffer | string): void {
  const tmp = `${file}.agi18n-tmp`;
  let mode: number | undefined;
  try {
    mode = fs.statSync(file).mode;
  } catch {
    mode = undefined;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(tmp, data);
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error(
        `無法寫入 ${file}（${code}）。請先完全關閉 Antigravity，或以系統管理員 / sudo 權限重新執行。`,
      );
    }
    throw e;
  }
}

/** 原子複製（大型檔案如 app.asar 不經過記憶體） */
export function atomicCopy(src: string, dest: string): void {
  const tmp = `${dest}.agi18n-tmp`;
  let mode: number | undefined;
  try {
    mode = fs.statSync(dest).mode;
  } catch {
    mode = undefined;
  }
  try {
    fs.copyFileSync(src, tmp);
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, dest);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error(`無法寫入 ${dest}（${code}）。請先完全關閉 Antigravity，或以系統管理員 / sudo 權限重新執行。`);
    }
    throw e;
  }
}

/** 由安裝路徑產生穩定的識別碼，用於 manifest 與備份目錄命名 */
export function targetKey(target: TargetId, installRoot: string): string {
  return `${target}-${sha256(path.resolve(installRoot)).slice(0, 12)}`;
}

export function manifestPathFor(home: string, t: Pick<DetectedTarget, 'id' | 'installRoot'>): string {
  return path.join(manifestsDir(home), `${targetKey(t.id, t.installRoot)}.json`);
}

export function newBackupDir(home: string, t: Pick<DetectedTarget, 'id' | 'installRoot'>, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(backupsDir(home), targetKey(t.id, t.installRoot), stamp);
}

export interface BackupRecord {
  backupPath: string;
  sha256: string;
}

/** 將原始內容寫入備份目錄並回讀驗證 */
export function writeBackup(backupDir: string, index: number, originalPath: string, data: Buffer): BackupRecord {
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${String(index).padStart(3, '0')}-${path.basename(originalPath)}`);
  fs.writeFileSync(backupPath, data);
  const expected = sha256(data);
  const actual = sha256FileSync(backupPath);
  if (actual !== expected) throw new Error(`備份校驗失敗：${backupPath}`);
  return { backupPath, sha256: expected };
}

/** 以檔案複製方式備份（適用大型檔案），並校驗 SHA-256 */
export async function backupFile(
  backupDir: string,
  index: number,
  originalPath: string,
  fromFile: string,
  expectedSha256: string,
): Promise<BackupRecord> {
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${String(index).padStart(3, '0')}-${path.basename(originalPath)}`);
  fs.copyFileSync(fromFile, backupPath);
  const actual = await sha256File(backupPath);
  if (actual !== expectedSha256) throw new Error(`備份校驗失敗：${backupPath}`);
  return { backupPath, sha256: actual };
}

/** 驗證備份檔存在且 SHA-256 正確 */
export async function verifyBackup(backupPath: string, expectedSha256: string): Promise<{ ok: boolean; reason?: string }> {
  if (!fs.existsSync(backupPath)) return { ok: false, reason: '備份檔不存在' };
  const actual = await sha256File(backupPath);
  if (actual !== expectedSha256) return { ok: false, reason: `SHA-256 不符（預期 ${expectedSha256.slice(0, 12)}…，實際 ${actual.slice(0, 12)}…）` };
  return { ok: true };
}

/** 以備份還原檔案，寫入後再次校驗 */
export async function restoreFromBackup(backupPath: string, dest: string, expectedSha256: string): Promise<void> {
  const v = await verifyBackup(backupPath, expectedSha256);
  if (!v.ok) throw new Error(`無法還原 ${dest}：${v.reason}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  atomicCopy(backupPath, dest);
  const after = await sha256File(dest);
  if (after !== expectedSha256) throw new Error(`還原後校驗失敗：${dest}`);
}

export function readManifest(file: string): Manifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
    return m && m.schemaVersion === 1 && m.tool === 'antigravity-i18n' ? m : null;
  } catch {
    return null;
  }
}

export function writeManifest(file: string, m: Manifest): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, `${JSON.stringify(m, null, 2)}\n`);
}

/** 列出某個目標（或全部）的 manifest */
export function listManifests(home: string, target?: TargetId): { file: string; manifest: Manifest }[] {
  const dir = manifestsDir(home);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: { file: string; manifest: Manifest }[] = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.json')) continue;
    if (target && !n.startsWith(`${target}-`)) continue;
    const file = path.join(dir, n);
    const manifest = readManifest(file);
    if (manifest) out.push({ file, manifest });
  }
  return out;
}

/** 刪除備份目錄（限定在工具的 backups 目錄之下，避免誤刪） */
export function removeBackupDir(home: string, dir: string): void {
  const root = path.resolve(backupsDir(home));
  const target = path.resolve(dir);
  if (!target.startsWith(root + path.sep)) return;
  fs.rmSync(target, { recursive: true, force: true });
  // 若上一層已空也一併清除
  const parent = path.dirname(target);
  try {
    if (parent !== root && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
  } catch {
    /* ignore */
  }
}
