/**
 * WebUI static server.
 *
 * Serves out/renderer/ as the SPA and reverse-proxies /api/*, /ws, /login and
 * /logout to aioncore. /login and /logout are aionui-auth's top-level paths,
 * the rest live under /api/auth/*.
 *
 * Credential verification lives in the backend's aionui-auth crate, but that
 * backend runs in --local mode (no per-request auth on protected /api/* routes),
 * so a LAN-exposed (allowRemote) proxy MUST gate backend access itself — see
 * webui-auth-gate.ts. Loopback-only deployments keep the backend's trust model.
 *
 * Design: Node native http + serve-handler. No Express. No business routes.
 */

import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { networkInterfaces } from 'node:os';
import net, { type Socket } from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import bcrypt from 'bcryptjs';
import serveHandler from 'serve-handler';
import { handleDownloadGet, handleDownloadsList } from './downloads.js';
import { handleAppDownloadGet, handleAppDownloadsList, handleAppstoreList } from './app-downloads.js';
import {
  handleSharedCategories,
  handleSharedDownload,
  handleSharedList,
  handleSharedPreview,
  handleSharedRemove,
  handleSharedUpload,
} from './shared-drive.js';
import {
  handleContentAssetArchive,
  handleContentAssetDownload,
  handleContentAssetPreview,
  handleContentAssetPublishToNas,
  handleContentAssetsList,
  handleContentAssetUpload,
} from './content-assets.js';
import {
  handleNasDownload,
  handleNasList,
  handleNasMkdir,
  handleNasMove,
  handleNasPreview,
  handleNasRemove,
  handleNasUpload,
} from './nas-drive.js';
import { handleImageWorkbenchProxy, handleImageWorkbenchStatic, handleComfyUIProxy } from './image-workbench.js';
import {
  GATE_COOKIE_NAME,
  type AuthGate,
  type AuthGateIdentity,
  createAuthGate,
  parseCookie,
} from './webui-auth-gate.js';
import { createEntryGuard, type EntryGuard } from './entry-html-guard.js';
import { createVectorUploadPayloadFromFile } from './vector-upload.js';
import { createConversationTenantBoundary, isConversationTenantHttpRequest } from './conversation-tenancy.js';
import { proxyTenantWebSocket } from './tenant-websocket.js';
import { safeFileResponseHeaders, safeInlineContentType } from './safe-preview.js';
import type { ImageWorkbenchConfig } from './types.js';

export type StaticServerOptions = {
  staticDir: string;
  backendPort: number;
  port?: number;
  allowRemote?: boolean;
  /**
   * Directory holding bundled native client installers, served at
   * /api/downloads/*. Omit to disable the download endpoints (list returns []).
   */
  installerDir?: string;
  /**
   * Directory hosting the enterprise LAN shared library, served at
   * /api/shared-drive/*. Omit to disable sharing (list returns []).
   */
  sharedDriveDir?: string;
  /**
   * Directory hosting the AI generated asset registry. Omit to disable the
   * generated-assets endpoints (list returns []).
   */
  contentAssetsDir?: string;
  /**
   * Root of the enterprise LAN network drive (the company's large shared disk),
   * browsed read-only at /api/nas/*. Omit to disable (list returns []).
   */
  nasRootDir?: string;
  /**
   * Directory holding the image workbench SPA dist, served to browser/LAN users
   * at /workbench/image/*. Defaults to `<staticDir>/centaur-image-workbench`
   * (where the desktop build copies it); set explicitly for tests.
   */
  imageWorkbenchDir?: string;
  /** Admin-owned image workbench config shared with LAN users via server proxy. */
  imageWorkbenchConfig?: ImageWorkbenchConfig;
  /** Optional runtime resolver so admin config changes apply without restarting WebUI. */
  imageWorkbenchConfigResolver?: () => Promise<ImageWorkbenchConfig | undefined>;
  /**
   * Server-held API key for the image workbench's upstream model API, injected
   * by the /workbench/image/__proxy/* reverse proxy so it never reaches the
   * browser. Omit to pass the client's Authorization through instead.
   */
  imageKey?: string;
  /**
   * When true, return 403 for the aioncore team/meeting API (`/api/teams*`).
   * Set by the Team edition: 智囊团 (decision meetings) is removed from the Team
   * product, but the bundled backend still exposes the route — this blocks LAN
   * employees from running a meeting by calling the API directly. The boss's
   * Decision box talks to the backend over IPC, not through this proxy.
   */
  blockTeamRoutes?: boolean;
  /** Backend/user data directory. Used for admin audit logs. */
  dataDir?: string;
  /**
   * Server-owned vector DB origin. Browser-supplied endpoint values are only
   * accepted when they exactly match this origin. Defaults to loopback:8619.
   */
  vectorEndpoint?: string;
  /** Explicit administrator opt-in for plaintext HTTP to a non-loopback vector origin. */
  allowInsecureVectorEndpoint?: boolean;
};

export type StaticServerHandle = {
  port: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
  /** Read-only health of the SPA entry document (for the remote-access UI). */
  inspectEntry: EntryGuard['inspect'];
  /** Force a check + heal of the entry document; returns the resulting health. */
  repairEntry: EntryGuard['repair'];
  /** Immediately revoke every active LAN session belonging to a backend user. */
  revokeUserSessions: (userId: string) => number;
};

const DEFAULT_PORT = 25808;
const AUTH_REQUEST_MAX_BYTES = 64 * 1024;
const AUTH_RESPONSE_MAX_BYTES = 1024 * 1024;
const AUTH_PROXY_TIMEOUT_MS = 15_000;

/**
 * Assistant ids that are desktop/admin-only and must not be exposed to WebUI
 * browser clients. The CentaurAI 管家 (butler) can mutate global config via its
 * config skill, so — like admin model management — it is hidden from the WebUI,
 * preserving the "admin manages, WebUI users read-only" split. Desktop talks to
 * the backend directly (not through this proxy), so it still sees the butler.
 */
const ADMIN_ONLY_ASSISTANT_IDS = new Set<string>(['centaurai-butler']);

function getLanIP(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

function forwardToBackend(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

type AuthUser = {
  id: string;
  username?: string;
};

type AuthUserEnvelope = {
  success?: boolean;
  user?: Partial<AuthUser> | null;
  data?: Partial<AuthUser> | { user?: Partial<AuthUser> | null } | null;
};

function sendJsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function sendApiBuffer(res: ServerResponse, status: number, body: Buffer | string): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function normalizeAuthUser(value: unknown): AuthGateIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<AuthUser>;
  const userId = typeof record.id === 'string' ? record.id.trim() : '';
  if (!userId) return null;
  const username = typeof record.username === 'string' && record.username.trim() ? record.username.trim() : undefined;
  return { userId, username };
}

function extractAuthIdentityFromBody(body: Buffer): AuthGateIdentity | null {
  try {
    const json = JSON.parse(body.toString('utf-8')) as AuthUserEnvelope;
    const direct = normalizeAuthUser(json.user);
    if (direct) return direct;
    if (json.data && typeof json.data === 'object') {
      const fromData = normalizeAuthUser(json.data);
      if (fromData) return fromData;
      return normalizeAuthUser((json.data as { user?: unknown }).user);
    }
  } catch {
    // Non-JSON login response. The backend set-cookie still gets forwarded.
  }
  return null;
}

function setCookieHeaderToCookie(setCookie: string | string[] | number | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [String(setCookie)] : [];
  return list
    .map((item) => item.split(';')[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ');
}

function mergeCookieHeaders(existing: string | undefined, addition: string): string {
  const parts = [existing, addition].filter((item): item is string => Boolean(item && item.trim()));
  return parts.join('; ');
}

async function fetchBackendCurrentUser(backendPort: number, cookieHeader?: string): Promise<AuthGateIdentity | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${backendPort}/api/auth/user`, {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as AuthUserEnvelope;
    return normalizeAuthUser(json.user) ?? normalizeAuthUser(json.data);
  } catch {
    return null;
  }
}

/**
 * Proxy `POST /login` to the backend and, on a 2xx response, mint the gate
 * session cookie alongside whatever the backend set. The backend's login
 * handler verifies the WebUI password even under `--local`, so a non-2xx means
 * bad credentials and we mint nothing.
 */
function proxyLoginWithGate(req: IncomingMessage, res: ServerResponse, gate: AuthGate, backendPort: number): void {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > AUTH_REQUEST_MAX_BYTES) {
    req.resume();
    sendJsonResponse(res, 413, { success: false, error: 'AUTH_REQUEST_TOO_LARGE' });
    return;
  }
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${backendPort}`, 'accept-encoding': 'identity' },
  };
  let terminal = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let upstreamResponse: IncomingMessage | null = null;
  let proxy: ReturnType<typeof http.request>;
  const finish = (): void => {
    if (deadline) clearTimeout(deadline);
    deadline = undefined;
  };
  const fail = (status: number, error: string): void => {
    if (terminal) return;
    terminal = true;
    finish();
    proxy?.destroy();
    upstreamResponse?.destroy();
    req.resume();
    if (!res.headersSent) sendJsonResponse(res, status, { success: false, error });
    else res.destroy();
  };

  proxy = http.request(options, (proxyRes) => {
    upstreamResponse = proxyRes;
    const headers = { ...proxyRes.headers };
    const status = proxyRes.statusCode ?? 502;
    const chunks: Buffer[] = [];
    let responseBytes = 0;
    proxyRes.on('data', (chunk: Buffer) => {
      if (terminal) return;
      responseBytes += chunk.length;
      if (responseBytes > AUTH_RESPONSE_MAX_BYTES) {
        fail(502, 'AUTH_RESPONSE_TOO_LARGE');
        return;
      }
      chunks.push(chunk);
    });
    proxyRes.on('end', () => {
      if (terminal) return;
      void (async () => {
        const body = Buffer.concat(chunks);
        if (status >= 200 && status < 300) {
          const existing = headers['set-cookie'];
          const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
          const responseCookies = setCookieHeaderToCookie(existing);
          const identity =
            extractAuthIdentityFromBody(body) ??
            (await fetchBackendCurrentUser(
              backendPort,
              mergeCookieHeaders(
                Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie,
                responseCookies
              )
            ));
          if (!identity) {
            fail(502, 'AUTH_IDENTITY_UNAVAILABLE');
            return;
          }
          const gateCookie = gate.mintCookie(identity);
          const gateToken = parseCookie(gateCookie, GATE_COOKIE_NAME);
          if (!gateToken) {
            fail(502, 'AUTH_SESSION_UNAVAILABLE');
            return;
          }
          headers['set-cookie'] = [...list, gateCookie];
          headers['x-webui-gate-token'] = gateToken;
          headers['access-control-expose-headers'] = appendCsvHeader(headers['access-control-expose-headers'], [
            'X-WebUI-Gate-Token',
          ]);
        }
        terminal = true;
        finish();
        headers['content-type'] = 'application/json; charset=utf-8';
        headers['cache-control'] = 'no-store';
        headers['x-content-type-options'] = 'nosniff';
        headers['content-length'] = String(Buffer.byteLength(body));
        delete headers['content-encoding'];
        delete headers['transfer-encoding'];
        res.writeHead(status, headers);
        res.end(body);
      })().catch(() => {
        fail(502, 'BACKEND_UNREACHABLE');
      });
    });
  });
  proxy.on('error', () => fail(502, 'BACKEND_UNREACHABLE'));
  deadline = setTimeout(() => fail(504, 'AUTH_TIMEOUT'), AUTH_PROXY_TIMEOUT_MS);

  let requestBytes = 0;
  req.on('data', (chunk: Buffer) => {
    if (terminal) return;
    requestBytes += chunk.length;
    if (requestBytes > AUTH_REQUEST_MAX_BYTES) {
      fail(413, 'AUTH_REQUEST_TOO_LARGE');
      return;
    }
    if (!proxy.write(chunk)) req.pause();
  });
  proxy.on('drain', () => req.resume());
  req.on('end', () => {
    if (!terminal) proxy.end();
  });
  req.on('aborted', () => {
    if (terminal) return;
    terminal = true;
    finish();
    proxy.destroy();
    upstreamResponse?.destroy();
  });
  req.on('error', () => {
    if (terminal) return;
    terminal = true;
    finish();
    proxy.destroy();
    upstreamResponse?.destroy();
  });
}

