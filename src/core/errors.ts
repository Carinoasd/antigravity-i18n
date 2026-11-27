/**
 * 友善的檔案系統錯誤說明（CLI 與圖形控制台共用）。
 *
 * `apply` / `restore` 最常見的失敗原因是 Antigravity 仍在執行、鎖住了 `app.asar`，
 * 或安裝在需要系統管理員權限的目錄。這裡把 `EBUSY` / `EPERM` / `EACCES`
 * 轉成具體的處理步驟，不再只顯示系統錯誤碼。
 */

export const LOCK_CODES = ['EBUSY', 'EPERM', 'EACCES'] as const;
export type LockCode = (typeof LOCK_CODES)[number];

export interface FsErrorExplanation {
  code: LockCode;
  /** 一句話說明 */
  title: string;
  /** 依序執行的處理步驟 */
  steps: string[];
}

/** 帶有處理步驟的檔案鎖定／權限錯誤 */
export class FileLockError extends Error {
  readonly code: LockCode;
  readonly path: string;
  readonly steps: string[];

  constructor(code: LockCode, path: string, explanation: FsErrorExplanation, cause?: unknown) {
    super(`${explanation.title}（${code}）：${path}`);
    this.name = 'FileLockError';
    this.code = code;
    this.path = path;
    this.steps = explanation.steps;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export function isLockCode(code: unknown): code is LockCode {
  return typeof code === 'string' && (LOCK_CODES as readonly string[]).includes(code);
}

const QUIT_STEP = '完全關閉 Antigravity：關閉所有視窗，並在系統匣（Windows 右下角／macOS 選單列）的 Antigravity 圖示上按右鍵 → Quit（結束）';
const RETRY_STEP = '回到這裡重試一次（套用與還原都會先備份，重試是安全的）';

/** 依錯誤碼與平台產生處理步驟；不是鎖定／權限錯誤時回傳 null */
export function explainFsError(err: unknown, platform: NodeJS.Platform = process.platform): FsErrorExplanation | null {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (!isLockCode(code)) return null;
  const windows = platform === 'win32';

  if (code === 'EBUSY') {
    return {
      code,
      title: '檔案正被 Antigravity 使用中，無法寫入',
      steps: [QUIT_STEP, '若仍失敗：開啟工作管理員，結束所有名為 Antigravity 的處理程序', RETRY_STEP],
    };
  }
  if (windows) {
    return {
      code,
      title: code === 'EPERM' ? '檔案被鎖定或沒有寫入權限' : '沒有寫入權限',
      steps: [
        QUIT_STEP,
        '若 Antigravity 安裝在 C:\\Program Files：以「系統管理員身分」開啟終端機後再執行',
        '防毒軟體可能鎖住檔案：暫時將安裝目錄加入排除清單',
        RETRY_STEP,
      ],
    };
  }
  return {
    code,
    title: '沒有寫入權限',
    steps: [
      QUIT_STEP,
      platform === 'darwin'
        ? '安裝在 /Applications 時：改用 sudo 執行，或在「系統設定 → 隱私權與安全性 → App 管理」允許終端機修改 App'
        : '安裝在 /opt、/usr/share 等系統目錄時：改用 sudo 執行（可加上 ANTIGRAVITY_I18N_HOME 指定資料目錄）',
      '或以 --path 指向你有寫入權限的 Antigravity 安裝位置',
      RETRY_STEP,
    ],
  };
}

/** 若是鎖定／權限錯誤，包成 FileLockError；否則原樣回傳 */
export function toFriendlyError(err: unknown, path: string, platform: NodeJS.Platform = process.platform): unknown {
  if (err instanceof FileLockError) return err;
  const exp = explainFsError(err, platform);
  return exp ? new FileLockError(exp.code, path, exp, err) : err;
}

/** 多行文字格式（CLI 用） */
export function formatFsError(err: unknown, platform: NodeJS.Platform = process.platform): string {
  if (err instanceof FileLockError) {
    return [err.message, '處理方式：', ...err.steps.map((s, i) => `  ${i + 1}. ${s}`)].join('\n');
  }
  const exp = explainFsError(err, platform);
  if (exp) {
    const where = (err as NodeJS.ErrnoException).path;
    return [`${exp.title}（${exp.code}）${where ? `：${where}` : ''}`, '處理方式：', ...exp.steps.map((s, i) => `  ${i + 1}. ${s}`)].join('\n');
  }
  return err instanceof Error ? err.message : String(err);
}
