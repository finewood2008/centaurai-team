/**
 * Image workbench (LAN / browser) — make the desktop "图片工作台" usable from a
 * plain browser on the LAN, not just the Electron desktop.
 *
 * The desktop renders the image workbench SPA inside an Electron <webview> loaded
 * over the privileged `centaur-image-workbench://` custom protocol, and the main
 * process transparently proxies the SPA's model-API calls to the upstream image
 * service. A LAN browser has neither the <webview> tag nor the custom protocol,
 * so this module reproduces both over plain HTTP, served by static-server:
 *
 *   GET  /workbench/image/*           → the bundled SPA dist (relative-based, so
 *                                       the same build works at this subpath)
 *   *    /workbench/image/__proxy/*   → reverse-proxy to the upstream image API,
 *                                       injecting the server-held key so it never
 *                                       reaches the browser (falls back to the
 *                                       client's Authorization when no key is set,
 *                                       faithful to the desktop pass-through).
 *
 * Both routes sit behind webui-auth-gate (see static-server.ts) when the WebUI is
 * LAN-exposed, so only logged-in users reach them.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { safeFileResponseHeaders, safeInlineContentType } from './safe-preview.js';

/** URL prefixes (keep `__proxy` matched WITH a trailing slash — see proxy SSRF note). */
export const IMAGE_STATIC_PREFIX = '/workbench/image';
export const IMAGE_PROXY_PREFIX = '/workbench/image/__proxy';
export const COMFYUI_PROXY_PATH = '/workbench/image/__proxy/comfyui';

const DEFAULT_UPSTREAM_BASE_URL = 'https://api.tokenclub.pro';
const DEFAULT_COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
const DEFAULT_LAN_PROFILE_NAME = '半人马 LAN 图像模型';
const DEFAULT_LAN_IMAGE_MODEL = 'gpt-image-2';
const LAN_MANAGED_API_KEY_PLACEHOLDER = 'centaur-lan-managed';
const LAN_MANAGED_AUTH_RE = new RegExp(`^Bearer\\s+${LAN_MANAGED_API_KEY_PLACEHOLDER}$`, 'i');

// The bundled workbench only calls these OpenAI-compatible routes through the
// server-key proxy. Keep this list deliberately closed: the upstream API key is
// an administrator credential, not a general-purpose bearer token for LAN users.
const IMAGE_PROXY_ROUTES = new Map<string, { method: 'GET' | 'POST'; contentType?: RegExp }>([
  ['/v1/models', { method: 'GET' }],
  ['/v1/images/generations', { method: 'POST', contentType: /^application\/json(?:\s*;|$)/i }],
  ['/v1/images/edits', { method: 'POST', contentType: /^multipart\/form-data(?:\s*;|$)/i }],
  ['/v1/responses', { method: 'POST', contentType: /^application\/json(?:\s*;|$)/i }],
]);

const DEFAULT_PROXY_REQUEST_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_PROXY_RESPONSE_MAX_BYTES = 256 * 1024 * 1024;
// The bundled workbench permits image jobs up to ten minutes. A server-side
// deadline at the same boundary prevents abandoned upstream sockets living
// forever without breaking the supported long-running generation flow.
const DEFAULT_PROXY_TIMEOUT_MS = 10 * 60_000;

