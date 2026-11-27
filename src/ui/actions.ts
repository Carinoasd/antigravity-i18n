import { detectTarget } from '../config/paths.js';
import { hookHint } from '../commands/bg.js';
import type { AsarArchiver } from '../core/asar.js';
import { listManifests, manifestPathFor } from '../core/backup.js';
import {
  BackgroundError,
  backgroundStatus,
  clearBackground,
  setBackground,
  setBackgroundEnabled,
  setPreset,
  type BackgroundStatus,
  type WslContext,
} from '../core/background.js';
import { FileLockError, explainFsError } from '../core/errors.js';
import { loadDictionary, normalizeLang } from '../core/locales.js';
import { applyTarget, inspectManifest, inspectTarget, restoreManifest, type ApplyStatus, type TargetState } from '../core/patcher.js';
import { BACKGROUND_PRESETS } from '../core/presets.js';
import { installRules, removeRules, rulesStatus, type RulesFileStatus } from '../core/rules.js';
import { HOOK_VERSION, type RuntimeLayerInfo } from '../core/runtime.js';
import { TARGET_IDS, TARGET_LABELS, TARGET_MODULES, type ApplyLang, type DetectedTarget, type Lang, type TargetId } from '../types.js';

/**
 * 圖形控制台的操作層：把 CLI 的功能包成「回傳結構化結果」的函式（不印出任何東西），
 * 供本機 HTTP server 使用。偵測函式可注入，測試時只使用暫存目錄中的假安裝。
 */

export type Detect = (id: TargetId, customPath?: string) => DetectedTarget | null;

export interface ActionContext {
  /** 工具資料目錄（manifests / backups / background.json） */
  toolHome: string;
  /** 使用者家目錄（全域規則 ~/.gemini/config/rules） */
  userHome: string;
  toolVersion: string;
  detect?: Detect;
  /** WSL 狀態；undefined 表示自動偵測，null 表示非 WSL */
  wsl?: WslContext | null;
  archiver?: AsarArchiver;
}

export type TargetPaths = Partial<Record<TargetId, string>>;

/** 給使用者看的錯誤：鎖定／權限錯誤會附上處理步驟 */
export interface FriendlyError {
  message: string;
  code?: string;
  steps?: string[];
}

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export function toFriendly(e: unknown): FriendlyError {
  if (e instanceof FileLockError) return { message: e.message, code: e.code, steps: e.steps };
  const exp = explainFsError(e);
  if (exp) return { message: `${exp.title}（${exp.code}）`, code: exp.code, steps: exp.steps };
  return { message: e instanceof Error ? e.message : String(e) };
}

const detectOf = (ctx: ActionContext): Detect => ctx.detect ?? ((id, customPath) => detectTarget(id, { customPath }));

function cleanPaths(input: unknown): TargetPaths {
  const out: TargetPaths = {};
  if (!input || typeof input !== 'object') return out;
  for (const id of TARGET_IDS) {
    const v = (input as Record<string, unknown>)[id];
    if (typeof v === 'string' && v.trim() !== '') {
      if (v.length > 4096) throw new RequestError(`${id} 路徑過長`);
      out[id] = v.trim();
    }
  }
  return out;
}

function parseTargetList(input: unknown): TargetId[] {
  if (input === undefined || input === 'all') return [...TARGET_IDS];
  if (typeof input === 'string' && (TARGET_IDS as readonly string[]).includes(input)) return [input as TargetId];
  throw new RequestError('target 必須是 app、ide、cli 或 all');
}

function parseApplyLang(input: unknown): ApplyLang {
  if (input === 'none') return 'none';
  const lang = typeof input === 'string' ? normalizeLang(input) : null;
  if (!lang) throw new RequestError('lang 必須是 zh-TW、zh-CN 或 none');
  return lang;
}

// ── 狀態 ──────────────────────────────────────────────

export interface TargetReport {
  id: TargetId;
  label: string;
  detected: boolean;
  installRoot?: string;
  source?: DetectedTarget['source'];
  kind?: DetectedTarget['kind'];
  supported?: boolean;
  reason?: string;
  state: 'not-installed' | 'unsupported' | TargetState;
  lang?: ApplyLang;
  appliedAt?: string;
  hookVersion?: number;
  backgroundOnly?: boolean;
  coverage?: number;
  backupOk?: boolean;
}

export interface StatusReport {
  version: string;
  hookVersion: number;
  toolHome: string;
  targets: TargetReport[];
  background: (BackgroundStatus & { error?: undefined }) | { error: string };
  rules: RulesFileStatus[];
  presets: { name: string; label: string; description: string; image: string }[];
  /** 背景圖 / 面板需要更新掛鉤時的提示 */
  hint: string | null;
}

