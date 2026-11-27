import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  atomicWrite,
  backupFile,
  listManifests,
  manifestPathFor,
  readManifest,
  removeBackupDir,
  restoreFromBackup,
  sha256,
  sha256File,
  targetKey,
  verifyBackup,
  writeBackup,
  writeManifest,
} from '../src/core/backup.js';
import { backupsDir } from '../src/config/paths.js';
import type { Manifest } from '../src/types.js';
import { rm, tmpDir, write } from './helpers.js';

let dir: string;
beforeEach(() => {
  dir = tmpDir();
});
afterEach(() => rm(dir));

describe('SHA-256', () => {
  it('sha256 與 sha256File 結果一致', async () => {
    const f = write(path.join(dir, 'a.txt'), 'hello');
    expect(sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(await sha256File(f)).toBe(sha256('hello'));
  });
});

describe('備份與還原', () => {
  it('writeBackup / backupFile 會校驗並回傳 hash', async () => {
    const orig = write(path.join(dir, 'app', 'main.js'), 'original');
    const bdir = path.join(dir, 'home', 'backups', 'x', 'stamp');
    const a = writeBackup(bdir, 0, orig, Buffer.from('original'));
    expect(a.sha256).toBe(sha256('original'));
    expect(fs.readFileSync(a.backupPath, 'utf8')).toBe('original');
    const b = await backupFile(bdir, 1, orig, orig, sha256('original'));
    expect(path.basename(b.backupPath)).toBe('001-main.js');
    await expect(backupFile(bdir, 2, orig, orig, sha256('other'))).rejects.toThrow('備份校驗失敗');
  });

  it('verifyBackup 偵測遺失與竄改', async () => {
    const f = write(path.join(dir, 'b.bak'), 'data');
    expect((await verifyBackup(f, sha256('data'))).ok).toBe(true);
    expect((await verifyBackup(path.join(dir, 'missing'), sha256('data'))).reason).toBe('備份檔不存在');
    write(f, 'tampered');
    expect((await verifyBackup(f, sha256('data'))).reason).toMatch(/SHA-256 不符/);
  });

  it('restoreFromBackup 無損還原且保留權限', async () => {
    const dest = write(path.join(dir, 'app', 'main.js'), 'patched');
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    const bak = write(path.join(dir, 'bak'), 'original');
    await restoreFromBackup(bak, dest, sha256('original'));
    expect(fs.readFileSync(dest, 'utf8')).toBe('original');
    if (process.platform !== 'win32') expect(fs.statSync(dest).mode & 0o777).toBe(0o755);
  });

  it('備份被竄改時拒絕還原', async () => {
    const dest = write(path.join(dir, 'main.js'), 'patched');
    const bak = write(path.join(dir, 'bak'), 'corrupted');
    await expect(restoreFromBackup(bak, dest, sha256('original'))).rejects.toThrow(/無法還原/);
    expect(fs.readFileSync(dest, 'utf8')).toBe('patched');
  });

  it('atomicWrite 不留下暫存檔', () => {
    const f = path.join(dir, 'x', 'y.json');
    atomicWrite(f, '{}');
    expect(fs.readFileSync(f, 'utf8')).toBe('{}');
    expect(fs.readdirSync(path.dirname(f))).toEqual(['y.json']);
  });
});

describe('manifest', () => {
  const sample = (installRoot: string): Manifest => ({
    schemaVersion: 1,
    tool: 'antigravity-i18n',
    toolVersion: '0.1.0',
    target: 'ide',
    lang: 'zh-TW',
    kind: 'files',
    installRoot,
    appliedAt: new Date(0).toISOString(),
    backupDir: '/tmp/none',
    files: [],
    stats: { totalKeys: 1, matchedKeys: 1, totalHits: 1, coverage: 1 },
  });

  it('寫入、讀取與列出 manifest', () => {
    const home = path.join(dir, 'home');
    const file = manifestPathFor(home, { id: 'ide', installRoot: '/opt/antigravity' });
    expect(path.basename(file)).toBe(`${targetKey('ide', '/opt/antigravity')}.json`);
    writeManifest(file, sample('/opt/antigravity'));
    expect(readManifest(file)?.installRoot).toBe('/opt/antigravity');
    expect(listManifests(home, 'ide')).toHaveLength(1);
    expect(listManifests(home, 'app')).toHaveLength(0);
  });

  it('readManifest 忽略無效檔案', () => {
    const f = write(path.join(dir, 'bad.json'), '{"tool":"other"}');
    expect(readManifest(f)).toBeNull();
    expect(readManifest(path.join(dir, 'missing.json'))).toBeNull();
  });

  it('removeBackupDir 只刪除工具 backups 目錄下的路徑', () => {
    const home = path.join(dir, 'home');
    const inside = path.join(backupsDir(home), 'ide-abc', 'stamp');
    write(path.join(inside, 'f'), 'x');
    const outside = path.join(dir, 'precious');
    write(path.join(outside, 'f'), 'x');
    removeBackupDir(home, outside);
    expect(fs.existsSync(outside)).toBe(true);
    removeBackupDir(home, inside);
    expect(fs.existsSync(inside)).toBe(false);
    expect(fs.existsSync(path.join(backupsDir(home), 'ide-abc'))).toBe(false);
  });
});