export type ImageWorkbenchProxyOptions = {
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

export type ComfyUIProxyOptions = ImageWorkbenchProxyOptions & {
  /** ComfyUI exposes a powerful host-local API. Callers must opt in explicitly. */
  trusted?: boolean;
};

export type ImageWorkbenchLanConfig = {
  apiKey?: string;
  baseUrl?: string;
  profileName?: string;
  model?: string;
  apiMode?: 'images' | 'responses';
  streamImages?: boolean;
  streamPartialImages?: number;
};

/**
 * Upstream image service the SPA talks to. Fixed per server (never client
 * controlled): the proxy only ever forwards to this single origin. Overridable
 * via `AIONUI_IMAGE_UPSTREAM_URL` for a different provider host or for tests.
 */
function upstreamBaseUrl(configuredBaseUrl?: string): string {
  return configuredBaseUrl?.trim() || process.env.AIONUI_IMAGE_UPSTREAM_URL?.trim() || DEFAULT_UPSTREAM_BASE_URL;
}

function comfyuiBaseUrl(): string {
  return process.env.AIONUI_COMFYUI_UPSTREAM_URL?.trim() || DEFAULT_COMFYUI_BASE_URL;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function isHtmlEntryRequest(rel: string): boolean {
  return !rel || rel === 'index.html' || !path.basename(rel).includes('.');
}

function requestOrigin(req: IncomingMessage): string {
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    ?.trim();
  const proto = forwardedProto === 'https' ? 'https' : 'http';
  const host = req.headers.host || '127.0.0.1';
  return `${proto}://${host}`;
}

function buildLanProfileQuery(req: IncomingMessage, config: ImageWorkbenchLanConfig): URLSearchParams {
  const params = new URLSearchParams();
  const streamPartialImages =
    typeof config.streamPartialImages === 'number' && Number.isFinite(config.streamPartialImages)
      ? config.streamPartialImages
      : 0;
  params.set('profileName', config.profileName?.trim() || DEFAULT_LAN_PROFILE_NAME);
  params.set('apiUrl', `${requestOrigin(req)}${IMAGE_PROXY_PREFIX}`);
  if (config.apiKey?.trim()) params.set('apiKey', LAN_MANAGED_API_KEY_PLACEHOLDER);
  params.set('model', config.model?.trim() || DEFAULT_LAN_IMAGE_MODEL);
  params.set('apiMode', config.apiMode === 'responses' ? 'responses' : 'images');
  params.set('streamImages', String(config.streamImages === true));
  params.set('streamPartialImages', String(streamPartialImages));
  params.set('disableServiceWorker', 'true');
  return params;
}

function redirectLocationWithLanProfile(req: IncomingMessage, config?: ImageWorkbenchLanConfig): string | null {
  if (!config?.apiKey?.trim()) return null;

  const current = new URL(req.url ?? IMAGE_STATIC_PREFIX, 'http://127.0.0.1');
  const required = buildLanProfileQuery(req, config);
  let changed = false;

  for (const [key, value] of required.entries()) {
    if (current.searchParams.get(key) === value) continue;
    current.searchParams.set(key, value);
    changed = true;
  }

  return changed ? `${current.pathname}?${current.searchParams.toString()}${current.hash}` : null;
}

function buildUpstreamUrl(base: string, rest: string): URL {
  const upstream = new URL(base);
  const restUrl = new URL(rest, 'http://aionui.local');
  const basePath = upstream.pathname.replace(/\/+$/, '');
  const baseEndsWithV1 = basePath.toLowerCase().endsWith('/v1');
  const restPath =
    baseEndsWithV1 && (restUrl.pathname === '/v1' || restUrl.pathname.startsWith('/v1/'))
      ? restUrl.pathname.slice(3) || '/'
      : restUrl.pathname;
  upstream.pathname = `${basePath}${restPath}`.replace(/\/{2,}/g, '/') || '/';
  upstream.search = restUrl.search;
  return upstream;
}

function sendProxyJson(res: ServerResponse, status: number, error: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ success: false, error }));
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function declaredContentLength(headers: IncomingMessage['headers']): number | null {
  const raw = headers['content-length'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validatedProxyBase(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function stripHopByHopHeaders(headers: OutgoingHttpHeaders): void {
  for (const token of String(headers.connection ?? '').split(',')) {
    const name = token.trim().toLowerCase();
    if (name) delete headers[name];
  }
  for (const name of [
    'connection',
    'keep-alive',
    'transfer-encoding',
    'te',
    'trailer',
    'upgrade',
    'proxy-connection',
    'proxy-authenticate',
    'proxy-authorization',
  ]) {
    delete headers[name];
  }
}

function upstreamRequestHeaders(req: IncomingMessage, upstream: URL): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...req.headers };
  stripHopByHopHeaders(headers);
  for (const name of [
    'host',
    'cookie',
    'expect',
    'forwarded',
    'origin',
    'referer',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
    'x-webui-gate-token',
    'x-centaurai-user-id',
    'x-centaurai-username',
    'x-centaurai-role',
    'x-centaurai-proxy-token',
  ]) {
    delete headers[name];
  }
  headers.host = upstream.host;
  // Count actual response bytes, not a small compressed stream which could
  // expand dramatically in the renderer.
  headers['accept-encoding'] = 'identity';
  return headers;
}

function upstreamResponseHeaders(proxyRes: IncomingMessage, stripCors: boolean): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...proxyRes.headers };
  stripHopByHopHeaders(headers);
  delete headers['set-cookie'];
  if (stripCors) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase().startsWith('access-control-')) delete headers[key];
    }
  }
  const originalContentType = Array.isArray(headers['content-type'])
    ? headers['content-type'][0]
    : headers['content-type'];
  if (originalContentType) {
    const safeContentType = safeInlineContentType(originalContentType);
    headers['content-type'] = safeContentType;
    Object.assign(headers, safeFileResponseHeaders(safeContentType !== originalContentType));
  } else {
    headers['content-type'] = 'application/octet-stream';
    Object.assign(headers, safeFileResponseHeaders(true));
  }
  return headers;
}

