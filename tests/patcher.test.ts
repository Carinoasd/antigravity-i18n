import fs from 'node:fs';
import path from 'node:path';
import * as asar from '@electron/asar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appInstallCandidates, cliCandidates, detectTarget, ideInstallCandidates, type PathEnv } from '../src/config/paths.js';
import { electronAsarArchiver, type AsarArchiver, type AsarEntry, type AsarWriteEntry } from '../src/core/asar.js';
import { readManifest, sha256 } from '../src/core/backup.js';
import { applyTarget, inspectTarget, restoreManifest, vscodeChecksum } from '../src/core/patcher.js';
import type { DetectedTarget, Dictionary } from '../src/types.js';
import { rm, tmpDir, write } from './helpers.js';

const dictTW: Dictionary = { Settings: '設定', Run: '執行', 'Accept All': '全部接受', 'Open Agent Manager': '開啟 Agent 管理員' };
const dictCN: Dictionary = { Settings: '设置', Run: '运行', 'Accept All': '全部接受', 'Open Agent Manager': '打开 Agent 管理器' };

let dir: string;
let home: string;
beforeEach(() => {
  dir = tmpDir();
  home = path.join(dir, 'tool-home');
});
afterEach(() => rm(dir));

const WORKBENCH = `var a={label:"Settings"};if(x==="Run"){}b("Accept All");`;
const NLS = JSON.stringify(['Settings', 'Open Agent Manager', 'Untouched']);

function makeIde(): { root: string; target: DetectedTarget; workbench: string; nls: string; product: string } {
  const root = path.join(dir, 'Antigravity');
  const app = path.join(root, 'resources', 'app');
  const workbench = write(path.join(app, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'), WORKBENCH);
  const nls = write(path.join(app, 'out', 'nls.messages.json'), NLS);
  write(path.join(app, 'extensions', 'antigravity-agent', 'dist', 'panel.js'), `x={title:"Run"}`);
  write(path.join(app, 'extensions', 'git', 'dist', 'main.js'), `x={title:"Run"}`);
  const product = write(
    path.join(app, 'product.json'),
    `{\n\t"nameShort": "Antigravity",\n\t"checksums": {\n\t\t"vs/workbench/workbench.desktop.main.js": "${vscodeChecksum(Buffer.from(WORKBENCH))}"\n\t}\n}\n`,
  );
  const target = detectTarget('ide', { customPath: root });
  if (!target) throw new Error('detect failed');
  return { root, target, workbench, nls, product };
}

describe('路徑偵測', () => {
  const pe = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): PathEnv => ({ platform, home: '/home/u', env });

  it('各平台候選路徑', () => {
    expect(appInstallCandidates(pe('darwin'))).toContain('/Applications/Antigravity.app');
    expect(appInstallCandidates(pe('linux'))).toContain('/opt/Antigravity');
    const win = appInstallCandidates({ platform: 'win32', home: 'C:\\Users\\u', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } });
    expect(win).toContain('C:\\Users\\u\\AppData\\Local\\Programs\\Antigravity');
    expect(ideInstallCandidates(pe('linux'))).toContain('/usr/share/antigravity');
    expect(cliCandidates(pe('linux', { PATH: '/usr/bin:/bin' }))).toContain('/usr/bin/agy');
    expect(cliCandidates({ platform: 'win32', home: 'C:\\Users\\u', env: { PATH: 'C:\\bin' } })).toContain('C:\\bin\\agy.cmd');
  });

  it('偵測 IDE 結構並只納入 Antigravity 相關擴充功能', () => {
    const { target, workbench, nls, product } = makeIde();
    expect(target.kind).toBe('files');
    expect(target.source).toBe('custom');
    expect(target.files).toContain(workbench);
    expect(target.files).toContain(nls);
    expect(target.files.some((f) => f.includes(`${path.sep}git${path.sep}`))).toBe(false);
    expect(target.files.some((f) => f.endsWith('panel.js'))).toBe(true);
    expect(target.productJson).toBe(product);
  });

  it('找不到時回傳 null', () => {
    expect(detectTarget('ide', { customPath: path.join(dir, 'nope') })).toBeNull();
    expect(detectTarget('app', { customPath: dir })).toBeNull();
  });

  it('CLI：Node 腳本可修補、二進位不支援', () => {
    const js = write(path.join(dir, 'cli', 'bin', 'agy'), '#!/usr/bin/env node\nconsole.log({message:"Run"})');
    write(path.join(dir, 'cli', 'package.json'), '{}');
    write(path.join(dir, 'cli', 'dist', 'index.js'), 'x');
    const t = detectTarget('cli', { customPath: js })!;
    expect(t.supported).toBe(true);
    expect(t.files).toHaveLength(2);
    const bin = write(path.join(dir, 'bin', 'agy'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 1]));
    const b = detectTarget('cli', { customPath: bin })!;
    expect(b.supported).toBe(false);
    expect(b.reason).toMatch(/二進位/);
  });
});