function appendCsvHeader(value: string | string[] | number | undefined, additions: string[]): string {
  const existing = Array.isArray(value) ? value.join(',') : value === undefined ? '' : String(value);
  const parts = new Set(
    existing
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
  for (const addition of additions) parts.add(addition);
  return [...parts].join(', ');
}

function requestGateToken(req: IncomingMessage): string | undefined {
  const header = req.headers['x-webui-gate-token'];
  if (Array.isArray(header)) return header[0];
  return header;
}

function isGateAuthorized(gate: AuthGate, req: IncomingMessage): boolean {
  return gate.isAuthorized(req.headers.cookie) || gate.isAuthorizedToken(requestGateToken(req));
}

function requestPathFromUrl(url: string): string {
  return (url.split('?')[0] || '/').split('#')[0];
}

/**
 * Canonicalise a URL path for security-policy checks. Decode more than once so
 * percent-encoded spellings cannot cross the WebHost/backend parsing boundary
 * and turn a permitted-looking path into an internal route downstream.
 */
function canonicalSecurityPath(url: string): string | null {
  let value: string;
  try {
    value = new URL(url, 'http://localhost').pathname;
    for (let i = 0; i < 3; i += 1) {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    }
  } catch {
    return null;
  }
  return value
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
}

function pathHasUnsafeSyntax(value: string): boolean {
  if (value.includes('\\') || value.includes('\0') || value.includes('//')) return true;
  return value.split('/').some((segment) => segment === '.' || segment === '..');
}

/**
 * Reject ambiguous API paths before the auth gate or any special dispatcher.
 * Node's outbound http client normalises dot segments, so forwarding a raw
 * `/api/downloads/../fs/read` would otherwise turn an anonymous download route
 * into an authenticated-looking filesystem request at the backend.
 */
function isHazardousApiPath(url: string): boolean {
  const rawPath = (url.split('?')[0] || '/').split('#')[0];
  let value = rawPath;
  let isApi = /^\/api(?:\/|$)/i.test(value);
  for (let i = 0; i < 3; i += 1) {
    const looksLikeApi = isApi || /^\/api(?:%|\\|\/|$)/i.test(value);
    if (pathHasUnsafeSyntax(value) || /%(?:2f|5c|00)/i.test(value)) return looksLikeApi;
    const segments = value.split('/');
    // Static top-level route names must not be encoded. Dynamic IDs live in
    // later segments and remain valid unless they encode a path delimiter.
    if (isApi && segments[2]?.includes('%')) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return isApi;
    }
    if (decoded === value) break;
    value = decoded;
    isApi ||= /^\/api(?:\/|$)/i.test(value);
  }
  return isApi && pathHasUnsafeSyntax(value);
}

const PRIVATE_LAN_SKILL_ROUTES = [
  '/api/skills/assistant-rule/write',
  '/api/skills/assistant-skill/write',
  '/api/skills/import',
  '/api/skills/import-symlink',
  '/api/skills/scan',
  '/api/skills/external-paths',
  '/api/skills/market/enable',
  '/api/skills/market/disable',
];

const PRIVATE_LAN_ROUTE_PREFIXES = [
  '/api/mcp',
  '/api/remote-agents',
  '/api/cron',
  '/api/channel',
  '/api/system',
  '/api/extensions',
  '/api/document',
  '/api/ppt-preview',
  '/api/word-preview',
  '/api/excel-preview',
  '/api/preview-history',
  '/api/star-office',
  '/api/ppt-proxy',
  '/api/office-watch-proxy',
];
const ADMIN_MUTATION_ROUTE_PREFIXES = ['/api/assistants', '/api/agents', '/api/hub'];

/** Backend routes intended only for the Electron main process / local CLI. */
function isPrivateLanBackendRoute(url: string, method = 'GET'): boolean {
  const pathname = canonicalSecurityPath(url);
  if (!pathname) return true;
  const mutation = method !== 'GET' && method !== 'HEAD';
  return (
    pathname === '/api/auth/internal' ||
    pathname.startsWith('/api/auth/internal/') ||
    pathname === '/api/webui' ||
    pathname.startsWith('/api/webui/') ||
    pathname.startsWith('/api/assistants/') ||
    pathname === '/api/agents/custom' ||
    pathname.startsWith('/api/agents/custom/') ||
    pathname === '/api/agents/health-check' ||
    pathname === '/api/agents/provider-health-check' ||
    pathname === '/api/shell' ||
    pathname.startsWith('/api/shell/') ||
    pathname === '/api/fs' ||
    pathname.startsWith('/api/fs/') ||
    PRIVATE_LAN_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`)) ||
    (mutation &&
      ADMIN_MUTATION_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) ||
    ((method === 'DELETE' || method === 'PUT' || method === 'PATCH') &&
      (pathname === '/api/skills' || pathname.startsWith('/api/skills/'))) ||
    PRIVATE_LAN_SKILL_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  );
}

/**
 * Authentication routes that a browser really needs. Other `/api/auth/*`
 * routes must be added deliberately instead of falling through the generic
 * local-mode backend proxy.
 */
function isAllowedLanAuthRoute(url: string): boolean {
  const pathname = canonicalSecurityPath(url);
  return (
    pathname === '/api/auth/status' ||
    pathname === '/api/auth/csrf-token' ||
    pathname === '/api/auth/user' ||
    pathname === '/api/auth/logout'
  );
}

/**
 * The LAN WebHost must be an allowlist boundary, not a best-effort blocklist.
 * Every authenticated browser API with host privileges is dispatched by an
 * explicit handler above. Only these two bootstrap reads still need the plain
 * backend proxy; an unknown/new aioncore route must never become remotely
 * reachable merely because it was added to the bundled backend.
 */
function isAllowedLanGenericBackendRoute(url: string, method: string): boolean {
  if (method !== 'GET') return false;
  const pathname = canonicalSecurityPath(url);
  return pathname === '/api/auth/status' || pathname === '/api/auth/csrf-token';
}

async function resolveRequestIdentity(
  gate: AuthGate,
  req: IncomingMessage,
  backendPort: number,
  requireAuth: boolean
): Promise<AuthGateIdentity | null> {
  const tokenIdentity =
    gate.getAuthorizedIdentity(req.headers.cookie) ?? gate.getAuthorizedTokenIdentity(requestGateToken(req));
  if (tokenIdentity) return tokenIdentity;

  const cookie = Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie;
  const backendIdentity = await fetchBackendCurrentUser(backendPort, cookie);
  if (backendIdentity) return backendIdentity;

  if (!requireAuth) {
    return { userId: 'system_default_user', username: 'admin' };
  }
  return null;
}

/**
 * Enforce the WebUI auth gate for LAN-exposed deployments. Returns true when the
 * response was fully handled (the caller must then stop processing the request).
 *
 * Reachable without a session: `POST /login` (mints a session on success),
 * `GET /api/auth/status` (lets the app decide whether to show login/setup),
 * `GET /api/auth/csrf-token` (needed before logging in) and `/api/downloads/*`
 * (public client installers). Everything else under `/api/*` requires a valid
 * session; `/logout` additionally clears it. Static assets are never gated, so
 * the login page itself always loads.
 */
function enforceGate(req: IncomingMessage, res: ServerResponse, gate: AuthGate, backendPort: number): boolean {
  const requestPath = canonicalSecurityPath(req.url ?? '') ?? '';

  if (req.method === 'POST' && requestPath === '/login') {
    proxyLoginWithGate(req, res, gate, backendPort);
    return true;
  }
  if (requestPath === '/logout' || requestPath === '/api/auth/logout') {
    // Revoke either transport (both normally carry the same token) immediately
    // so logout remains effective even if the backend is down.
    gate.revokeCookie(req.headers.cookie);
    gate.revokeToken(requestGateToken(req));
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: backendPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
    };
    const proxy = http.request(options, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      const existing = headers['set-cookie'];
      const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
      headers['set-cookie'] = [...list, gate.clearCookie()];
      res.writeHead(proxyRes.statusCode ?? 502, headers);
      proxyRes.pipe(res);
    });
    proxy.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
      } else {
        res.destroy();
      }
    });
    req.pipe(proxy);
    return true;
  }
  // Bootstrap endpoints reachable before a session exists.
  if (req.method === 'GET' && requestPath === '/api/auth/status') return false;
  if (req.method === 'GET' && requestPath === '/api/auth/csrf-token') return false;
  if (requestPath.startsWith('/api/downloads/')) return false;

  const isApi = requestPath === '/api' || requestPath.startsWith('/api/');
  if (isApi && !isGateAuthorized(gate, req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'UNAUTHENTICATED' }));
    return true;
  }
  return false;
}

/**
 * Read a single header value (case-insensitive) from a raw HTTP request head.
 * Used by the WS-upgrade path, which splices raw TCP and never builds an
 * `IncomingMessage`.
 */
function rawHeader(head: Buffer, name: string): string | undefined {
  const text = head.toString('latin1');
  const end = text.indexOf('\r\n\r\n');
  const headerBlock = end >= 0 ? text.slice(0, end) : text;
  const lower = name.toLowerCase();
  for (const line of headerBlock.split('\r\n').slice(1)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() === lower) return line.slice(colon + 1).trim();
  }
  return undefined;
}

function rawGateToken(head: Buffer): string | undefined {
  const fromHeader = rawHeader(head, 'x-webui-gate-token');
  if (fromHeader) return fromHeader;

  const newlineIdx = head.indexOf(0x0a);
  if (newlineIdx < 0) return undefined;
  const firstLine = head.slice(0, newlineIdx).toString('ascii');
  const match = /^GET\s+([^\s]+)\s+HTTP\/1\.[01]\r?$/.exec(firstLine);
  if (!match) return undefined;
  try {
    return new URL(match[1] ?? '/', 'http://127.0.0.1').searchParams.get('gate') ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Proxy `GET /api/assistants` but strip desktop/admin-only assistants
 * ({@link ADMIN_ONLY_ASSISTANT_IDS}) from the JSON before returning it to a
 * WebUI client. Accept-encoding is forced to identity so the body is plain JSON
 * to rewrite; on any non-JSON/parse failure the original bytes pass through.
 */
function proxyAssistantsFiltered(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${backendPort}`, 'accept-encoding': 'identity' },
  };
  const proxy = http.request(options, (proxyRes) => {
    const chunks: Buffer[] = [];
    proxyRes.on('data', (c: Buffer) => chunks.push(c));
    proxyRes.on('end', () => {
      const status = proxyRes.statusCode ?? 502;
      const headers = { ...proxyRes.headers };
      // We send a fixed buffer with our own Content-Length, so drop any framing
      // headers from the upstream response (chunked + length can't coexist).
      delete headers['content-length'];
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];
      let body = Buffer.concat(chunks);
      if (status >= 200 && status < 300) {
        try {
          const parsed = JSON.parse(body.toString('utf-8')) as unknown;
          // LAN authentication must not make the entire catalog disappear.
          // Assistant definitions are read-only through WebHost; only the
          // desktop/admin-only butlers are hidden. Runtime creation remains
          // independently constrained by the conversation tenant boundary.
          const keep = (a: unknown): boolean => !ADMIN_ONLY_ASSISTANT_IDS.has((a as { id?: string })?.id ?? '');
          if (Array.isArray(parsed)) {
            body = Buffer.from(JSON.stringify(parsed.filter(keep)), 'utf-8');
          } else if (parsed && typeof parsed === 'object') {
            const json = parsed as { success?: unknown; data?: unknown };
            if (Array.isArray(json.data)) {
              body = Buffer.from(JSON.stringify({ success: json.success, data: json.data.filter(keep) }), 'utf-8');
            } else if (json.data && Array.isArray((json.data as { items?: unknown[] }).items)) {
              body = Buffer.from(
                JSON.stringify({
                  success: json.success,
                  data: { items: (json.data as { items: unknown[] }).items.filter(keep) },
                }),
                'utf-8'
              );
            } else {
              throw new Error('unexpected assistants response');
            }
          } else {
            throw new Error('unexpected assistants response');
          }
        } catch {
          body = Buffer.from(JSON.stringify({ error: 'INVALID_BACKEND_RESPONSE' }), 'utf-8');
          res.writeHead(502, {
            ...headers,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          });
          res.end(body);
          return;
        }
      }
      res.writeHead(status, { ...headers, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

const LAN_AGENT_FIELDS = new Set([
  'id',
  'icon',
  'name',
  'name_i18n',
  'description',
  'description_i18n',
  'backend',
  'agent_type',
  'agent_source',
  'enabled',
  'available',
  'installed',
  'status',
  'team_capable',
  'behavior_policy',
  'yolo_id',
  'handshake',
  'config_options',
  'available_modes',
  'available_models',
  'available_commands',
]);

function projectLanAgent(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || !input.id) return null;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (!LAN_AGENT_FIELDS.has(key)) continue;
    if (key === 'handshake' && child && typeof child === 'object' && !Array.isArray(child)) {
      const handshake = child as Record<string, unknown>;
      output.handshake = stripSensitiveFields({
        agent_capabilities: handshake.agent_capabilities,
        available_modes: handshake.available_modes,
        available_models: handshake.available_models,
        available_commands: handshake.available_commands,
      });
      continue;
    }
    output[key] = stripSensitiveFields(child);
  }
  return output;
}

function projectLanAgentPayload(value: unknown): unknown | null {
  const projectList = (items: unknown[]): Record<string, unknown>[] =>
    items.map(projectLanAgent).filter((item): item is Record<string, unknown> => item !== null);
  if (Array.isArray(value)) return projectList(value);
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (Array.isArray(input.data)) return { success: input.success, data: projectList(input.data) };
  if (input.data && typeof input.data === 'object' && Array.isArray((input.data as { items?: unknown }).items)) {
    return {
      success: input.success,
      data: { items: projectList((input.data as { items: unknown[] }).items) },
    };
  }
  return null;
}

/** Return only runtime-selection metadata; never process commands, env or host paths. */
function proxyAgentsSanitized(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
  const proxy = http.request(
    {
      hostname: '127.0.0.1',
      port: backendPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${backendPort}`, 'accept-encoding': 'identity' },
    },
    (proxyRes) => {
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        const status = proxyRes.statusCode ?? 502;
        const headers = { ...proxyRes.headers };
        delete headers['content-length'];
        delete headers['content-encoding'];
        delete headers['transfer-encoding'];
        let body = Buffer.concat(chunks);
        if (status >= 200 && status < 300) {
          try {
            const projected = projectLanAgentPayload(JSON.parse(body.toString('utf-8')));
            if (!projected) throw new Error('unexpected agents response');
            body = Buffer.from(JSON.stringify(projected), 'utf-8');
          } catch {
            body = Buffer.from(JSON.stringify({ error: 'INVALID_BACKEND_RESPONSE' }), 'utf-8');
            res.writeHead(502, {
              ...headers,
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
            });
            res.end(body);
            return;
          }
        }
        res.writeHead(status, { ...headers, 'content-length': Buffer.byteLength(body) });
        res.end(body);
      });
    }
  );
  proxy.on('error', () => {
    if (!res.headersSent) sendJsonResponse(res, 502, { error: 'BACKEND_UNREACHABLE' });
    else res.destroy();
  });
  req.pipe(proxy);
}