export async function collectStatus(ctx: ActionContext, rawPaths: unknown = {}): Promise<StatusReport> {
  const paths = cleanPaths(rawPaths);
  const detect = detectOf(ctx);
  const targets: TargetReport[] = [];
  for (const id of TARGET_IDS) {
    const t = detect(id, paths[id]);
    const base: TargetReport = { id, label: TARGET_LABELS[id], detected: !!t, state: 'not-installed' };
    if (!t) {
      // 偵測不到但有套用紀錄（例如以自訂路徑套用過）
      const m = listManifests(ctx.toolHome, id)[0];
      if (m) {
        const st = await inspectManifest(m.file);
        Object.assign(base, manifestFields(st), { installRoot: m.manifest.installRoot });
      }
      targets.push(base);
      continue;
    }
    Object.assign(base, { installRoot: t.installRoot, source: t.source, kind: t.kind, supported: t.supported, reason: t.reason });
    if (!t.supported) {
      base.state = 'unsupported';
      targets.push(base);
      continue;
    }
    Object.assign(base, manifestFields(await inspectTarget(t, ctx.toolHome)));
    targets.push(base);
  }
  let background: StatusReport['background'];
  try {
    background = backgroundStatus(ctx.toolHome, { wsl: ctx.wsl });
  } catch (e) {
    background = { error: (e as Error).message };
  }
  return {
    version: ctx.toolVersion,
    hookVersion: HOOK_VERSION,
    toolHome: ctx.toolHome,
    targets,
    background,
    rules: rulesStatus(ctx.userHome),
    presets: Object.entries(BACKGROUND_PRESETS).map(([name, p]) => ({ name, label: p.label, description: p.description, image: p.image })),
    hint: hookHint(ctx.toolHome),
  };
}

function manifestFields(st: Awaited<ReturnType<typeof inspectTarget>>): Partial<TargetReport> {
  if (!st.manifest) return { state: 'not-applied' };
  const m = st.manifest;
  return {
    state: st.state,
    lang: m.lang,
    appliedAt: m.appliedAt,
    hookVersion: m.runtime?.hookVersion,
    backgroundOnly: m.lang === 'none',
    coverage: m.stats.coverage,
    backupOk: st.files.every((f) => f.backupOk),
  };
}

// ── 套用 ──────────────────────────────────────────────

export interface ApplyItem {
  id: TargetId;
  status: ApplyStatus | 'not-installed' | 'skipped' | 'error';
  installRoot?: string;
  warnings: string[];
  previousLang?: ApplyLang;
  stats?: { matchedKeys: number; totalKeys: number; totalHits: number; coverage: number };
  runtime?: RuntimeLayerInfo;
  files?: number;
  error?: FriendlyError;
}

export interface ApplyResponse {
  ok: boolean;
  lang: ApplyLang;
  dryRun: boolean;
  results: ApplyItem[];
}

export async function runApply(ctx: ActionContext, body: Record<string, unknown>): Promise<ApplyResponse> {
  const lang = parseApplyLang(body.lang);
  const ids = parseTargetList(body.target ?? (lang === 'none' ? 'app' : 'all'));
  const all = ids.length > 1;
  if (lang === 'none' && !all && ids[0] !== 'app') throw new RequestError('僅背景模式（none）只適用於 app 目標');
  const paths = cleanPaths(body.paths);
  const dryRun = body.dryRun === true;
  const force = body.force === true;
  const detect = detectOf(ctx);
  const results: ApplyItem[] = [];

  for (const id of ids) {
    if (lang === 'none' && id !== 'app') {
      results.push({ id, status: 'skipped', warnings: ['僅背景模式只適用於 app'] });
      continue;
    }
    const t = detect(id, paths[id]);
    if (!t) {
      results.push({ id, status: 'not-installed', warnings: [] });
      continue;
    }
    try {
      const dict = lang === 'none' ? {} : loadDictionary(lang as Lang, TARGET_MODULES[id]);
      const r = await applyTarget(t, { lang, dict, toolHome: ctx.toolHome, dryRun, force, toolVersion: ctx.toolVersion, archiver: ctx.archiver });
      results.push({
        id,
        status: r.status,
        installRoot: r.installRoot,
        warnings: r.warnings,
        previousLang: r.previousLang,
        stats: { matchedKeys: r.stats.matchedKeys, totalKeys: r.stats.totalKeys, totalHits: r.stats.totalHits, coverage: r.stats.coverage },
        runtime: r.runtime,
        files: r.files.length,
      });
    } catch (e) {
      results.push({ id, status: 'error', installRoot: t.installRoot, warnings: [], error: toFriendly(e) });
    }
  }
  const ok = results.every((r) => r.status !== 'error') && results.some((r) => ['applied', 'dry-run', 'already-applied'].includes(r.status));
  return { ok, lang, dryRun, results };
}

