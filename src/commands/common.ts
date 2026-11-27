import os from 'node:os';
import pc from 'picocolors';
import { detectTarget, toolHome, type PathEnv } from '../config/paths.js';
import { normalizeLang } from '../core/locales.js';
import { TARGET_IDS, type ApplyLang, type DetectedTarget, type Lang, type TargetId, type TargetSelector } from '../types.js';

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function parseLang(input: string | undefined, required = true): Lang | undefined {
  if (input === undefined) {
    if (required) throw new CliError('請以 --lang 指定語系：zh-TW、zh-CN、ja 或 ko');
    return undefined;
  }
  const lang = normalizeLang(input);
  if (!lang) throw new CliError(`不支援的語系「${input}」，可用值：zh-TW、zh-CN、ja、ko`);
  return lang;
}

/** apply 用：除了 zh-TW / zh-CN / ja / ko，也接受 none（僅背景模式） */
export function parseApplyLang(input: string | undefined): ApplyLang {
  if (input !== undefined && input.trim().toLowerCase() === 'none') return 'none';
  if (input === undefined) throw new CliError('請以 --lang 指定語系：zh-TW、zh-CN、ja、ko，或 none（僅背景模式）');
  const lang = normalizeLang(input);
  if (!lang) throw new CliError(`不支援的語系「${input}」，可用值：zh-TW、zh-CN、ja、ko、none（僅背景模式）`);
  return lang;
}

/** manifest 語系的顯示名稱 */
export function langLabel(lang: ApplyLang): string {
  return lang === 'none' ? '僅背景模式（none）' : lang;
}

export function parseTargets(input: string | undefined): { selector: TargetSelector; ids: TargetId[] } {
  const v = (input ?? 'all').toLowerCase();
  if (v === 'all') return { selector: 'all', ids: [...TARGET_IDS] };
  if ((TARGET_IDS as readonly string[]).includes(v)) return { selector: v as TargetId, ids: [v as TargetId] };
  throw new CliError(`不支援的目標「${input}」，可用值：app、ide、cli、all`);
}

export interface Resolved {
  id: TargetId;
  target: DetectedTarget | null;
}

export function resolveTargets(ids: TargetId[], customPath?: string, pathEnv?: PathEnv): Resolved[] {
  if (customPath && ids.length > 1) {
    throw new CliError('使用 --path 時必須以 --target 指定單一目標（app、ide 或 cli）');
  }
  return ids.map((id) => ({ id, target: detectTarget(id, { customPath, pathEnv }) }));
}

export function getToolHome(): string {
  return toolHome();
}

export function userHome(custom?: string): string {
  return custom ?? os.homedir();
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export const sym = {
  ok: pc.green('✔'),
  warn: pc.yellow('⚠'),
  fail: pc.red('✖'),
  info: pc.cyan('ℹ'),
  dot: pc.dim('•'),
};

export function warn(msg: string): void {
  console.log(`  ${sym.warn} ${pc.yellow(msg)}`);
}