function isSensitiveFieldName(key: string): boolean {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    compact === 'env' ||
    compact === 'headers' ||
    compact === 'originaljson' ||
    compact === 'profile' ||
    compact.includes('apikey') ||
    compact.includes('secret') ||
    compact.includes('token') ||
    compact.includes('password') ||
    compact.includes('authorization') ||
    compact.includes('cookie') ||
    compact.includes('privatekey') ||
    compact.includes('accesskey') ||
    compact.includes('credential')
  );
}

function stripSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitiveFields);
  if (!value || typeof value !== 'object') return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  let hasCredentials = false;
  for (const [key, child] of Object.entries(input)) {
    if (key === 'api_key' || key === 'apiKey') {
      const hasKey = typeof child === 'string' && child.trim().length > 0;
      output[key] = '';
      output[key === 'api_key' ? 'has_api_key' : 'hasApiKey'] = hasKey;
      continue;
    }
    if (isSensitiveFieldName(key)) {
      hasCredentials ||= child !== undefined && child !== null && child !== '';
      continue;
    }
    output[key] = stripSensitiveFields(child);
  }
  if (hasCredentials) output.has_credentials = true;
  return output;
}

const LAN_PROVIDER_FIELDS = new Set([
  'id',
  'platform',
  'name',
  'base_url',
  'models',
  'capabilities',
  'context_limit',
  'model_protocols',
  'enabled',
  'model_enabled',
  'model_health',
  'is_full_url',
]);

function publicProviderBaseUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.username = '';
    parsed.password = '';
    // Query strings on provider endpoints frequently carry deployment keys or
    // signed routing tokens. LAN clients select the provider by id/model and do
    // not need those server-owned URL decorations.
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function projectLanProvider(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || !input.id) return null;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (!LAN_PROVIDER_FIELDS.has(key)) continue;
    if (key === 'base_url' && typeof child === 'string') {
      const safeUrl = publicProviderBaseUrl(child);
      if (safeUrl) output[key] = safeUrl;
      continue;
    }
    output[key] = stripSensitiveFields(child);
  }
  const apiKey = typeof input.api_key === 'string' ? input.api_key : '';
  output.api_key = '';
  output.has_api_key = apiKey.trim().length > 0;
  if (input.bedrock_config && typeof input.bedrock_config === 'object' && !Array.isArray(input.bedrock_config)) {
    const bedrock = input.bedrock_config as Record<string, unknown>;
    output.bedrock_config = {
      auth_method: bedrock.auth_method,
      region: bedrock.region,
      has_credentials: Boolean(bedrock.access_key_id || bedrock.secret_access_key || bedrock.profile),
    };
  }
  return output;
}

function projectLanProviderPayload(value: unknown): unknown | null {
  const projectList = (items: unknown[]): Record<string, unknown>[] =>
    items.map(projectLanProvider).filter((item): item is Record<string, unknown> => item !== null);
  if (Array.isArray(value)) return projectList(value);
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (Array.isArray(input.data)) return { success: input.success, data: projectList(input.data) };
  if (input.data && typeof input.data === 'object') {
    if (Array.isArray((input.data as { items?: unknown }).items)) {
      return {
        success: input.success,
        data: { items: projectList((input.data as { items: unknown[] }).items) },
      };
    }
    const provider = projectLanProvider(input.data);
    if (provider) return { success: input.success, data: provider };
  }
  return projectLanProvider(input);
}

const LAN_SAFE_SETTING_KEYS = new Set([
  'language',
  'theme',
  'colorScheme',
  'ui.zoomFactor',
  'ui.fontSize.chat',
  'ui.fontSize.markdown',
  'ui.fontSize.code',
  'customCss',
  'css.themes',
  'css.activeThemeId',
  'theme.activeId',
  'theme.userThemes',
  'aionrs.config',
  'aionrs.defaultModel',
  'tools.imageGenerationModel',
  'tools.imageGenerationModels',
  'workspace.pasteConfirm',
  'upload.saveToWorkspace',
  'guid.lastSelectedAgent',
  'system.closeToTray',
  'system.notificationEnabled',
  'system.cronNotificationEnabled',
  'system.keepAwake',
  'system.autoPreviewOfficeFiles',
  // Legacy aliases still queried by older WebUI renderers.
  'notificationEnabled',
  'cronNotificationEnabled',
  'keepAwake',
  'saveUploadToWorkspace',
  'autoPreviewOfficeFiles',
  'assistant.telegram.defaultModel',
  'assistant.telegram.agent',
  'assistant.lark.defaultModel',
  'assistant.lark.agent',
  'assistant.dingtalk.defaultModel',
  'assistant.dingtalk.agent',
  'assistant.weixin.defaultModel',
  'assistant.weixin.agent',
  'assistant.wecom.defaultModel',
  'assistant.wecom.agent',
  'skillsMarket.enabled',
  'pet.enabled',
  'pet.size',
  'pet.dnd',
  'pet.confirmEnabled',
  'vectorDB.enabled',
  'vectorDB.endpoint',
  'vectorDB.searchCount',
  'vectorDB.searchMode',
]);

function projectLanSettingsRecord(
  value: unknown,
  vectorEndpoint: TrustedVectorEndpoint
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (LAN_SAFE_SETTING_KEYS.has(key)) output[key] = stripSensitiveFields(child);
  }
  output['vectorDB.endpoint'] = vectorEndpoint;
  return output;
}

function projectLanSettings(value: unknown, vectorEndpoint: TrustedVectorEndpoint): unknown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if ('data' in input) {
    const data = projectLanSettingsRecord(input.data, vectorEndpoint);
    if (!data) return null;
    return { success: input.success, data };
  }
  return projectLanSettingsRecord(input, vectorEndpoint);
}

function requestedClientSettingKey(req: IncomingMessage): string | null {
  return new URL(req.url || '/', 'http://localhost').searchParams.get('key');
}

function projectRequestedLanSetting(
  value: unknown,
  key: string,
  vectorEndpoint: TrustedVectorEndpoint
): unknown | null {
  if (!LAN_SAFE_SETTING_KEYS.has(key)) return null;
  const projectValue = (settingValue: unknown): unknown =>
    key === 'vectorDB.endpoint' ? vectorEndpoint : stripSensitiveFields(settingValue);
  if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
    const input = value as Record<string, unknown>;
    return { success: input.success, data: projectValue(input.data) };
  }
  return projectValue(value);
}

/**
 * Proxy provider reads for WebUI/browser clients without exposing stored API
 * keys. Desktop renderers bypass WebHost and still talk to the backend directly.
 */