type BoundedProxyOptions = Required<ImageWorkbenchProxyOptions> & {
  stripCors: boolean;
  unreachableError: string;
};

/**
 * Stream one request to a fixed upstream with hard byte and wall-clock limits.
 * Node's client never follows redirects; 3xx responses are rejected explicitly
 * so neither credentials nor response locations can cross to another origin.
 */
function forwardBoundedProxy(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: URL,
  headers: OutgoingHttpHeaders,
  options: BoundedProxyOptions
): void {
  const requestLength = declaredContentLength(req.headers);
  if (requestLength != null && requestLength > options.maxRequestBytes) {
    sendProxyJson(res, 413, 'PROXY_REQUEST_TOO_LARGE');
    req.resume();
    return;
  }

  const transport = upstream.protocol === 'https:' ? https : http;
  let upstreamResponse: IncomingMessage | null = null;
  let terminal = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const finish = (): void => {
    if (deadline) clearTimeout(deadline);
    deadline = undefined;
  };

  let proxyReq: ReturnType<typeof transport.request>;
  const fail = (status: number, error: string): void => {
    if (terminal) return;
    terminal = true;
    finish();
    proxyReq?.destroy();
    upstreamResponse?.destroy();
    req.resume();
    sendProxyJson(res, status, error);
  };

  try {
    proxyReq = transport.request(
      {
        hostname: upstream.hostname,
        port: upstream.port ? Number(upstream.port) : upstream.protocol === 'https:' ? 443 : 80,
        path: `${upstream.pathname}${upstream.search}`,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        upstreamResponse = proxyRes;
        if (terminal) {
          proxyRes.destroy();
          return;
        }

        const status = proxyRes.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          proxyRes.resume();
          upstreamResponse = null;
          fail(502, 'UPSTREAM_REDIRECT_REJECTED');
          return;
        }

        const responseLength = declaredContentLength(proxyRes.headers);
        if (responseLength != null && responseLength > options.maxResponseBytes) {
          proxyRes.resume();
          upstreamResponse = null;
          fail(502, 'PROXY_RESPONSE_TOO_LARGE');
          return;
        }

        res.writeHead(status, upstreamResponseHeaders(proxyRes, options.stripCors));
        let responseBytes = 0;
        proxyRes.on('data', (chunk: Buffer) => {
          if (terminal) return;
          responseBytes += chunk.length;
          if (responseBytes > options.maxResponseBytes) {
            fail(502, 'PROXY_RESPONSE_TOO_LARGE');
            return;
          }
          if (!res.write(chunk)) proxyRes.pause();
        });
        res.on('drain', () => proxyRes.resume());
        proxyRes.on('end', () => {
          if (terminal) return;
          terminal = true;
          finish();
          res.end();
        });
        proxyRes.on('error', () => fail(502, options.unreachableError));
      }
    );
  } catch {
    sendProxyJson(res, 502, options.unreachableError);
    req.resume();
    return;
  }

  deadline = setTimeout(() => fail(504, 'UPSTREAM_TIMEOUT'), options.timeoutMs);
  proxyReq.on('error', () => fail(502, options.unreachableError));
  proxyReq.on('drain', () => req.resume());

  let requestBytes = 0;
  req.on('data', (chunk: Buffer) => {
    if (terminal) return;
    requestBytes += chunk.length;
    if (requestBytes > options.maxRequestBytes) {
      fail(413, 'PROXY_REQUEST_TOO_LARGE');
      return;
    }
    if (!proxyReq.write(chunk)) req.pause();
  });
  req.on('end', () => {
    if (!terminal) proxyReq.end();
  });
  req.on('aborted', () => {
    if (terminal) return;
    terminal = true;
    finish();
    proxyReq.destroy();
    upstreamResponse?.destroy();
  });
  req.on('error', () => {
    if (terminal) return;
    terminal = true;
    finish();
    proxyReq.destroy();
    upstreamResponse?.destroy();
  });
  res.on('close', () => {
    if (terminal || res.writableEnded) return;
    terminal = true;
    finish();
    proxyReq.destroy();
    upstreamResponse?.destroy();
  });
}