// ── 還原 ──────────────────────────────────────────────

export interface RestoreItem {
  id: TargetId;
  installRoot?: string;
  status: 'restored' | 'already-original' | 'blocked' | 'error';
  files: { path: string; action: string; reason?: string }[];
  error?: FriendlyError;
}

export async function runRestore(ctx: ActionContext, body: Record<string, unknown>): Promise<{ ok: boolean; results: RestoreItem[] }> {
  const ids = parseTargetList(body.target);
  const paths = cleanPaths(body.paths);
  const detect = detectOf(ctx);
  const jobs: { id: TargetId; file: string }[] = [];
  for (const id of ids) {
    if (paths[id]) {
      const t = detect(id, paths[id]);
      if (t) jobs.push({ id, file: manifestPathFor(ctx.toolHome, t) });
    } else {
      for (const m of listManifests(ctx.toolHome, id)) jobs.push({ id, file: m.file });
    }
  }
  const results: RestoreItem[] = [];
  for (const { id, file } of jobs) {
    if (!listManifests(ctx.toolHome, id).some((m) => m.file === file)) continue;
    try {
      const r = await restoreManifest(file, { toolHome: ctx.toolHome, force: body.force === true, archiver: ctx.archiver });
      results.push({ id, installRoot: r.installRoot, status: r.status, files: r.files });
    } catch (e) {
      results.push({ id, status: 'error', files: [], error: toFriendly(e) });
    }
  }
  return { ok: results.every((r) => r.status === 'restored' || r.status === 'already-original'), results };
}

// ── 背景 ──────────────────────────────────────────────

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);

export function runBg(ctx: ActionContext, body: Record<string, unknown>): { ok: true; action: string; config?: unknown; file?: string; mirror?: string; removed?: string[]; warnings: string[] } {
  const action = body.action;
  const wsl = ctx.wsl;
  try {
    switch (action) {
      case 'preset': {
        if (typeof body.preset !== 'string') throw new RequestError('請指定 preset');
        const r = setPreset(ctx.toolHome, body.preset, { opacity: str(body.opacity), blur: str(body.blur), tint: str(body.tint), mode: str(body.mode), wsl });
        return { ok: true, action, config: r.config, file: r.file, mirror: r.mirror, warnings: r.warnings };
      }
      case 'set': {
        if (typeof body.imagePath !== 'string') throw new RequestError('請指定 imagePath');
        const r = setBackground(ctx.toolHome, body.imagePath, {
          opacity: str(body.opacity),
          blur: str(body.blur),
          tint: str(body.tint),
          mode: str(body.mode),
          size: str(body.size),
          position: str(body.position),
          wsl,
        });
        return { ok: true, action, config: r.config, file: r.file, mirror: r.mirror, warnings: r.warnings };
      }
      case 'on':
      case 'off': {
        const r = setBackgroundEnabled(ctx.toolHome, action === 'on', { wsl });
        return { ok: true, action, config: r.config, file: r.file, mirror: r.mirror, warnings: r.warnings };
      }
      case 'clear':
        return { ok: true, action, removed: clearBackground(ctx.toolHome, { wsl }), warnings: [] };
      default:
        throw new RequestError('action 必須是 preset、set、on、off 或 clear');
    }
  } catch (e) {
    if (e instanceof BackgroundError) throw new RequestError(e.message);
    throw e;
  }
}

// ── 全域規則 ──────────────────────────────────────────

export function runRules(ctx: ActionContext, body: Record<string, unknown>): { ok: boolean; action: string; result: unknown; status: RulesFileStatus[] } {
  const action = body.action;
  if (action === 'install') {
    const lang = typeof body.lang === 'string' ? normalizeLang(body.lang) : 'zh-TW';
    if (!lang) throw new RequestError('lang 必須是 zh-TW 或 zh-CN');
    try {
      const result = installRules(ctx.userHome, lang, { force: body.force === true });
      return { ok: true, action, result, status: rulesStatus(ctx.userHome) };
    } catch (e) {
      throw new RequestError((e as Error).message, 409);
    }
  }
  if (action === 'remove') {
    const lang = typeof body.lang === 'string' ? normalizeLang(body.lang) ?? undefined : undefined;
    const result = removeRules(ctx.userHome, lang);
    return { ok: result.skipped.length === 0, action, result, status: rulesStatus(ctx.userHome) };
  }
  throw new RequestError('action 必須是 install 或 remove');
}