function proxyProvidersSanitized(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${backendPort}`, 'accept-encoding': 'identity' },
  };
  const proxy = http.request(options, (proxyRes) => {
    const chunks: Buffer[] = [];
    proxyRes.on('data', (c: Buffer) => chunks.push(c));
    proxyRes.on('end', () => {
      const status = proxyRes.statusCode ?? 502;
      const headers = { ...proxyRes.headers };
      delete headers['content-length'];
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];

      let body = Buffer.concat(chunks);
      if (status >= 200 && status < 300) {
        try {
          const projected = projectLanProviderPayload(JSON.parse(body.toString('utf-8')));
          if (!projected) throw new Error('unexpected provider response');
          body = Buffer.from(JSON.stringify(projected), 'utf-8');
        } catch {
          body = Buffer.from(JSON.stringify({ error: 'INVALID_BACKEND_RESPONSE' }), 'utf-8');
          res.writeHead(502, {
            ...headers,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          });
          res.end(body);
          return;
        }
      }
      res.writeHead(status, { ...headers, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

/**
 * Proxy client settings to WebUI/browser clients without exposing secrets that
 * live in admin-owned settings blobs (for example the shared image workbench
 * profile synced from the desktop image app).
 */
function proxySettingsSanitized(
  req: IncomingMessage,
  res: ServerResponse,
  backendPort: number,
  vectorEndpoint: TrustedVectorEndpoint
): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${backendPort}`, 'accept-encoding': 'identity' },
  };
  const proxy = http.request(options, (proxyRes) => {
    const chunks: Buffer[] = [];
    proxyRes.on('data', (c: Buffer) => chunks.push(c));
    proxyRes.on('end', () => {
      const status = proxyRes.statusCode ?? 502;
      const headers = { ...proxyRes.headers };
      delete headers['content-length'];
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];

      let body = Buffer.concat(chunks);
      if (status >= 200 && status < 300) {
        try {
          const parsed = JSON.parse(body.toString('utf-8')) as unknown;
          const requestedKey = requestedClientSettingKey(req);
          const projected = requestedKey
            ? projectRequestedLanSetting(parsed, requestedKey, vectorEndpoint)
            : projectLanSettings(parsed, vectorEndpoint);
          if (!projected) throw new Error('unexpected settings response');
          body = Buffer.from(JSON.stringify(projected), 'utf-8');
        } catch {
          body = Buffer.from(JSON.stringify({ error: 'INVALID_BACKEND_RESPONSE' }), 'utf-8');
          res.writeHead(502, {
            ...headers,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          });
          res.end(body);
          return;
        }
      }
      res.writeHead(status, { ...headers, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Search queries are tiny; cap the body so a stray large POST can't buffer unbounded.
    if (size > 256 * 1024) throw new Error('vector-search body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

declare const trustedVectorEndpointBrand: unique symbol;
type TrustedVectorEndpoint = string & { readonly [trustedVectorEndpointBrand]: true };

const DEFAULT_VECTOR_ENDPOINT = 'http://127.0.0.1:8619' as TrustedVectorEndpoint;
const VECTOR_REQUEST_TIMEOUT_MS = 15_000;
const VECTOR_UPLOAD_TIMEOUT_MS = 120_000;
const VECTOR_JSON_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const VECTOR_IMAGE_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const ACCOUNT_PROFILE_BLOCK_RE = /<!-- centaurai-account-profile\n([\s\S]*?)\n-->/;
const ADMIN_USER_ID = 'system_default_user';

type AccountProfile = {
  displayName?: string;
  avatar?: string;
  realName?: string;
  bio?: string;
  department?: string;
  title?: string;
  responsibilities?: string;
  routineWork?: string;
  aiName?: string;
  responseStyle?: string;
  language?: string;
  outputFormat?: string;
  memoryNotes?: string;
};

type MemorySearchItem = {
  rel_path?: string;
  path?: string;
  source_path?: string;
  metadata?: { rel_path?: string; path?: string; source_path?: string };
};

type LanUserRecord = {
  id: string;
  username: string;
  created_at?: unknown;
  last_login?: unknown;
};

type MemoryFileRecord = {
  path?: string;
  size?: number;
  updated_at?: string;
};

function normalizeVectorEndpoint(value: string): TrustedVectorEndpoint | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    return parsed.origin as TrustedVectorEndpoint;
  } catch {
    return null;
  }
}

function isLoopbackVectorEndpoint(endpoint: TrustedVectorEndpoint): boolean {
  const hostname = new URL(endpoint).hostname.toLowerCase();
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
}

function endpointFromRequest(
  req: IncomingMessage,
  body: Record<string, unknown> | undefined,
  allowedEndpoint: TrustedVectorEndpoint
): TrustedVectorEndpoint | null {
  const query = new URL(req.url || '/', 'http://localhost').searchParams.get('endpoint');
  const requested =
    typeof body?.endpoint === 'string' ? body.endpoint.trim() : typeof query === 'string' ? query.trim() : '';
  if (!requested) return allowedEndpoint;
  const normalized = normalizeVectorEndpoint(requested);
  return normalized === allowedEndpoint ? allowedEndpoint : null;
}

function safeUserPathSegment(userId: string): string {
  return encodeURIComponent(userId.trim()).replace(/%/g, '_');
}

function encodeMemoryPath(relPath: string): string {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

function normalizeRequestedMemoryPath(rawPath: string): string {
  return decodeURIComponent(rawPath).replace(/^\/+/, '').replace(/\\/g, '/');
}

function memoryScopeFromRequest(req: IncomingMessage): string {
  const scope = new URL(req.url || '/', 'http://localhost').searchParams.get('scope')?.trim().toLowerCase() || '';
  return ['auto', 'visible', 'personal', 'shared', 'all'].includes(scope) ? scope : 'auto';
}

function memoryApiPath(apiPath: string, scope?: string): string {
  if (!scope || scope === 'auto') return apiPath;
  return `${apiPath}${apiPath.includes('?') ? '&' : '?'}scope=${encodeURIComponent(scope)}`;
}

function isSafeMemoryRelPath(relPath: string): boolean {
  if (!relPath || relPath.startsWith('/') || relPath.includes('\\') || relPath.includes('\0')) return false;
  return !relPath.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

function scopedMemoryPath(userId: string, requestedPath: string, scope = 'auto'): string | null {
  const relPath = normalizeRequestedMemoryPath(requestedPath);
  if (!isSafeMemoryRelPath(relPath) || relPath.startsWith('users/')) return null;
  if (scope === 'shared') return isSharedMemoryPath(relPath) ? relPath : null;
  const userPrefix = `users/${safeUserPathSegment(userId)}`;
  if (relPath === 'USER.md' || relPath === 'MEMORY.md') return `${userPrefix}/${relPath}`;
  if (relPath.startsWith('journal/') && relPath.endsWith('.md')) return `${userPrefix}/${relPath}`;
  if (userId === ADMIN_USER_ID && isLegacyImportedMemoryPath(relPath)) return relPath;
  if (relPath === 'AGENTS.md' || relPath.startsWith('company/') || relPath.startsWith('shared/')) return relPath;
  return `${userPrefix}/${relPath}`;
}

function userMemoryPath(userId: string, file: 'USER.md' | 'MEMORY.md'): string {
  return `users/${safeUserPathSegment(userId)}/${file}`;
}

function memoryItemRelPath(item: MemorySearchItem): string {
  return (
    item.rel_path ||
    item.metadata?.rel_path ||
    item.path ||
    item.metadata?.path ||
    item.source_path ||
    item.metadata?.source_path ||
    ''
  );
}

function isLegacyImportedMemoryPath(relPath: string): boolean {
  return relPath.startsWith('imports/') && relPath.endsWith('.md') && !relPath.includes('..');
}

function isLegacyJournalPath(relPath: string): boolean {
  return relPath.startsWith('journal/') && relPath.endsWith('.md') && !relPath.includes('..');
}

function isSharedMemoryPath(relPath: string): boolean {
  if (!isSafeMemoryRelPath(relPath)) return false;
  return (
    relPath === 'AGENTS.md' ||
    relPath === 'USER.md' ||
    relPath === 'MEMORY.md' ||
    relPath.startsWith('company/') ||
    relPath.startsWith('shared/') ||
    isLegacyImportedMemoryPath(relPath) ||
    isLegacyJournalPath(relPath)
  );
}

function isVisibleMemoryItem(item: MemorySearchItem, userId: string): boolean {
  const relPath = memoryItemRelPath(item).replace(/\\/g, '/');
  if (!isSafeMemoryRelPath(relPath)) return false;
  const userPrefix = `users/${safeUserPathSegment(userId)}/`;
  return relPath.startsWith(userPrefix) || isSharedMemoryPath(relPath);
}

function canMutateScopedMemoryPath(identity: AuthGateIdentity, relPath: string): boolean {
  if (identity.userId === ADMIN_USER_ID) return true;
  return relPath.startsWith(`users/${safeUserPathSegment(identity.userId)}/`);
}

function applyVectorIdentityHeaders(
  headers: Record<string, string>,
  identity: AuthGateIdentity | undefined,
  endpoint: TrustedVectorEndpoint
): void {
  if (!identity) return;
  headers['X-CentaurAI-User-Id'] = identity.userId;
  if (identity.username) headers['X-CentaurAI-Username'] = identity.username;
  headers['X-CentaurAI-Role'] = identity.userId === ADMIN_USER_ID ? 'admin' : 'user';

  // `endpoint` is branded only after exact comparison with the server-owned
  // configured origin. This credential must never be attached to a raw client
  // URL, including through redirects (all vector fetches use redirect:error).
  const proxyToken = process.env.VDB_TRUSTED_PROXY_TOKEN || process.env.CENTAURAI_VDB_TRUSTED_PROXY_TOKEN;
  if (proxyToken && normalizeVectorEndpoint(endpoint) === endpoint) {
    headers['X-CentaurAI-Proxy-Token'] = proxyToken;
  }
}

class VectorResponseTooLargeError extends Error {}

async function readResponseBufferLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new VectorResponseTooLargeError('vector DB response exceeds limit');
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- a response stream is inherently sequential
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // eslint-disable-next-line no-await-in-loop -- cancellation must finish before releasing the reader lock
        await reader.cancel().catch(() => {});
        throw new VectorResponseTooLargeError('vector DB response exceeds limit');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function fetchVector(
  endpoint: TrustedVectorEndpoint,
  apiPath: string,
  init: RequestInit = {},
  timeoutMs = VECTOR_REQUEST_TIMEOUT_MS
): Promise<Response> {
  if (!apiPath.startsWith('/')) throw new Error('vector API path must be absolute');
  return fetch(`${endpoint}${apiPath}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function vectorJson(
  endpoint: TrustedVectorEndpoint,
  apiPath: string,
  init?: { method?: string; body?: unknown; requestedBy?: boolean; identity?: AuthGateIdentity }
): Promise<{ status: number; body: unknown; text: string }> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  if (init?.requestedBy) headers['X-Requested-By'] = 'centaur-vdb';
  applyVectorIdentityHeaders(headers, init?.identity, endpoint);
  const upstream = await fetchVector(endpoint, apiPath, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = (await readResponseBufferLimited(upstream, VECTOR_JSON_MAX_RESPONSE_BYTES)).toString('utf-8');
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // Keep the raw text for non-JSON upstream errors.
  }
  return {
    status: upstream.status,
    body: parsed,
    text,
  };
}

async function readMemoryDocument(
  endpoint: TrustedVectorEndpoint,
  relPath: string,
  identity?: AuthGateIdentity
): Promise<{ content: string; updatedAt?: string }> {
  const result = await vectorJson(endpoint, `/api/memory/files/${encodeMemoryPath(relPath)}`, { identity });
  if (result.status === 404) return { content: '' };
  if (result.status < 200 || result.status >= 300) throw new Error(`memory read failed (${result.status})`);
  const body = result.body as { content?: unknown; updated_at?: unknown };
  return {
    content: typeof body.content === 'string' ? body.content : '',
    updatedAt: typeof body.updated_at === 'string' ? body.updated_at : undefined,
  };
}

async function writeMemoryDocument(
  endpoint: TrustedVectorEndpoint,
  relPath: string,
  content: string,
  sourceAgent: string,
  identity?: AuthGateIdentity
): Promise<unknown> {
  const result = await vectorJson(endpoint, `/api/memory/files/${encodeMemoryPath(relPath)}`, {
    method: 'PUT',
    requestedBy: true,
    identity,
    body: { content, source_agent: sourceAgent },
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`memory write failed (${result.status})`);
  return result.body;
}

async function deleteMemoryDocument(
  endpoint: TrustedVectorEndpoint,
  relPath: string,
  identity?: AuthGateIdentity
): Promise<void> {
  const result = await vectorJson(endpoint, `/api/memory/files/${encodeMemoryPath(relPath)}`, {
    method: 'DELETE',
    requestedBy: true,
    identity,
  });
  if (result.status !== 404 && (result.status < 200 || result.status >= 300)) {
    throw new Error(`memory delete failed (${result.status})`);
  }
}

function profileFromMarkdown(content: string): AccountProfile {
  const match = ACCOUNT_PROFILE_BLOCK_RE.exec(content);
  if (!match?.[1]) return {};
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const profile: AccountProfile = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        profile[key as keyof AccountProfile] = value;
      }
    }
    return profile;
  } catch {
    return {};
  }
}

function markdownLine(label: string, value: string | undefined): string {
  return `- ${label}: ${value?.trim() || ''}`;
}

function buildUserMarkdown(profile: AccountProfile, username?: string): string {
  const json = JSON.stringify(profile, null, 2);
  return [
    '# USER.md — 个人身份',
    '',
    '<!-- centaurai-account-profile',
    json,
    '-->',
    '',
    '## 账号信息',
    '',
    markdownLine('用户名', username),
    '',
    '## 工作身份',
    '',
    markdownLine('名称', profile.realName || profile.displayName),
    '',
    '### 个人简介',
    '',
    profile.bio?.trim() || profile.responsibilities?.trim() || profile.routineWork?.trim() || '',
    '',
    '## AI 偏好',
    '',
    markdownLine('AI 称呼', profile.aiName),
    markdownLine('回答风格', profile.responseStyle),
    markdownLine('常用语言', profile.language),
    markdownLine('输出格式偏好', profile.outputFormat),
    '',
  ].join('\n');
}

function buildMemoryMarkdown(profile: AccountProfile): string {
  return [
    '# MEMORY.md — 个人长期记忆',
    '',
    '## 需要长期记住的注意事项',
    '',
    profile.memoryNotes?.trim() || '',
    '',
  ].join('\n');
}

function mergeProfileFromBody(body: Record<string, unknown>): AccountProfile {
  const raw = body.profile && typeof body.profile === 'object' ? (body.profile as Record<string, unknown>) : {};
  const profile: AccountProfile = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      profile[key as keyof AccountProfile] = value;
    }
  }
  return profile;
}

async function readAccountProfile(
  endpoint: TrustedVectorEndpoint,
  userId: string,
  identity?: AuthGateIdentity
): Promise<{
  profile: AccountProfile;
  userMarkdown: string;
  memoryMarkdown: string;
  updatedAt?: string;
}> {
  const [userResult, memoryResult] = await Promise.allSettled([
    readMemoryDocument(endpoint, userMemoryPath(userId, 'USER.md'), identity),
    readMemoryDocument(endpoint, userMemoryPath(userId, 'MEMORY.md'), identity),
  ]);
  const userDoc = userResult.status === 'fulfilled' ? userResult.value : { content: '' };
  const memoryDoc = memoryResult.status === 'fulfilled' ? memoryResult.value : { content: '' };
  return {
    profile: profileFromMarkdown(userDoc.content),
    userMarkdown: userDoc.content,
    memoryMarkdown: memoryDoc.content,
    updatedAt: userDoc.updatedAt || memoryDoc.updatedAt,
  };
}

async function writeAccountProfile(
  endpoint: TrustedVectorEndpoint,
  identity: AuthGateIdentity,
  body: Record<string, unknown>,
  targetUserId = identity.userId
): Promise<void> {
  const profile = mergeProfileFromBody(body);
  const userMarkdown =
    typeof body.userMarkdown === 'string' ? body.userMarkdown : buildUserMarkdown(profile, identity.username);
  const memoryMarkdown = typeof body.memoryMarkdown === 'string' ? body.memoryMarkdown : buildMemoryMarkdown(profile);
  await Promise.all([
    writeMemoryDocument(endpoint, userMemoryPath(targetUserId, 'USER.md'), userMarkdown, 'centaurai-account', identity),
    writeMemoryDocument(
      endpoint,
      userMemoryPath(targetUserId, 'MEMORY.md'),
      memoryMarkdown,
      'centaurai-account',
      identity
    ),
  ]);
}

async function appendMemoryAudit(
  dataDir: string | undefined,
  actor: AuthGateIdentity,
  targetUserId: string,
  action: string
): Promise<void> {
  if (!dataDir) return;
  const record = {
    ts: new Date().toISOString(),
    actor_user_id: actor.userId,
    actor_username: actor.username,
    target_user_id: targetUserId,
    action,
  };
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.appendFile(path.join(dataDir, 'memory-audit.ndjson'), `${JSON.stringify(record)}\n`, 'utf-8');
  } catch {
    // Audit failure must not expose data or break an admin recovery path.
  }
}

async function fetchBackendUsers(backendPort: number): Promise<LanUserRecord[]> {
  const upstream = await fetch(`http://127.0.0.1:${backendPort}/api/auth/internal/users`, {
    headers: { accept: 'application/json' },
  });
  if (!upstream.ok) throw new Error(`users returned HTTP ${upstream.status}`);
  const payload = (await upstream.json()) as { data?: unknown };
  const data = Array.isArray(payload.data) ? payload.data : [];
  const users: LanUserRecord[] = [];
  for (const item of data) {
    const raw = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const id = typeof raw.id === 'string' ? raw.id : typeof raw.user_id === 'string' ? raw.user_id : '';
    if (!id) continue;
    users.push({
      id,
      username: typeof raw.username === 'string' && raw.username ? raw.username : id,
      created_at: raw.created_at,
      last_login: raw.last_login,
    });
  }
  return users;
}

function latestMemoryUpdate(files: MemoryFileRecord[]): string {
  return (
    files
      .map((file) => file.updated_at || '')
      .filter(Boolean)
      .toSorted()
      .pop() ?? ''
  );
}

function summarizeMemoryUser(
  user: LanUserRecord,
  files: MemoryFileRecord[],
  source: 'webui' | 'memory'
): Record<string, unknown> {
  const owner = safeUserPathSegment(user.id);
  const root = `users/${owner}/`;
  const userFiles = files.filter((file) => typeof file.path === 'string' && file.path.startsWith(root));
  return {
    scope: 'personal',
    id: user.id,
    username: user.username,
    owner_user_id: owner,
    source,
    created_at: user.created_at,
    last_login: user.last_login,
    file_count: userFiles.length,
    has_user_md: userFiles.some((file) => file.path === `${root}USER.md`),
    has_memory_md: userFiles.some((file) => file.path === `${root}MEMORY.md`),
    import_count: userFiles.filter((file) => file.path?.startsWith(`${root}imports/`) && file.path.endsWith('.md'))
      .length,
    journal_count: userFiles.filter((file) => file.path?.startsWith(`${root}journal/`) && file.path.endsWith('.md'))
      .length,
    updated_at: latestMemoryUpdate(userFiles),
  };
}

function summarizeSharedMemory(files: MemoryFileRecord[]): Record<string, unknown> {
  const sharedFiles = files.filter((file) => typeof file.path === 'string' && isSharedMemoryPath(file.path));
  return {
    scope: 'shared',
    id: 'shared',
    username: '团队共享记忆',
    owner_user_id: '',
    source: 'memory',
    file_count: sharedFiles.length,
    has_user_md: sharedFiles.some((file) => file.path === 'USER.md'),
    has_memory_md: sharedFiles.some((file) => file.path === 'MEMORY.md'),
    import_count: sharedFiles.filter((file) => file.path?.startsWith('imports/') && file.path.endsWith('.md')).length,
    journal_count: sharedFiles.filter((file) => file.path?.startsWith('journal/') && file.path.endsWith('.md')).length,
    updated_at: latestMemoryUpdate(sharedFiles),
  };
}

async function handleAdminMemoryUsers(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  backendPort: number,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  if (req.method !== 'GET') {
    sendJsonResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (identity.userId !== ADMIN_USER_ID) {
    sendJsonResponse(res, 403, { error: 'FORBIDDEN' });
    return;
  }
  const endpoint = endpointFromRequest(req, undefined, allowedEndpoint);
  if (!endpoint) {
    sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
    return;
  }

  let webuiConnected = false;
  let webuiError = '';
  let lanUsers: LanUserRecord[] = [];
  try {
    lanUsers = await fetchBackendUsers(backendPort);
    webuiConnected = true;
  } catch (error) {
    webuiError = error instanceof Error ? error.message : 'load users failed';
  }

  let memoryFiles: MemoryFileRecord[] = [];
  const result = await vectorJson(endpoint, '/api/memory/files?scope=all', { identity });
  if (result.status >= 200 && result.status < 300) {
    const payload = result.body as { files?: MemoryFileRecord[] };
    memoryFiles = Array.isArray(payload.files) ? payload.files : [];
  }

  const byOwner = new Map<string, Record<string, unknown>>();
  for (const user of lanUsers) {
    const summary = summarizeMemoryUser(user, memoryFiles, 'webui');
    byOwner.set(String(summary.owner_user_id), summary);
  }
  for (const file of memoryFiles) {
    const relPath = file.path || '';
    if (!relPath.startsWith('users/')) continue;
    const owner = relPath.split('/')[1] || '';
    if (!owner || byOwner.has(owner)) continue;
    const summary = summarizeMemoryUser({ id: owner, username: owner }, memoryFiles, 'memory');
    byOwner.set(owner, summary);
  }

  const users = [...byOwner.values()].toSorted((a, b) => {
    if (a.id === ADMIN_USER_ID) return -1;
    if (b.id === ADMIN_USER_ID) return 1;
    return String(a.username || a.id).localeCompare(String(b.username || b.id), 'zh');
  });
  sendJsonResponse(res, 200, {
    users,
    shared: summarizeSharedMemory(memoryFiles),
    webui_connected: webuiConnected,
    webui_endpoint: `http://127.0.0.1:${backendPort}`,
    error: webuiError,
  });
}

async function handleScopedMemoryFile(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  let body: Record<string, unknown> | undefined;
  if (req.method === 'PUT') {
    try {
      body = await readJsonBody(req);
    } catch {
      sendJsonResponse(res, 400, { error: 'INVALID_JSON' });
      return;
    }
  }
  const endpoint = endpointFromRequest(req, body, allowedEndpoint);
  if (!endpoint) {
    sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
    return;
  }
  const scope = memoryScopeFromRequest(req);

  const rawPath = (req.url || '').split('?')[0]?.replace(/^\/api\/memory\/files\/?/, '') ?? '';
  if (!rawPath) {
    if (req.method !== 'GET') {
      sendJsonResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    const result = await vectorJson(
      endpoint,
      memoryApiPath('/api/memory/files', scope === 'auto' ? 'visible' : scope),
      {
        identity,
      }
    );
    if (result.status < 200 || result.status >= 300) {
      sendApiBuffer(res, result.status, result.text);
      return;
    }
    const payload = result.body as { files?: Array<{ path?: string }> };
    const files = (payload.files ?? []).filter((file) => {
      const item = { rel_path: file.path };
      return isVisibleMemoryItem(item, identity.userId);
    });
    sendJsonResponse(res, 200, { files });
    return;
  }

  const relPath = scopedMemoryPath(identity.userId, rawPath, scope);
  if (!relPath) {
    sendJsonResponse(res, 403, { error: 'FORBIDDEN' });
    return;
  }
  if (req.method !== 'GET' && !canMutateScopedMemoryPath(identity, relPath)) {
    sendJsonResponse(res, 403, { error: 'FORBIDDEN' });
    return;
  }

  const apiPath = memoryApiPath(`/api/memory/files/${encodeMemoryPath(relPath)}`, scope);
  if (req.method === 'GET') {
    const result = await vectorJson(endpoint, apiPath, { identity });
    if (result.status === 404) {
      sendJsonResponse(res, 404, { error: 'NOT_FOUND' });
      return;
    }
    sendApiBuffer(res, result.status, result.text);
    return;
  }

  if (req.method === 'PUT') {
    const content = typeof body?.content === 'string' ? body.content : '';
    const sourceAgent = typeof body?.source_agent === 'string' ? body.source_agent : 'centaurai-account';
    const result = await vectorJson(endpoint, apiPath, {
      method: 'PUT',
      requestedBy: true,
      identity,
      body: { content, source_agent: sourceAgent },
    });
    sendApiBuffer(res, result.status, result.text);
    return;
  }

  if (req.method === 'DELETE') {
    const result = await vectorJson(endpoint, apiPath, {
      method: 'DELETE',
      requestedBy: true,
      identity,
    });
    sendApiBuffer(res, result.status, result.text);
    return;
  }

  sendJsonResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
}

async function handleScopedJournal(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  let body: Record<string, unknown> | undefined;
  if (req.method === 'PUT') {
    try {
      body = await readJsonBody(req);
    } catch {
      sendJsonResponse(res, 400, { error: 'INVALID_JSON' });
      return;
    }
  }
  const endpoint = endpointFromRequest(req, body, allowedEndpoint);
  if (!endpoint) {
    sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
    return;
  }
  const scope = memoryScopeFromRequest(req);

  const pathOnly = (req.url || '').split('?')[0] ?? '';
  const date = pathOnly.replace(/^\/api\/memory\/journal\/?/, '');
  if (!date) {
    if (req.method !== 'GET') {
      sendJsonResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    const result = await vectorJson(
      endpoint,
      memoryApiPath('/api/memory/files', scope === 'auto' ? 'visible' : scope),
      {
        identity,
      }
    );
    if (result.status < 200 || result.status >= 300) {
      sendApiBuffer(res, result.status, result.text);
      return;
    }
    const prefix = scope === 'shared' ? 'journal/' : `users/${safeUserPathSegment(identity.userId)}/journal/`;
    const payload = result.body as { files?: Array<{ path?: string; size?: number; updated_at?: string }> };
    const journals = (payload.files ?? [])
      .filter((file) => typeof file.path === 'string' && file.path.startsWith(prefix) && file.path.endsWith('.md'))
      .map((file) => ({
        date: path.basename(file.path ?? '', '.md'),
        size: file.size,
        updated_at: file.updated_at,
      }))
      .toSorted((a, b) => b.date.localeCompare(a.date));
    sendJsonResponse(res, 200, { journals });
    return;
  }

  const normalizedDate = normalizeRequestedMemoryPath(date).replace(/\.md$/, '');
  const relPath = scopedMemoryPath(identity.userId, `journal/${normalizedDate}.md`, scope);
  if (!relPath) {
    sendJsonResponse(res, 403, { error: 'FORBIDDEN' });
    return;
  }
  if (req.method !== 'GET' && !canMutateScopedMemoryPath(identity, relPath)) {
    sendJsonResponse(res, 403, { error: 'FORBIDDEN' });
    return;
  }
  const apiPath = memoryApiPath(`/api/memory/files/${encodeMemoryPath(relPath)}`, scope);
  if (req.method === 'GET') {
    const result = await vectorJson(endpoint, apiPath, { identity });
    if (result.status === 404) {
      sendJsonResponse(res, 200, { date: normalizedDate, content: '', exists: false });
      return;
    }
    sendApiBuffer(res, result.status, result.text);
    return;
  }

  if (req.method === 'PUT') {
    const content = typeof body?.content === 'string' ? body.content : '';
    const sourceAgent = typeof body?.source_agent === 'string' ? body.source_agent : 'centaurai-account';
    const result = await vectorJson(endpoint, apiPath, {
      method: 'PUT',
      requestedBy: true,
      identity,
      body: { content, source_agent: sourceAgent },
    });
    sendApiBuffer(res, result.status, result.text);
    return;
  }

  if (req.method === 'DELETE') {
    const result = await vectorJson(endpoint, apiPath, {
      method: 'DELETE',
      requestedBy: true,
      identity,
    });
    sendApiBuffer(res, result.status, result.text);
    return;
  }

  sendJsonResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
}

async function handleScopedMemorySearch(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJsonResponse(res, 400, { error: 'INVALID_JSON' });
    return;
  }
  const endpoint = endpointFromRequest(req, body, allowedEndpoint);
  if (!endpoint) {
    sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
    return;
  }
  const query = typeof body.query === 'string' ? body.query : '';
  if (!query.trim()) {
    sendJsonResponse(res, 400, { error: 'EMPTY_QUERY' });
    return;
  }
  const requested = typeof body.n_results === 'number' && body.n_results > 0 ? Math.min(body.n_results, 20) : 10;
  const upstreamBody: Record<string, unknown> = { ...body, n_results: Math.min(requested * 5, 60) };
  delete upstreamBody.endpoint;
  const result = await vectorJson(endpoint, '/api/memory/search', {
    method: 'POST',
    identity,
    body: upstreamBody,
  });
  if (result.status < 200 || result.status >= 300) {
    sendApiBuffer(res, result.status, result.text);
    return;
  }
  const parsed = result.body as { results?: MemorySearchItem[] };
  const results = (parsed.results ?? [])
    .filter((item) => isVisibleMemoryItem(item, identity.userId))
    .slice(0, requested);
  sendJsonResponse(res, 200, { ...parsed, results, total: results.length });
}

async function handleAccountProfile(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  if (req.method === 'GET') {
    const endpoint = endpointFromRequest(req, undefined, allowedEndpoint);
    if (!endpoint) {
      sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
      return;
    }
    const data = await readAccountProfile(endpoint, identity.userId, identity);
    sendJsonResponse(res, 200, {
      user: { id: identity.userId, username: identity.username },
      paths: {
        user: userMemoryPath(identity.userId, 'USER.md'),
        memory: userMemoryPath(identity.userId, 'MEMORY.md'),
      },
      ...data,
    });
    return;
  }

  if (req.method === 'PUT') {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJsonResponse(res, 400, { error: 'INVALID_JSON' });
      return;
    }
    const endpoint = endpointFromRequest(req, body, allowedEndpoint);
    if (!endpoint) {
      sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
      return;
    }
    await writeAccountProfile(endpoint, identity, body);
    sendJsonResponse(res, 200, { success: true });
    return;
  }

  sendJsonResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
}

async function handleAccountMemoryClear(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  if (req.method !== 'DELETE') {
    sendJsonResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  const endpoint = endpointFromRequest(req, undefined, allowedEndpoint);
  if (!endpoint) {
    sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
    return;
  }
  await Promise.all([
    deleteMemoryDocument(endpoint, userMemoryPath(identity.userId, 'USER.md'), identity),
    deleteMemoryDocument(endpoint, userMemoryPath(identity.userId, 'MEMORY.md'), identity),
  ]);
  sendJsonResponse(res, 200, { success: true });
}

async function handleAccountPassword(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  backendPort: number,
  gate: AuthGate
): Promise<void> {
  if (req.method !== 'POST') {
    sendJsonResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJsonResponse(res, 400, { error: 'INVALID_JSON' });
    return;
  }
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';
  if (newPassword.length < 6) {
    sendJsonResponse(res, 400, { error: 'PASSWORD_TOO_SHORT' });
    return;
  }
  const passwordHash = bcrypt.hashSync(newPassword, 12);
  const upstream = await fetch(
    `http://127.0.0.1:${backendPort}/api/auth/internal/users/${encodeURIComponent(identity.userId)}/password`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password_hash: passwordHash }),
    }
  );
  if (!upstream.ok) {
    const text = await upstream.text();
    sendApiBuffer(res, upstream.status, text);
    return;
  }
  gate.revokeUserSessions(identity.userId);
  sendJsonResponse(res, 200, { success: true });
}

function parseAdminMemoryRoute(req: IncomingMessage): { targetUserId: string; action: 'profile' } | null {
  const pathOnly = (req.url || '').split('?')[0] ?? '';
  const match = /^\/api\/memory\/users\/([^/]+)\/profile$/.exec(pathOnly);
  if (!match?.[1]) return null;
  return { targetUserId: decodeURIComponent(match[1]), action: 'profile' };
}

async function handleAdminMemoryUserRoute(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  opts: Pick<StaticServerOptions, 'dataDir'>,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  const route = parseAdminMemoryRoute(req);
  if (!route) {
    sendJsonResponse(res, 404, { error: 'NOT_FOUND' });
    return;
  }
  if (identity.userId !== ADMIN_USER_ID) {
    sendJsonResponse(res, 403, { error: 'FORBIDDEN' });
    return;
  }
  if (req.method === 'GET') {
    const endpoint = endpointFromRequest(req, undefined, allowedEndpoint);
    if (!endpoint) {
      sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
      return;
    }
    await appendMemoryAudit(opts.dataDir, identity, route.targetUserId, 'read-profile');
    sendJsonResponse(res, 200, {
      user: { id: route.targetUserId },
      ...(await readAccountProfile(endpoint, route.targetUserId, identity)),
    });
    return;
  }
  if (req.method === 'PUT') {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJsonResponse(res, 400, { error: 'INVALID_JSON' });
      return;
    }
    const endpoint = endpointFromRequest(req, body, allowedEndpoint);
    if (!endpoint) {
      sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
      return;
    }
    await writeAccountProfile(endpoint, identity, body, route.targetUserId);
    await appendMemoryAudit(opts.dataDir, identity, route.targetUserId, 'write-profile');
    sendJsonResponse(res, 200, { success: true });
    return;
  }
  sendJsonResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
}

const VECTOR_UPLOAD_MAX_BYTES = 500 * 1024 * 1024; // mirrors NAS indexing cap

function incomingHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value != null) {
      headers.set(key, String(value));
    }
  }
  return headers;
}

