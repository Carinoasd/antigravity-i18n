import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import * as asar from '@electron/asar';

/**
 * Electron `app.asar` 的抽象層。
 *
 * patcher 只依賴這個介面，單元測試可以注入假的實作，
 * 正式執行則使用以 `@electron/asar` 為基礎的 {@link electronAsarArchiver}。
 */
export interface AsarEntry {
  /** 封存內的相對路徑，一律使用 `/` 分隔 */
  path: string;
  type: 'file' | 'directory' | 'link';
  /** 是否放在 `app.asar.unpacked/` 目錄（原生模組等） */
  unpacked: boolean;
  executable?: boolean;
  /** type 為 link 時，相對於封存根目錄的目標路徑 */
  link?: string;
}

export interface AsarWriteEntry extends AsarEntry {
  /** 檔案內容提供者（type 為 file 時必填） */
  read?: () => Buffer;
}

export interface AsarArchiver {
  list(archivePath: string): AsarEntry[];
  /** 讀取「打包在 asar 內」的檔案內容（unpacked 檔案請直接讀磁碟） */
  readFile(archivePath: string, entryPath: string): Buffer;
  write(destArchive: string, entries: AsarWriteEntry[]): Promise<void>;
  /** ElectronAsarIntegrity 使用的 header SHA-256（hex） */
  headerHash(archivePath: string): string;
  /** 釋放對封存檔的快取（覆寫檔案前呼叫） */
  release(archivePath: string): void;
}

interface HeaderNode {
  files?: Record<string, HeaderNode>;
  unpacked?: boolean;
  executable?: boolean;
  link?: string;
  size?: number;
}

function walkHeader(node: HeaderNode, prefix: string, out: AsarEntry[]): void {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (child.files) {
      out.push({ path: p, type: 'directory', unpacked: Boolean(child.unpacked) });
      walkHeader(child, p, out);
    } else if (child.link !== undefined) {
      out.push({ path: p, type: 'link', unpacked: Boolean(child.unpacked), link: child.link.split(path.sep).join('/') });
    } else {
      out.push({ path: p, type: 'file', unpacked: Boolean(child.unpacked), executable: Boolean(child.executable) });
    }
  }
}

function fakeStat(size: number, executable: boolean): fs.Stats {
  return { size, mode: executable ? 0o100755 : 0o100644 } as fs.Stats;
}

export const electronAsarArchiver: AsarArchiver = {
  list(archivePath) {
    const { header } = asar.getRawHeader(archivePath);
    const out: AsarEntry[] = [];
    walkHeader(header as HeaderNode, '', out);
    return out;
  },

  readFile(archivePath, entryPath) {
    return asar.extractFile(archivePath, entryPath.split('/').join(path.sep), false);
  },

  async write(destArchive, entries) {
    const streams: asar.AsarStreamType[] = entries.map((e) => {
      const rel = e.path.split('/').join(path.sep);
      if (e.type === 'directory') return { type: 'directory', path: rel, unpacked: e.unpacked };
      const read = e.read;
      if (e.type === 'link') {
        const target = path.relative(path.dirname(rel), (e.link ?? '').split('/').join(path.sep));
        return {
          type: 'link',
          path: rel,
          unpacked: e.unpacked,
          symlink: target,
          stat: fakeStat(0, false),
          streamGenerator: () => Readable.from([]),
        };
      }
      if (!read) throw new Error(`asar entry 缺少內容：${e.path}`);
      const data = read();
      return {
        type: 'file',
        path: rel,
        unpacked: e.unpacked,
        stat: fakeStat(data.length, Boolean(e.executable)),
        streamGenerator: () => Readable.from([data]),
      };
    });
    const ws = await asar.createPackageFromStreams(destArchive, streams);
    await new Promise<void>((resolve, reject) => {
      if ((ws as fs.WriteStream & { closed?: boolean }).closed) return resolve();
      ws.once('close', () => resolve());
      ws.once('error', reject);
    });
    asar.uncache(destArchive);
  },

  headerHash(archivePath) {
    const { headerString } = asar.getRawHeader(archivePath);
    return crypto.createHash('sha256').update(headerString).digest('hex');
  },

  release(archivePath) {
    asar.uncache(archivePath);
  },
};