function boundedProxyOptions(
  options: ImageWorkbenchProxyOptions | undefined,
  extra: Pick<BoundedProxyOptions, 'stripCors' | 'unreachableError'>
): BoundedProxyOptions {
  return {
    maxRequestBytes: positiveLimit(options?.maxRequestBytes, DEFAULT_PROXY_REQUEST_MAX_BYTES),
    maxResponseBytes: positiveLimit(options?.maxResponseBytes, DEFAULT_PROXY_RESPONSE_MAX_BYTES),
    timeoutMs: positiveLimit(options?.timeoutMs, DEFAULT_PROXY_TIMEOUT_MS),
    ...extra,
  };
}

/**
 * Serve the image workbench SPA dist at `/workbench/image/*`.
 *
 * Path handling: strip the `/workbench/image` prefix, resolve under `dir`, and
 * reject anything that escapes `dir` (path-traversal fence). Requests with no
 * file extension (SPA routes, or the bare entry) fall back to index.html; a
 * missing asset is a real 404 (never silently served as HTML).
 */
export async function handleImageWorkbenchStatic(
  req: IncomingMessage,
  res: ServerResponse,
  dir?: string,
  lanConfig?: ImageWorkbenchLanConfig
): Promise<void> {
  if (!dir) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'IMAGE_WORKBENCH_DISABLED' }));
    return;
  }
  const root = path.resolve(dir);
  const rawPath = (req.url ?? '').slice(IMAGE_STATIC_PREFIX.length).split('?')[0].split('#')[0];
  let rel: string;
  try {
    rel = decodeURIComponent(rawPath.replace(/^\/+/, ''));
  } catch {
    res.writeHead(400).end();
    return;
  }
  // Fence FIRST, on the requested path, so a traversal attempt is a clear 403
  // rather than being masked by the SPA fallback below.
  if (rel) {
    const candidate = path.resolve(root, rel);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'FORBIDDEN' }));
      return;
    }
  }
  // No filename (bare `/workbench/image`) or an extensionless client route → SPA entry.
  if (isHtmlEntryRequest(rel)) {
    const location = redirectLocationWithLanProfile(req, lanConfig);
    if (location) {
      res.writeHead(302, { Location: location, 'cache-control': 'no-store' });
      res.end();
      return;
    }
    rel = 'index.html';
  }

  const filePath = path.resolve(root, rel);

  try {
    const data = await fs.promises.readFile(filePath);
    const headers: Record<string, string> = { 'content-type': contentTypeFor(filePath) };
    // The HTML entry must never be cached stale (it pins the hashed asset names).
    if (rel === 'index.html') headers['cache-control'] = 'no-store, no-cache, must-revalidate';
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'NOT_FOUND' }));
  }
}

/**
 * Reverse-proxy the four OpenAI-compatible routes actually used by the bundled
 * workbench. Bodies remain streaming, but both directions have byte caps and a
 * wall-clock deadline.
 *
 * SSRF fence: the path after `__proxy` is appended to the FIXED upstream origin,
 * and we require it to start with `/` and re-check the resolved origin, so a
 * crafted request like `/workbench/image/__proxy@evil.com` (which would turn into
 * `https://api.tokenclub.pro@evil.com`, a credentials-in-userinfo retarget) is
 * rejected. The static-server route guard also matches `__proxy/` with a trailing
 * slash.
 *
 * Auth: when `imageKey` is configured we inject it server-side (the browser never
 * sees a key); otherwise we pass the client's Authorization through (mirrors the
 * desktop custom-protocol proxy). WebUI cookies, gate tokens and internal proxy
 * identity headers are always stripped.
 */