async function readMultipartForm(req: IncomingMessage): Promise<FormData> {
  const body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
  return new Request('http://localhost/api/vector-upload', {
    method: req.method || 'POST',
    headers: incomingHeaders(req),
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' }).formData();
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return value != null && typeof value !== 'string' && typeof value.arrayBuffer === 'function';
}

function sendVectorProxyError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const tooLarge = error instanceof VectorResponseTooLargeError;
  sendJsonResponse(res, 502, { error: tooLarge ? 'VECTOR_DB_RESPONSE_TOO_LARGE' : 'VECTOR_DB_UNREACHABLE' });
}

/** Proxy a knowledge-base search to the server-configured vector DB. */
async function handleVectorSearch(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const endpoint = endpointFromRequest(req, body, allowedEndpoint);
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!endpoint) {
      sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
      return;
    }
    if (!query) {
      sendJsonResponse(res, 400, { error: 'EMPTY_QUERY' });
      return;
    }
    if (query.length > 4_000) {
      sendJsonResponse(res, 400, { error: 'QUERY_TOO_LONG' });
      return;
    }
    const rawNResults = body.n_results;
    const nResults =
      typeof rawNResults === 'number' && Number.isFinite(rawNResults)
        ? Math.min(Math.max(Math.trunc(rawNResults), 1), 20)
        : 5;
    const mode = body.mode === 'visual' || body.mode === 'hybrid' ? body.mode : 'text';

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    applyVectorIdentityHeaders(headers, identity, endpoint);
    const upstream = await fetchVector(endpoint, '/api/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, n_results: nResults, mode }),
    });
    const responseBody = await readResponseBufferLimited(upstream, VECTOR_JSON_MAX_RESPONSE_BYTES);
    sendApiBuffer(res, upstream.status, responseBody);
  } catch (error) {
    sendVectorProxyError(res, error);
  }
}