describe('IDE（純檔案）套用與還原', () => {
  it('dry-run 不修改任何檔案', async () => {
    const { target, workbench } = makeIde();
    const r = await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home, dryRun: true });
    expect(r.status).toBe('dry-run');
    expect(r.stats.matchedKeys).toBe(4);
    expect(r.stats.coverage).toBe(1);
    expect(fs.readFileSync(workbench, 'utf8')).toBe(WORKBENCH);
    expect(fs.existsSync(home)).toBe(false);
  });

  it('套用：備份、替換、更新 checksums、寫入 manifest', async () => {
    const { target, workbench, nls, product } = makeIde();
    const r = await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home, toolVersion: '9.9.9' });
    expect(r.status).toBe('applied');
    const wb = fs.readFileSync(workbench, 'utf8');
    expect(wb).toBe(`var a={label:"設定"};if(x==="Run"){}b("全部接受");`);
    expect(JSON.parse(fs.readFileSync(nls, 'utf8'))).toEqual(['設定', '開啟 Agent 管理員', 'Untouched']);
    const pj = JSON.parse(fs.readFileSync(product, 'utf8')) as { checksums: Record<string, string> };
    expect(pj.checksums['vs/workbench/workbench.desktop.main.js']).toBe(vscodeChecksum(Buffer.from(wb)));
    expect(fs.readFileSync(product, 'utf8')).toContain('\n\t"nameShort"');

    const m = readManifest(r.manifestPath)!;
    expect(m.lang).toBe('zh-TW');
    expect(m.toolVersion).toBe('9.9.9');
    expect(m.files.map((f) => f.role).sort()).toEqual(['checksum', 'content', 'content', 'content']);
    const wbRec = m.files.find((f) => f.path === workbench)!;
    expect(wbRec.originalSha256).toBe(sha256(WORKBENCH));
    expect(fs.readFileSync(wbRec.backupPath, 'utf8')).toBe(WORKBENCH);
    expect((await inspectTarget(target, home)).state).toBe('applied');
  });

  it('已套用時預設拒絕；--force 以原始檔重新翻譯（不會重複翻譯）並可切換語系', async () => {
    const { target, workbench } = makeIde();
    await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home });
    const again = await applyTarget(target, { lang: 'zh-CN', dict: dictCN, toolHome: home });
    expect(again.status).toBe('already-applied');
    expect(again.previousLang).toBe('zh-TW');

    const forced = await applyTarget(target, { lang: 'zh-CN', dict: dictCN, toolHome: home, force: true });
    expect(forced.status).toBe('applied');
    expect(fs.readFileSync(workbench, 'utf8')).toBe(`var a={label:"设置"};if(x==="Run"){}b("全部接受");`);
    const m = readManifest(forced.manifestPath)!;
    expect(m.lang).toBe('zh-CN');
    expect(m.files.find((f) => f.path === workbench)!.originalSha256).toBe(sha256(WORKBENCH));
    // 舊的備份目錄已清除，只剩一份
    expect(fs.readdirSync(path.dirname(m.backupDir))).toHaveLength(1);
  });

  it('官方更新導致 hash 改變時提示警告並重新備份', async () => {
    const { target, workbench } = makeIde();
    await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home });
    const updated = `${WORKBENCH}/*v2*/`;
    write(workbench, updated);
    expect((await inspectTarget(target, home)).state).toBe('outdated');
    const r = await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home });
    expect(r.status).toBe('applied');
    expect(r.warnings.some((w) => w.includes('官方版本更新'))).toBe(true);
    const m = readManifest(r.manifestPath)!;
    expect(m.files.find((f) => f.path === workbench)!.originalSha256).toBe(sha256(updated));
  });

  it('restore 校驗備份並還原為位元組完全相同的原始檔', async () => {
    const { target, workbench, nls, product } = makeIde();
    const before = [workbench, nls, product].map((f) => fs.readFileSync(f));
    const r = await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home });
    const res = await restoreManifest(r.manifestPath, { toolHome: home });
    expect(res.status).toBe('restored');
    expect([workbench, nls, product].map((f) => fs.readFileSync(f))).toEqual(before);
    expect(fs.existsSync(r.manifestPath)).toBe(false);
    expect((await inspectTarget(target, home)).state).toBe('not-applied');
  });

  it('restore：檔案在套用後被修改時中止（除非 --force），備份被竄改時拒絕', async () => {
    const { target, workbench } = makeIde();
    const r = await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home });
    write(workbench, 'new official version');
    const blocked = await restoreManifest(r.manifestPath, { toolHome: home });
    expect(blocked.status).toBe('blocked');
    expect(fs.readFileSync(workbench, 'utf8')).toBe('new official version');

    const m = readManifest(r.manifestPath)!;
    const nlsRec = m.files.find((f) => f.path.endsWith('nls.messages.json'))!;
    write(nlsRec.backupPath, 'tampered');
    const bad = await restoreManifest(r.manifestPath, { toolHome: home, force: true });
    expect(bad.status).toBe('blocked');
    expect(bad.files.some((f) => f.reason?.includes('備份校驗失敗'))).toBe(true);
  });

  it('不支援的目標直接回傳', async () => {
    const t: DetectedTarget = { id: 'cli', installRoot: dir, kind: 'files', files: [], source: 'custom', supported: false, reason: 'binary' };
    const r = await applyTarget(t, { lang: 'zh-TW', dict: dictTW, toolHome: home });
    expect(r.status).toBe('unsupported');
    expect(r.warnings).toContain('binary');
  });
});