export function handleImageWorkbenchProxy(
  req: IncomingMessage,
  res: ServerResponse,
  imageKey?: string,
  imageBaseUrl?: string,
  options?: ImageWorkbenchProxyOptions
): void {
  const rest = (req.url ?? '').slice(IMAGE_PROXY_PREFIX.length);
  const queryIndex = rest.indexOf('?');
  const rawPath = queryIndex >= 0 ? rest.slice(0, queryIndex) : rest;
  // The bundled client uses four fixed ASCII paths without query parameters.
  // Reject encoded separators, dot segments, duplicate slashes and any query so
  // URL parsers at this proxy and the upstream can never disagree about policy.
  if (
    !rawPath.startsWith('/') ||
    rest.includes('#') ||
    queryIndex >= 0 ||
    rawPath.includes('%') ||
    rawPath.includes('\\') ||
    rawPath.includes('\0') ||
    rawPath.includes('//') ||
    rawPath.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    sendProxyJson(res, 400, 'BAD_PROXY_PATH');
    return;
  }

  const route = IMAGE_PROXY_ROUTES.get(rawPath);
  if (!route) {
    sendProxyJson(res, 403, 'PROXY_ROUTE_FORBIDDEN');
    return;
  }
  if ((req.method ?? 'GET').toUpperCase() !== route.method) {
    sendProxyJson(res, 405, 'PROXY_METHOD_FORBIDDEN');
    return;
  }
  const contentType = Array.isArray(req.headers['content-type'])
    ? req.headers['content-type'][0]
    : req.headers['content-type'];
  if (route.contentType && !route.contentType.test(contentType ?? '')) {
    sendProxyJson(res, 415, 'PROXY_CONTENT_TYPE_FORBIDDEN');
    return;
  }

  const base = validatedProxyBase(upstreamBaseUrl(imageBaseUrl));
  if (!base) {
    sendProxyJson(res, 502, 'INVALID_UPSTREAM_CONFIG');
    return;
  }
  let upstream: URL;
  try {
    upstream = buildUpstreamUrl(base.href, rawPath);
  } catch {
    sendProxyJson(res, 502, 'INVALID_UPSTREAM_CONFIG');
    return;
  }
  if (upstream.origin !== base.origin) {
    sendProxyJson(res, 502, 'INVALID_UPSTREAM_CONFIG');
    return;
  }

  const headers = upstreamRequestHeaders(req, upstream);
  if (imageKey) {
    headers.authorization = `Bearer ${imageKey}`;
  } else {
    const authorization = headers.authorization;
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (typeof value === 'string' && LAN_MANAGED_AUTH_RE.test(value.trim())) {
      delete headers.authorization;
    }
  }
  forwardBoundedProxy(
    req,
    res,
    upstream,
    headers,
    boundedProxyOptions(options, { stripCors: true, unreachableError: 'UPSTREAM_UNREACHABLE' })
  );
}

/**
 * Reverse-proxy `/workbench/image/__proxy/comfyui/*` to the local ComfyUI
 * server only for an explicitly trusted caller. The default is deny because a
 * ComfyUI installation and its custom nodes can expose host file/process APIs.
 */
export function handleComfyUIProxy(req: IncomingMessage, res: ServerResponse, options: ComfyUIProxyOptions = {}): void {
  if (options.trusted !== true) {
    sendProxyJson(res, 403, 'COMFYUI_PROXY_DISABLED');
    req.resume();
    return;
  }
  const rest = (req.url ?? '').slice(COMFYUI_PROXY_PATH.length);
  const rawPath = rest.split('?')[0] || '/';
  if (
    (rest && !rest.startsWith('/')) ||
    rest.includes('#') ||
    rawPath.includes('\\') ||
    rawPath.includes('\0') ||
    rawPath.includes('//') ||
    /%(?:2f|5c|00)/i.test(rawPath) ||
    rawPath.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    sendProxyJson(res, 400, 'BAD_PROXY_PATH');
    return;
  }
  const base = validatedProxyBase(comfyuiBaseUrl());
  if (!base) {
    sendProxyJson(res, 502, 'INVALID_COMFYUI_CONFIG');
    return;
  }
  let upstream: URL;
  try {
    upstream = buildUpstreamUrl(base.href, rest || '/');
  } catch {
    sendProxyJson(res, 502, 'INVALID_COMFYUI_CONFIG');
    return;
  }
  if (upstream.origin !== base.origin) {
    sendProxyJson(res, 502, 'INVALID_COMFYUI_CONFIG');
    return;
  }

  forwardBoundedProxy(
    req,
    res,
    upstream,
    upstreamRequestHeaders(req, upstream),
    boundedProxyOptions(options, { stripCors: true, unreachableError: 'COMFYUI_UNREACHABLE' })
  );
}