/** Proxy a knowledge-base file upload to the local vector DB for LAN/WebUI clients. */
async function handleVectorUpload(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  if (identity.userId !== ADMIN_USER_ID) {
    sendJsonResponse(res, 403, { error: 'FORBIDDEN' });
    return;
  }
  const endpoint = endpointFromRequest(req, undefined, allowedEndpoint);
  if (!endpoint) {
    sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
    return;
  }

  let file: File;
  try {
    const form = await readMultipartForm(req);
    const value = form.get('file');
    if (!isUploadedFile(value)) {
      sendJsonResponse(res, 400, { error: 'MISSING_FILE' });
      return;
    }
    file = value;
  } catch {
    sendJsonResponse(res, 400, { error: 'INVALID_MULTIPART' });
    return;
  }

  if (file.size > VECTOR_UPLOAD_MAX_BYTES) {
    sendJsonResponse(res, 413, { error: 'FILE_TOO_LARGE' });
    return;
  }

  let upload;
  try {
    upload = await createVectorUploadPayloadFromFile(file);
  } catch {
    sendJsonResponse(res, 422, { error: 'PPTX_PARSE_FAILED' });
    return;
  }

  try {
    const form = new FormData();
    form.append('file', upload.blob, upload.filename);
    const headers: Record<string, string> = { 'X-Requested-By': 'centaur-vdb' };
    applyVectorIdentityHeaders(headers, identity, endpoint);
    const upstream = await fetchVector(
      endpoint,
      '/api/upload',
      {
        method: 'POST',
        headers,
        body: form,
      },
      VECTOR_UPLOAD_TIMEOUT_MS
    );
    const responseBody = await readResponseBufferLimited(upstream, VECTOR_JSON_MAX_RESPONSE_BYTES);
    sendApiBuffer(res, upstream.status, responseBody);
  } catch (error) {
    sendVectorProxyError(res, error);
  }
}

/** Proxy knowledge-base document list/delete requests to the local vector DB. */
async function handleVectorDocuments(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const endpoint = endpointFromRequest(req, body, allowedEndpoint);
    if (!endpoint) {
      sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
      return;
    }
    const action = typeof body.action === 'string' ? body.action : 'list';
    if (action === 'delete') {
      if (identity.userId !== ADMIN_USER_ID) {
        sendJsonResponse(res, 403, { error: 'FORBIDDEN' });
        return;
      }
      const docId = typeof body.docId === 'string' ? body.docId.trim() : '';
      if (!docId) {
        sendJsonResponse(res, 400, { error: 'INVALID_DOCUMENT_ID' });
        return;
      }
      const headers: Record<string, string> = { 'X-Requested-By': 'centaur-vdb' };
      applyVectorIdentityHeaders(headers, identity, endpoint);
      const upstream = await fetchVector(endpoint, `/api/documents/${encodeURIComponent(docId)}`, {
        method: 'DELETE',
        headers,
      });
      const responseBody = await readResponseBufferLimited(upstream, VECTOR_JSON_MAX_RESPONSE_BYTES);
      sendApiBuffer(res, upstream.status, responseBody);
      return;
    }
    if (action !== 'list') {
      sendJsonResponse(res, 400, { error: 'INVALID_ACTION' });
      return;
    }
    const rawLimit = body.limit;
    const rawOffset = body.offset;
    const limit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500)
        : 300;
    const offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
    const headers: Record<string, string> = {};
    applyVectorIdentityHeaders(headers, identity, endpoint);
    const upstream = await fetchVector(endpoint, `/api/documents?limit=${limit}&offset=${offset}`, { headers });
    const responseBody = await readResponseBufferLimited(upstream, VECTOR_JSON_MAX_RESPONSE_BYTES);
    sendApiBuffer(res, upstream.status, responseBody);
  } catch (error) {
    sendVectorProxyError(res, error);
  }
}

/** Return vector DB health and collection statistics without exposing its loopback origin. */
async function handleVectorStatus(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  const endpoint = endpointFromRequest(req, undefined, allowedEndpoint);
  if (!endpoint) {
    sendJsonResponse(res, 400, { error: 'INVALID_ENDPOINT' });
    return;
  }

  try {
    const [health, stats] = await Promise.all([
      vectorJson(endpoint, '/api/health', { identity }),
      vectorJson(endpoint, '/api/stats', { identity }),
    ]);
    if (health.status < 200 || health.status >= 300 || stats.status < 200 || stats.status >= 300) {
      sendJsonResponse(res, 502, { error: 'VECTOR_DB_UNHEALTHY' });
      return;
    }
    sendJsonResponse(res, 200, { health: health.body, stats: stats.body });
  } catch (error) {
    sendVectorProxyError(res, error);
  }
}

/** Proxy a knowledge-base image thumbnail to the local vector DB's /api/image. */
async function handleVectorImage(
  req: IncomingMessage,
  res: ServerResponse,
  identity: AuthGateIdentity,
  allowedEndpoint: TrustedVectorEndpoint
): Promise<void> {
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const endpoint = endpointFromRequest(req, undefined, allowedEndpoint);
    const imagePath = url.searchParams.get('path') || '';
    if (!endpoint || !imagePath) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'INVALID_REQUEST' }));
      return;
    }
    const headers: Record<string, string> = {};
    applyVectorIdentityHeaders(headers, identity, endpoint);
    const upstream = await fetchVector(endpoint, `/api/image?path=${encodeURIComponent(imagePath)}`, { headers });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel().catch(() => {});
      res.writeHead(upstream.status || 502).end();
      return;
    }
    const buf = await readResponseBufferLimited(upstream, VECTOR_IMAGE_MAX_RESPONSE_BYTES);
    const upstreamContentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': safeInlineContentType(upstreamContentType),
      ...safeFileResponseHeaders(true),
    });
    res.end(buf);
  } catch (error) {
    sendVectorProxyError(res, error);
  }
}

// Max bytes we peek before forcing a routing decision. An HTTP request-line
// on its own is typically < 100 bytes; a full header block is < 2 KB. If we
// haven't seen a newline after 4 KB the client is sending something weird —
// hand it to the internal HTTP server and let it return 400.
const PEEK_LIMIT_BYTES = 4096;
/** Bound unauthenticated sockets that have not even completed a request line. */
const INITIAL_PEEK_TIMEOUT_MS = 10_000;
/** Last-resort FD/memory bound for a LAN client opening many idle sockets. */
const MAX_FRONTEND_CONNECTIONS = 512;

/**
 * Splice `client` to a TCP endpoint on `targetPort`. Any bytes already read
 * from `client` during peek are replayed to the upstream as the first write,
 * so the endpoint sees the full HTTP request as-sent.
 */