describe('App（app.asar）套用與還原', () => {
  async function makeApp(withPlist = false): Promise<{ root: string; asarPath: string; target: DetectedTarget }> {
    const src = path.join(dir, 'src');
    write(path.join(src, 'package.json'), '{"name":"antigravity","productName":"Run"}');
    write(path.join(src, 'dist', 'main.js'), 'win.setTitle("x");menu={label:"Settings"};');
    write(path.join(src, 'dist', 'index.html'), '<button>Accept All</button>');
    write(path.join(src, 'node_modules', 'lib', 'index.js'), 'x={label:"Settings"}');
    write(path.join(src, 'native', 'addon.node'), Buffer.from([1, 2, 3, 0, 4]));
    const root = path.join(dir, withPlist ? 'Antigravity.app' : 'Antigravity App');
    const asarPath = withPlist ? path.join(root, 'Contents', 'Resources', 'app.asar') : path.join(root, 'resources', 'app.asar');
    fs.mkdirSync(path.dirname(asarPath), { recursive: true });
    await asar.createPackageWithOptions(src, asarPath, { unpack: '*.node' });
    if (withPlist) {
      const hash = electronAsarArchiver.headerHash(asarPath);
      write(
        path.join(root, 'Contents', 'Info.plist'),
        `<?xml version="1.0"?>\n<plist><dict><key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>${hash}</string></dict></dict></dict></plist>\n`,
      );
    }
    const target = detectTarget('app', { customPath: root });
    if (!target) throw new Error('detect failed');
    return { root, asarPath, target };
  }

  it('翻譯 asar 內容、保留 unpacked 與 node_modules、可還原', async () => {
    const { asarPath, target } = await makeApp();
    expect(target.kind).toBe('asar');
    const original = fs.readFileSync(asarPath);

    const dry = await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home, dryRun: true });
    expect(dry.stats.matchedKeys).toBe(2);
    expect(fs.readFileSync(asarPath)).toEqual(original);

    const r = await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home });
    expect(r.status).toBe('applied');
    asar.uncacheAll();
    expect(asar.extractFile(asarPath, path.join('dist', 'main.js')).toString()).toBe('win.setTitle("x");menu={label:"設定"};');
    expect(asar.extractFile(asarPath, path.join('dist', 'index.html')).toString()).toBe('<button>全部接受</button>');
    expect(asar.extractFile(asarPath, path.join('node_modules', 'lib', 'index.js')).toString()).toBe('x={label:"Settings"}');
    expect(asar.extractFile(asarPath, 'package.json').toString()).toContain('"productName":"Run"');
    const entry = electronAsarArchiver.list(asarPath).find((e) => e.path === 'native/addon.node')!;
    expect(entry.unpacked).toBe(true);
    expect(fs.readFileSync(path.join(`${asarPath}.unpacked`, 'native', 'addon.node'))).toEqual(Buffer.from([1, 2, 3, 0, 4]));

    const res = await restoreManifest(r.manifestPath, { toolHome: home });
    expect(res.status).toBe('restored');
    expect(fs.readFileSync(asarPath)).toEqual(original);
  });

  it('macOS：同步更新 Info.plist 的 ElectronAsarIntegrity', async () => {
    const { asarPath, target } = await makeApp(true);
    expect(target.infoPlist).toBeDefined();
    const r = await applyTarget(target, { lang: 'zh-TW', dict: dictTW, toolHome: home });
    expect(r.files.map((f) => f.role)).toEqual(['content', 'integrity']);
    const plist = fs.readFileSync(target.infoPlist!, 'utf8');
    expect(plist).toContain(`<string>${electronAsarArchiver.headerHash(asarPath)}</string>`);
  });

  it('可注入假的 AsarArchiver（asar 模組已抽象化）', async () => {
    const files = new Map<string, Buffer>([['a/ui.js', Buffer.from('x={title:"Run"}')]]);
    const written: AsarWriteEntry[] = [];
    const fake: AsarArchiver = {
      list: (): AsarEntry[] => [
        { path: 'a', type: 'directory', unpacked: false },
        { path: 'a/ui.js', type: 'file', unpacked: false },
      ],
      readFile: (_a, p) => files.get(p)!,
      write: async (dest, entries) => {
        written.push(...entries);
        fs.writeFileSync(dest, 'fake-archive');
      },
      headerHash: () => 'f'.repeat(64),
      release: () => undefined,
    };
    const asarPath = write(path.join(dir, 'fake', 'app.asar'), 'orig-archive');
    const t: DetectedTarget = { id: 'app', installRoot: path.join(dir, 'fake'), kind: 'asar', files: [asarPath], source: 'custom', supported: true };
    const r = await applyTarget(t, { lang: 'zh-TW', dict: dictTW, toolHome: home, archiver: fake });
    expect(r.status).toBe('applied');
    expect(written.find((e) => e.path === 'a/ui.js')!.read!().toString()).toBe('x={title:"執行"}');
    expect(fs.readFileSync(asarPath, 'utf8')).toBe('fake-archive');
    await restoreManifest(r.manifestPath, { toolHome: home, archiver: fake });
    expect(fs.readFileSync(asarPath, 'utf8')).toBe('orig-archive');
  });
});
