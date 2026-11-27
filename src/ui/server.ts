import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { RequestError, collectStatus, runApply, runBg, runBgUpload, runRestore, runRules, toFriendly, type ActionContext } from './actions.js';
import { MAX_IMAGE_BYTES } from '../core/background.js';
import { renderUiHtml } from './html.js';
import { HOOK_VERSION } from '../core/runtime.js';

/**
 * 零依賴的本機圖形控制台（只用 node:http / node:crypto）。
 *
 * 安全設計：
 * - 只監聽 127.0.0.1，絕不綁 0.0.0.0
 * - **所有**請求都檢查 `Host` 必須是 `127.0.0.1:<port>`（含首頁，防止 DNS rebinding 讀到 Token）
 * - 有 `Origin` 時必須是 `http://127.0.0.1:<port>`
 * - 每次啟動產生隨機 32-byte hex Token，內嵌在首頁；**所有** `/api/*` 都必須帶正確的
 *   `X-AGI18N-Token` header（以 timingSafeEqual 比對），否則一律 403
 * - 自訂 header 會觸發 CORS 預檢，而 server 不回應任何 CORS header，跨站請求無法帶上 Token
 * - 首頁以帶 nonce 的 CSP 限制腳本來源，並禁止被嵌入 iframe
 */

export const UI_HOST = '127.0.0.1';
export const TOKEN_HEADER = 'x-agi18n-token';
const MAX_BODY = 1024 * 1024;

export interface UiServerOptions extends ActionContext {
  /** 0 表示由系統挑選可用埠 */
  port?: number;
  /** 測試用：指定 Token */
  token?: string;
}

export interface UiServer {
  host: typeof UI_HOST;
  port: number;
  url: string;
  token: string;
  server: http.Server;
  /** server 關閉後 resolve（含透過 POST /api/shutdown 關閉） */
  closed: Promise<void>;
  close(): Promise<void>;
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const isText = typeof body === 'string';
  const data = isText ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isText ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(data);
}

function tokenMatches(given: string | string[] | undefined, token: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 超過上限的請求：回應 413 後關閉連線（不再讀取剩餘內容） */
class TooLargeError extends RequestError {
  constructor(message: string) {
    super(message, 413);
  }
}

function readRaw(req: http.IncomingMessage, limit: number, tooLarge: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new TooLargeError(tooLarge));
      return;
    }
    let size = 0;
    let done = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        reject(new TooLargeError(tooLarge));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readRaw(req, MAX_BODY, '請求內容過大')).toString('utf8').trim();
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw) as unknown;
  } catch {
    throw new RequestError('請求內容不是合法的 JSON');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RequestError('請求內容必須是 JSON 物件');
  return v as Record<string, unknown>;
}

export async function startUiServer(opts: UiServerOptions): Promise<UiServer> {
  const token = opts.token ?? crypto.randomBytes(32).toString('hex');
  const ctx: ActionContext = {
    toolHome: opts.toolHome,
    userHome: opts.userHome,
    toolVersion: opts.toolVersion,
    detect: opts.detect,
    wsl: opts.wsl,
    archiver: opts.archiver,
  };
  let port = 0;
  let busy = false;
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((r) => (resolveClosed = r));

  /** apply / restore 會修改檔案：同一時間只允許一個 */
  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (busy) throw new RequestError('另一個操作正在執行，請稍候', 409);
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };

  const server = http.createServer(async (req, res) => {
    /**
     * 回應前先丟棄尚未讀取的請求 body（例如帶 body 卻被 403 拒絕的 POST），
     * 讓 keep-alive 連線維持在正確的狀態。
     */
    const reply = (status: number, payload: unknown, headers?: Record<string, string>): void => {
      if (!req.readableEnded) req.resume();
      send(res, status, payload, headers);
    };
    try {
      const expectedHost = `${UI_HOST}:${port}`;
      if (req.headers.host !== expectedHost) return reply(403, { ok: false, error: 'Host 不符' });
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://${expectedHost}`) return reply(403, { ok: false, error: 'Origin 不符' });

      const url = new URL(req.url ?? '/', `http://${expectedHost}`);
      const method = req.method ?? 'GET';

      if (url.pathname === '/' && method === 'GET') {
        const nonce = crypto.randomBytes(16).toString('base64');
        return reply(200, renderUiHtml({ token, nonce, version: ctx.toolVersion, hookVersion: HOOK_VERSION }), {
          'Content-Security-Policy': [
            "default-src 'none'",
            `script-src 'nonce-${nonce}'`,
            "style-src 'unsafe-inline'",
            "img-src 'self' data:",
            "connect-src 'self'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
          ].join('; '),
        });
      }

      if (!url.pathname.startsWith('/api/')) return reply(404, { ok: false, error: '找不到' });
      if (!tokenMatches(req.headers[TOKEN_HEADER], token)) return reply(403, { ok: false, error: 'Token 不符' });

      const route = `${method} ${url.pathname}`;
      switch (route) {
        case 'GET /api/status': {
          const paths = { app: url.searchParams.get('app') ?? undefined, ide: url.searchParams.get('ide') ?? undefined, cli: url.searchParams.get('cli') ?? undefined };
          return reply(200, { ok: true, ...(await collectStatus(ctx, paths)) });
        }
        case 'POST /api/apply': {
          const body = await readJson(req);
          return reply(200, await exclusive(() => runApply(ctx, body)));
        }
        case 'POST /api/restore': {
          const body = await readJson(req);
          return reply(200, await exclusive(() => runRestore(ctx, body)));
        }
        case 'POST /api/bg':
          return reply(200, runBg(ctx, await readJson(req)));
        case 'POST /api/bg/upload': {
          // 原始圖片位元組（不是 JSON）；參數放在 query string
          const data = await readRaw(req, MAX_IMAGE_BYTES, '圖片超過 10 MB，請選擇較小的圖片');
          return reply(200, runBgUpload(ctx, data, url.searchParams));
        }
        case 'POST /api/rules':
          return reply(200, runRules(ctx, await readJson(req)));
        case 'POST /api/shutdown':
          reply(200, { ok: true, message: '控制台已關閉' });
          setImmediate(() => void close());
          return;
        default:
          return reply(404, { ok: false, error: '找不到' });
      }
    } catch (e) {
      if (e instanceof TooLargeError) {
        // 不再讀取剩餘的上傳內容：回應後直接關閉連線
        send(res, 413, { ok: false, error: e.message }, { Connection: 'close' });
        res.on('finish', () => req.destroy());
        return;
      }
      if (e instanceof RequestError) return reply(e.status, { ok: false, error: e.message });
      return reply(500, { ok: false, error: toFriendly(e).message, detail: toFriendly(e) });
    }
  });

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= new Promise<void>((resolve) => {
      server.close(() => {
        resolveClosed();
        resolve();
      });
      server.closeAllConnections();
    });
    return closing;
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, UI_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;

  return { host: UI_HOST, port, url: `http://${UI_HOST}:${port}/`, token, server, closed, close };
}