function spliceToTcpEndpoint(client: Socket, targetPort: number, initialBytes: Buffer): void {
  client.setNoDelay(true);
  client.setKeepAlive(true);
  client.setTimeout(0);
  // Pause synchronously: the peek loop just removed its 'data' listener, so
  // without this any body bytes arriving before `connect` (below) fires would
  // be emitted to no consumer and lost. Pausing buffers them in the socket;
  // `client.pipe(upstream)` resumes delivery once upstream is ready. Only large
  // POST bodies (split across TCP reads) hit this — small ones fit in the peek.
  client.pause();
  const upstream = net.connect({ host: '127.0.0.1', port: targetPort });
  upstream.setNoDelay(true);
  upstream.setKeepAlive(true);
  upstream.once('connect', () => {
    if (initialBytes.length > 0) upstream.write(initialBytes);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const tearDown = (): void => {
    client.destroy();
    upstream.destroy();
  };
  upstream.on('error', tearDown);
  client.on('error', tearDown);
  upstream.on('close', tearDown);
  client.on('close', tearDown);
}

/**
 * Decide routing from the first chunk of an incoming HTTP connection:
 *  - `true`  → `GET /ws[...] HTTP/1.x` (WebSocket upgrade), splice to backend
 *  - `false` → any other HTTP method / path, hand to internal HTTP server
 *  - `null`  → need more bytes (no CRLF yet)
 *
 * We only check the request-line; `Upgrade: websocket` is not strictly
 * required — the backend will reject a non-upgrade `GET /ws` on its own.
 * Keeping the rule simple means we can decide after the first ~50 bytes
 * instead of waiting for the full header block.
 */
function peekWsRoute(buf: Buffer): boolean | null {
  const newlineIdx = buf.indexOf(0x0a); // \n
  if (newlineIdx < 0) return null;
  const firstLine = buf.slice(0, newlineIdx).toString('ascii');
  return /^GET\s+\/ws(?:\?[^\s]*)?\s+HTTP\/1\.[01]\r?$/.test(firstLine);
}

export async function startStaticServer(opts: StaticServerOptions): Promise<StaticServerHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const allowRemote = opts.allowRemote === true;
  const host = allowRemote ? '0.0.0.0' : '127.0.0.1';
  const vectorEndpoint = normalizeVectorEndpoint(
    opts.vectorEndpoint ??
      process.env.AIONUI_VECTOR_DB_ENDPOINT ??
      process.env.CENTAURAI_VECTOR_DB_ENDPOINT ??
      DEFAULT_VECTOR_ENDPOINT
  );
  if (!vectorEndpoint) {
    throw new Error('vectorEndpoint must be an http(s) origin without credentials, path, query or fragment');
  }
  const allowInsecureVectorEndpoint =
    opts.allowInsecureVectorEndpoint ??
    /^(?:1|true|yes)$/i.test(process.env.AIONUI_ALLOW_INSECURE_VECTOR_ENDPOINT ?? '');
  if (
    new URL(vectorEndpoint).protocol !== 'https:' &&
    !isLoopbackVectorEndpoint(vectorEndpoint) &&
    !allowInsecureVectorEndpoint
  ) {
    throw new Error(
      'non-loopback vectorEndpoint must use https (set AIONUI_ALLOW_INSECURE_VECTOR_ENDPOINT=1 to opt in)'
    );
  }

  // When the WebUI is exposed beyond loopback, the reverse proxy is the trust
  // boundary: the backend runs in --local mode and does not authenticate
  // /api/* itself, so we gate every backend-bound request behind a WebUI login.
  // Loopback-only deployments keep the existing (backend-trusted) behavior.
  const requireAuth = allowRemote;
  const gate = createAuthGate();
  const conversationTenantBoundary = requireAuth
    ? await createConversationTenantBoundary({ backendPort: opts.backendPort, dataDir: opts.dataDir })
    : null;

  // The image workbench SPA dist lives under the served static dir by default
  // (the desktop build copies it to out/renderer/centaur-image-workbench).
  const imageWorkbenchDir = opts.imageWorkbenchDir ?? path.join(opts.staticDir, 'centaur-image-workbench');
  const fallbackImageWorkbenchConfig =
    opts.imageWorkbenchConfig ?? (opts.imageKey ? { apiKey: opts.imageKey } : undefined);
  const resolveImageWorkbenchConfig = async (): Promise<ImageWorkbenchConfig | undefined> => {
    if (!opts.imageWorkbenchConfigResolver) return fallbackImageWorkbenchConfig;
    try {
      return (await opts.imageWorkbenchConfigResolver()) ?? fallbackImageWorkbenchConfig;
    } catch (error) {
      console.error('[WebUI] Failed to resolve image workbench config:', error);
      return fallbackImageWorkbenchConfig;
    }
  };

  // Self-healing guard for the SPA entry document. The WebUI is the only way LAN
  // users reach the app and it always serves staticDir/index.html; an empty or
  // truncated index.html (seen intermittently from the build) would otherwise
  // hand every LAN user a blank 200. The guard serves/restores a known-good copy
  // and falls back to a friendly recovery page instead of a blank screen.
  const entryGuard: EntryGuard = await createEntryGuard(opts.staticDir);

  // The HTTP server listens only on loopback — user traffic hits the outer
  // net.Server first. We route to this server for everything except WS
  // upgrades, which go straight to the backend via a raw TCP splice.
  //
  // Why two listeners instead of using `http.Server`'s native `upgrade` event:
  // bun 1.3's http-compat layer does not faithfully forward writes on the
  // socket delivered to the `upgrade` handler, so the backend's 101 response
  // never reaches the browser (see #2824). Making the outer listener pure
  // TCP avoids touching that code path on both bun and node.
  const http_server: Server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        res.writeHead(400).end();
        return;
      }
      if (isHazardousApiPath(req.url)) {
        sendJsonResponse(res, 400, { success: false, error: 'INVALID_PATH' });
        return;
      }
      const requestPath = canonicalSecurityPath(req.url) ?? requestPathFromUrl(req.url);

      // Auth gate (LAN-exposed only). Handles /login + /logout and rejects
      // unauthenticated /api/* before any backend-bound or local API handler.
      if (requireAuth && enforceGate(req, res, gate, opts.backendPort)) return;

      // The backend runs in local/trusted-process mode. Never let an
      // authenticated LAN browser inherit Electron-main or CLI privileges via
      // the generic proxy, and only expose the small browser auth allowlist.
      if (
        requireAuth &&
        (isPrivateLanBackendRoute(req.url, req.method) ||
          (canonicalSecurityPath(req.url)?.startsWith('/api/auth/') && !isAllowedLanAuthRoute(req.url)) ||
          (req.method !== 'GET' && requestPath === '/api/settings/client'))
      ) {
        sendJsonResponse(res, 403, { success: false, error: 'FORBIDDEN' });
        return;
      }

      // The backend runs in local mode, so its conversation/message routes do
      // not know which authenticated LAN seat made a request. Terminate those
      // routes here: WebHost stamps immutable ownership on create/clone and
      // authorizes every id-based child route before proxying it.
      if (requireAuth && conversationTenantBoundary && isConversationTenantHttpRequest(req.url)) {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          sendJsonResponse(res, 401, { success: false, error: 'UNAUTHENTICATED' });
          return;
        }
        if (await conversationTenantBoundary.handleHttpRequest(req, res, identity)) return;
      }

      // /workbench/* (browser workbench) lives outside /api/, so the
      // gate above skips it — gate it explicitly when LAN-exposed.
      if (requireAuth && req.url.startsWith('/workbench/') && !isGateAuthorized(gate, req)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'UNAUTHENTICATED' }));
        return;
      }

      // Team edition: 智囊团 (decision meetings) is a Decision-only feature. Its UI
      // is removed from the Team renderer, but the bundled aioncore still serves
      // /api/teams* — block it here so LAN employees can't run a meeting by calling
      // the API directly. (Decision uses IPC, not this proxy, so it's unaffected.)
      if (
        opts.blockTeamRoutes &&
        (req.url === '/api/teams' || req.url.startsWith('/api/teams/') || req.url.startsWith('/api/teams?'))
      ) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'EDITION_DISABLED' }));
        return;
      }

      // Hide desktop/admin-only assistants (the 管家) from WebUI browser clients.
      // Always applied in WebUI mode — the butler is desktop-only regardless of
      // LAN exposure. Desktop talks to the backend directly, bypassing this.
      if (req.method === 'GET' && (req.url === '/api/assistants' || req.url.startsWith('/api/assistants?'))) {
        proxyAssistantsFiltered(req, res, opts.backendPort);
        return;
      }

      if (
        req.method === 'GET' &&
        (req.url === '/api/agents' ||
          req.url.startsWith('/api/agents?') ||
          req.url === '/api/agents/management' ||
          req.url.startsWith('/api/agents/management?'))
      ) {
        proxyAgentsSanitized(req, res, opts.backendPort);
        return;
      }

      if (req.method === 'GET' && (req.url === '/api/settings/client' || req.url.startsWith('/api/settings/client?'))) {
        const requestedKey = requestedClientSettingKey(req);
        if (requireAuth && requestedKey && !LAN_SAFE_SETTING_KEYS.has(requestedKey)) {
          sendJsonResponse(res, 403, { success: false, error: 'FORBIDDEN' });
          return;
        }
        proxySettingsSanitized(req, res, opts.backendPort, vectorEndpoint);
        return;
      }

      // In LAN/Team mode the WebHost gate is the trusted login boundary. Return
      // that seat identity here so the SPA can render the current username even
      // when the backend is running in local/admin mode.
      if (requireAuth && req.method === 'GET' && requestPath === '/api/auth/user') {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'UNAUTHENTICATED' }));
          return;
        }
        sendJsonResponse(res, 200, {
          success: true,
          user: {
            id: identity.userId,
            username: identity.username ?? identity.userId,
          },
        });
        return;
      }

      // Provider config is admin/desktop-owned. WebUI browser clients may read
      // provider metadata, but stored API keys must not leave the server. Desktop
      // bypasses this server and still receives full provider rows from backend.
      if (
        req.method === 'GET' &&
        (req.url === '/api/providers' || req.url.startsWith('/api/providers?') || req.url.startsWith('/api/providers/'))
      ) {
        proxyProvidersSanitized(req, res, opts.backendPort);
        return;
      }
      if (
        req.method !== 'GET' &&
        (req.url === '/api/providers' || req.url.startsWith('/api/providers?') || req.url.startsWith('/api/providers/'))
      ) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'READ_ONLY' }));
        return;
      }

      // /api/account/* and /api/memory/* — current-seat identity memory.
      // These are served LOCALLY so WebUI browsers cannot forge user_id or read
      // another LAN seat's personal USER.md / MEMORY.md. The server resolves the
      // authenticated user from the gate/backend session and rewrites local-vector
      // DB paths to memory/users/{user_id}/...
      if (req.url.startsWith('/api/account/') || req.url.startsWith('/api/memory/')) {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'UNAUTHENTICATED' }));
          return;
        }

        if (req.url.startsWith('/api/account/profile')) {
          await handleAccountProfile(req, res, identity, vectorEndpoint);
          return;
        }
        if (req.url.startsWith('/api/account/memory')) {
          await handleAccountMemoryClear(req, res, identity, vectorEndpoint);
          return;
        }
        if (req.url.startsWith('/api/account/change-password')) {
          await handleAccountPassword(req, res, identity, opts.backendPort, gate);
          return;
        }
        if (req.url.startsWith('/api/memory/admin/users')) {
          await handleAdminMemoryUsers(req, res, identity, opts.backendPort, vectorEndpoint);
          return;
        }
        if (req.url.startsWith('/api/memory/users/')) {
          await handleAdminMemoryUserRoute(req, res, identity, { dataDir: opts.dataDir }, vectorEndpoint);
          return;
        }
        if (req.url.startsWith('/api/memory/files')) {
          await handleScopedMemoryFile(req, res, identity, vectorEndpoint);
          return;
        }
        if (req.url.startsWith('/api/memory/journal')) {
          await handleScopedJournal(req, res, identity, vectorEndpoint);
          return;
        }
        if (req.url.startsWith('/api/memory/search') && req.method === 'POST') {
          await handleScopedMemorySearch(req, res, identity, vectorEndpoint);
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'NOT_FOUND' }));
        return;
      }

      // /api/downloads/* — client installer downloads, served LOCALLY from the
      // bundled installer dir (NOT proxied to aioncore). Must come before the
      // generic /api/* proxy below.
      if (req.url.startsWith('/api/downloads/list')) {
        await handleDownloadsList(res, opts.installerDir);
        return;
      }
      if (req.url.startsWith('/api/downloads/get')) {
        await handleDownloadGet(req, res, opts.installerDir);
        return;
      }

      // /api/appstore/downloads/* — standalone App Store app installers, served
      // from an external admin dir. Reaches here only AFTER the auth gate (these
      // require login, unlike /api/downloads/* which is pre-login allowed).
      if (req.url.startsWith('/api/appstore/downloads/list')) {
        await handleAppDownloadsList(req, res);
        return;
      }
      if (req.url.startsWith('/api/appstore/downloads/get')) {
        await handleAppDownloadGet(req, res);
        return;
      }
      // /api/appstore/list — app catalog for LAN/WebUI browsers (ipcBridge
      // appstore.* providers live in the Electron main, unreachable from WebUI).
      if (req.url.startsWith('/api/appstore/list')) {
        await handleAppstoreList(req, res);
        return;
      }

      // /api/shared-drive/* — enterprise LAN shared library, served LOCALLY
      // (NOT proxied to aioncore). Must come before the generic /api/* proxy.
      if (req.url.startsWith('/api/shared-drive/')) {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          sendJsonResponse(res, 401, { success: false, error: 'UNAUTHENTICATED' });
          return;
        }
        const actor = {
          userId: identity.userId,
          username: identity.username,
          isAdmin: identity.userId === ADMIN_USER_ID,
        };
        if (req.url.startsWith('/api/shared-drive/list')) await handleSharedList(req, res, opts.sharedDriveDir);
        else if (req.url.startsWith('/api/shared-drive/categories'))
          await handleSharedCategories(res, opts.sharedDriveDir);
        else if (req.url.startsWith('/api/shared-drive/upload') && req.method === 'POST')
          await handleSharedUpload(req, res, opts.sharedDriveDir, actor);
        else if (req.url.startsWith('/api/shared-drive/download'))
          await handleSharedDownload(req, res, opts.sharedDriveDir);
        else if (req.url.startsWith('/api/shared-drive/preview'))
          await handleSharedPreview(req, res, opts.sharedDriveDir);
        else if (req.url.startsWith('/api/shared-drive/remove') && req.method === 'DELETE')
          await handleSharedRemove(req, res, opts.sharedDriveDir, actor);
        else {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'NOT_FOUND' }));
        }
        return;
      }

      // /api/content-assets/* — generated artifact registry, served LOCALLY
      // (NOT proxied to aioncore). This backs the AI生成 view and personal
      // generated-asset lifecycle.
      if (req.url.startsWith('/api/content-assets/')) {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          sendJsonResponse(res, 401, { success: false, error: 'UNAUTHENTICATED' });
          return;
        }
        if (req.url.startsWith('/api/content-assets/list'))
          await handleContentAssetsList(req, res, opts.contentAssetsDir, identity.userId);
        else if (req.url.startsWith('/api/content-assets/upload') && req.method === 'POST')
          await handleContentAssetUpload(req, res, opts.contentAssetsDir, identity.userId);
        else if (req.url.startsWith('/api/content-assets/archive') && req.method === 'POST')
          await handleContentAssetArchive(req, res, opts.contentAssetsDir, identity.userId);
        else if (req.url.startsWith('/api/content-assets/publish-to-nas') && req.method === 'POST')
          await handleContentAssetPublishToNas(req, res, opts.contentAssetsDir, opts.nasRootDir, identity.userId);
        else if (req.url.startsWith('/api/content-assets/download'))
          await handleContentAssetDownload(req, res, opts.contentAssetsDir, identity.userId);
        else if (req.url.startsWith('/api/content-assets/preview'))
          await handleContentAssetPreview(req, res, opts.contentAssetsDir, identity.userId);
        else {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'NOT_FOUND' }));
        }
        return;
      }

      // /api/nas/* — enterprise LAN network drive (read-only), served LOCALLY
      // (NOT proxied to aioncore). Must come before the generic /api/* proxy.
      if (req.url.startsWith('/api/nas/')) {
        const nasMutation =
          (req.method === 'POST' &&
            (req.url.startsWith('/api/nas/upload') ||
              req.url.startsWith('/api/nas/mkdir') ||
              req.url.startsWith('/api/nas/move'))) ||
          (req.method === 'DELETE' && req.url.startsWith('/api/nas/remove'));
        if (nasMutation) {
          const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
          if (!identity) {
            sendJsonResponse(res, 401, { success: false, error: 'UNAUTHENTICATED' });
            return;
          }
          if (identity.userId !== ADMIN_USER_ID) {
            sendJsonResponse(res, 403, { success: false, error: 'FORBIDDEN' });
            return;
          }
        }
        if (req.url.startsWith('/api/nas/list')) await handleNasList(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/download')) await handleNasDownload(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/preview')) await handleNasPreview(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/upload') && req.method === 'POST')
          await handleNasUpload(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/mkdir') && req.method === 'POST')
          await handleNasMkdir(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/move') && req.method === 'POST')
          await handleNasMove(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/remove') && req.method === 'DELETE')
          await handleNasRemove(req, res, opts.nasRootDir);
        else {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'NOT_FOUND' }));
        }
        return;
      }

      // /api/vector-search — knowledge-base search proxied LOCALLY to the vector
      // DB (NOT aioncore). The browser can't reach the loopback-bound vector DB
      // on the server host, so we forward on its behalf. Must come before the
      // generic /api/* proxy below.
      if (req.url.startsWith('/api/vector-search') && req.method === 'POST') {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'UNAUTHENTICATED' }));
          return;
        }
        await handleVectorSearch(req, res, identity, vectorEndpoint);
        return;
      }

      // /api/vector-upload — knowledge-base upload proxied LOCALLY to the
      // vector DB. PPTX is extracted server-side before upload so LAN browsers
      // can add PowerPoint decks without needing direct loopback access.
      if (req.url.startsWith('/api/vector-upload') && req.method === 'POST') {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          sendJsonResponse(res, 401, { success: false, error: 'UNAUTHENTICATED' });
          return;
        }
        await handleVectorUpload(req, res, identity, vectorEndpoint);
        return;
      }

      // /api/vector-documents — read-only knowledge-base document list, proxied
      // to the vector DB the same way as vector-search above.
      if (req.url.startsWith('/api/vector-documents') && req.method === 'POST') {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          sendJsonResponse(res, 401, { success: false, error: 'UNAUTHENTICATED' });
          return;
        }
        await handleVectorDocuments(req, res, identity, vectorEndpoint);
        return;
      }

      // /api/vector-status — health/capability summary for the settings page.
      if (req.url.startsWith('/api/vector-status') && req.method === 'GET') {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          sendJsonResponse(res, 401, { success: false, error: 'UNAUTHENTICATED' });
          return;
        }
        await handleVectorStatus(req, res, identity, vectorEndpoint);
        return;
      }

      // /api/vector-image — knowledge-base image thumbnail, proxied to the vector
      // DB's /api/image. Endpoint + path come as query params.
      if (req.url.startsWith('/api/vector-image') && req.method === 'GET') {
        const identity = await resolveRequestIdentity(gate, req, opts.backendPort, requireAuth);
        if (!identity) {
          sendJsonResponse(res, 401, { success: false, error: 'UNAUTHENTICATED' });
          return;
        }
        await handleVectorImage(req, res, identity, vectorEndpoint);
        return;
      }

      // /workbench/image/* — image workbench for browser/LAN users. The desktop
      // uses the centaur-image-workbench:// custom protocol instead; this serves
      // the same SPA over HTTP plus a key-injecting proxy. The __proxy sub-route
      // must be checked before the static catch (it is a sub-path), and matched
      // WITH a trailing slash so the upstream path always starts with '/'.
      // ComfyUI local proxy — checked before the generic __proxy to avoid collision.
      if (req.url.startsWith('/workbench/image/__proxy/comfyui/')) {
        handleComfyUIProxy(req, res);
        return;
      }
      if (req.url.startsWith('/workbench/image/__proxy/')) {
        const imageWorkbenchConfig = await resolveImageWorkbenchConfig();
        handleImageWorkbenchProxy(req, res, imageWorkbenchConfig?.apiKey, imageWorkbenchConfig?.baseUrl);
        return;
      }
      if (req.url === '/workbench/image') {
        res.writeHead(301, { Location: '/workbench/image/' });
        res.end();
        return;
      }
      if (req.url.startsWith('/workbench/image/')) {
        const imageWorkbenchConfig = await resolveImageWorkbenchConfig();
        await handleImageWorkbenchStatic(req, res, imageWorkbenchDir, imageWorkbenchConfig);
        return;
      }

      // /api/* — reverse proxy to backend. Loopback desktop mode retains the
      // compatibility fallback. LAN mode is fail-closed: only APIs terminated
      // by an explicit handler above, plus the two bootstrap auth reads, may
      // reach the local/trusted backend.
      // POST /login and POST /logout are aionui-auth's top-level auth endpoints.
      // Browser GETs for /login and /logout are SPA routes and must fall through
      // to index.html; otherwise LAN users can land on a backend 405 page.
      if (
        req.url.startsWith('/api/') ||
        req.url.startsWith('/api?') ||
        (req.method === 'POST' && (requestPath === '/login' || requestPath === '/logout'))
      ) {
        if (
          requireAuth &&
          (req.url.startsWith('/api/') || req.url.startsWith('/api?')) &&
          !isAllowedLanGenericBackendRoute(req.url, req.method)
        ) {
          sendJsonResponse(res, 403, { success: false, error: 'FORBIDDEN' });
          return;
        }
        forwardToBackend(req, res, opts.backendPort);
        return;
      }

      const isHtmlEntry =
        requestPath === '/' || requestPath === '/index.html' || !requestPath.split('/').pop()?.includes('.');
      if (isHtmlEntry || requestPath === '/sw.js') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }

      // SPA entry + client-route fallback: serve through the self-healing guard
      // rather than serve-handler, so an empty/corrupt index.html never reaches
      // a LAN user as a blank page. The guard restores the file from a backup
      // when possible and otherwise returns a recovery page (HTTP 503).
      if (isHtmlEntry && req.method !== 'HEAD') {
        const { html, healed, recovered } = await entryGuard.getEntryHtml();
        if (healed) {
          console.warn('[WebUI] index.html was empty/corrupt — self-healed from backup copy');
        }
        if (recovered) {
          console.error(
            '[WebUI] index.html missing and no valid backup — serving recovery page. Rebuild the renderer: bun run package'
          );
        }
        res.statusCode = recovered ? 503 : 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (recovered) res.setHeader('Retry-After', '10');
        res.end(html);
        return;
      }

      // static files + SPA fallback
      await serveHandler(req, res, {
        public: opts.staticDir,
      });
    } catch (error) {
      console.error('[WebUI] Request handling failed', {
        method: req.method,
        path: req.url,
        error,
      });
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
      } else {
        res.destroy();
      }
    }
  });
  // The public listener splices into this loopback server. Explicit bounds are
  // still required: Node's generous defaults otherwise make slow-header/body
  // connections a cheap unauthenticated resource-exhaustion primitive.
  http_server.headersTimeout = 15_000;
  http_server.requestTimeout = 10 * 60_000;
  http_server.keepAliveTimeout = 5_000;
  http_server.maxHeadersCount = 100;
  http_server.maxRequestsPerSocket = 100;

  // Internal HTTP server — 127.0.0.1 ephemeral port, never visible to the user.
  await new Promise<void>((resolve, reject) => {
    http_server.once('error', reject);
    http_server.listen(0, '127.0.0.1', () => {
      http_server.off('error', reject);
      resolve();
    });
  });
  const internalPort = (http_server.address() as { port: number } | null)?.port;
  if (!internalPort) {
    throw new Error('internal HTTP server failed to bind to a port');
  }

  // User-facing listener: inspect the first line of every TCP connection and
  // route to either the backend (for /ws upgrades) or the internal HTTP
  // server (everything else). Both routes use raw TCP splice — no reliance
  // on http.Server's upgrade event.
  const tcp_server = net.createServer((client: Socket) => {
    let peeked = Buffer.alloc(0);
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      client.setTimeout(0);
      client.removeListener('data', onData);
      client.removeListener('error', onEarlyError);
      client.removeListener('end', onEarlyEnd);
      client.removeListener('timeout', onEarlyTimeout);
    };
    const onData = (chunk: Buffer): void => {
      peeked = Buffer.concat([peeked, chunk]);
      const decision = peekWsRoute(peeked);
      if (decision === null && peeked.length < PEEK_LIMIT_BYTES) return;
      // A /ws upgrade bypasses the internal HTTP server. In LAN mode terminate
      // frames at a tenant-aware gateway; raw TCP splicing would broadcast all
      // users' conversation events from the local-mode backend.
      if (decision === true && requireAuth) {
        const headEnd = peeked.indexOf('\r\n\r\n');
        if (headEnd < 0 && peeked.length < PEEK_LIMIT_BYTES) return;
        const cookieHeader = rawHeader(peeked, 'cookie');
        const gateToken = rawGateToken(peeked);
        const cookieIdentity = gate.getAuthorizedIdentity(cookieHeader);
        const tokenIdentity = gate.getAuthorizedTokenIdentity(gateToken);
        if (cookieIdentity && tokenIdentity && cookieIdentity.userId !== tokenIdentity.userId) {
          cleanup();
          client.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
          return;
        }
        const identity = cookieIdentity ?? tokenIdentity;
        if (!identity || !conversationTenantBoundary) {
          cleanup();
          client.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
          return;
        }
        cleanup();
        proxyTenantWebSocket(client, {
          backendPort: opts.backendPort,
          initialBytes: peeked,
          identity,
          boundary: conversationTenantBoundary,
          allowCrossOriginWithBearer: Boolean(gateToken && tokenIdentity),
          isStillAuthorized: () => {
            const currentCookieIdentity = gate.getAuthorizedIdentity(cookieHeader);
            const currentTokenIdentity = gate.getAuthorizedTokenIdentity(gateToken);
            if (
              currentCookieIdentity &&
              currentTokenIdentity &&
              currentCookieIdentity.userId !== currentTokenIdentity.userId
            ) {
              return false;
            }
            return (currentCookieIdentity ?? currentTokenIdentity)?.userId === identity.userId;
          },
        });
        return;
      }
      cleanup();
      const target = decision === true ? opts.backendPort : internalPort;
      spliceToTcpEndpoint(client, target, peeked);
    };
    const onEarlyError = (): void => {
      cleanup();
      client.destroy();
    };
    const onEarlyEnd = (): void => {
      // Client closed before we saw a request line — nothing to route.
      cleanup();
      client.destroy();
    };
    const onEarlyTimeout = (): void => {
      cleanup();
      client.destroy();
    };
    client.setTimeout(INITIAL_PEEK_TIMEOUT_MS);
    client.on('data', onData);
    client.on('error', onEarlyError);
    client.on('end', onEarlyEnd);
    client.on('timeout', onEarlyTimeout);
  });
  tcp_server.maxConnections = MAX_FRONTEND_CONNECTIONS;

  // server.close() stops accepting new connections, but its callback does not
  // run until every existing TCP client has closed. Browsers keep WebUI HTTP
  // and WebSocket connections alive for minutes, so waiting for graceful
  // client shutdown used to leave Settings -> WebUI permanently stuck on
  // "Starting..." when the service was toggled off and back on. Track the
  // public sockets so stop() can actively drain them before the next bind.
  const frontendSockets = new Set<Socket>();
  tcp_server.on('connection', (socket: Socket) => {
    frontendSockets.add(socket);
    socket.once('close', () => frontendSockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    tcp_server.once('error', reject);
    tcp_server.listen(port, host, () => {
      tcp_server.off('error', reject);
      resolve();
    });
  });

  const actualPort = (tcp_server.address() as { port: number } | null)?.port ?? port;
  const lanIP = allowRemote ? (getLanIP() ?? undefined) : undefined;
  const localUrl = `http://127.0.0.1:${actualPort}`;
  const networkUrl = lanIP ? `http://${lanIP}:${actualPort}` : undefined;

  return {
    port: actualPort,
    url: networkUrl ?? localUrl,
    localUrl,
    networkUrl,
    lanIP,
    stop: () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(forceTimer);
          resolve();
        };
        const forceTimer = setTimeout(() => {
          // Last-resort guard for unusual half-open sockets. Both servers have
          // already stopped accepting connections, so resolving here is safe
          // and prevents lifecycle operations from hanging forever.
          http_server.closeAllConnections?.();
          for (const socket of frontendSockets) socket.destroy();
          finish();
        }, 2_000);
        forceTimer.unref();

        tcp_server.close(() => {
          http_server.close(finish);
          http_server.closeAllConnections?.();
        });
        for (const socket of frontendSockets) socket.destroy();
      }),
    inspectEntry: entryGuard.inspect,
    repairEntry: entryGuard.repair,
    revokeUserSessions: (userId) => gate.revokeUserSessions(userId),
  };
}

export async function stopStaticServer(handle: StaticServerHandle): Promise<void> {
  await handle.stop();
}
