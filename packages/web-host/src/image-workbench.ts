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
 * Reverse-proxy `/workbench/image/__proxy/*` to the upstream image API by
 * streaming (request body piped up, response piped back) — handles JSON and any
 * binary/multipart body without buffering.
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
 * desktop custom-protocol proxy). The WebUI session cookie is always stripped so
 * it never leaks to the external service.
 */
export function handleImageWorkbenchProxy(
  req: IncomingMessage,
  res: ServerResponse,
  imageKey?: string,
  imageBaseUrl?: string
): void {
  const rest = (req.url ?? '').slice(IMAGE_PROXY_PREFIX.length);
  if (!rest.startsWith('/')) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'BAD_PROXY_PATH' }));
    return;
  }
  const base = upstreamBaseUrl(imageBaseUrl);
  let upstream: URL;
  try {
    upstream = buildUpstreamUrl(base, rest);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (upstream.origin !== new URL(base).origin) {
    res.writeHead(400).end();
    return;
  }

  const headers: OutgoingHttpHeaders = { ...req.headers };
  delete headers.host;
  delete headers.cookie; // never leak the WebUI session cookie to the external API
  // Strip hop-by-hop headers (RFC 7230 §6.1): they govern this connection, not
  // the upstream one. Dropping transfer-encoding also removes the TE-vs-CL
  // ambiguity that enables request smuggling; node re-derives framing from the
  // piped body. Also honor any extra names listed in the Connection header.
  for (const token of String(req.headers.connection ?? '').split(',')) {
    const name = token.trim().toLowerCase();
    if (name) delete headers[name];
  }
  for (const h of [
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
    delete headers[h];
  }
  headers.host = upstream.host;
  if (imageKey) {
    headers.authorization = `Bearer ${imageKey}`;
  } else {
    const authorization = headers.authorization;
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (typeof value === 'string' && LAN_MANAGED_AUTH_RE.test(value.trim())) {
      delete headers.authorization;
    }
  }

  const isHttps = upstream.protocol === 'https:';
  const transport = isHttps ? https : http;
  const proxyReq = transport.request(
    {
      hostname: upstream.hostname,
      port: upstream.port ? Number(upstream.port) : isHttps ? 443 : 80,
      path: `${upstream.pathname}${upstream.search}`,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const outHeaders = { ...proxyRes.headers };
      for (const k of Object.keys(outHeaders)) {
        if (k.toLowerCase().startsWith('access-control-')) delete outHeaders[k];
      }
      res.writeHead(proxyRes.statusCode ?? 502, outHeaders);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'UPSTREAM_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxyReq);
}

/**
 * Reverse-proxy `/workbench/image/__proxy/comfyui/*` to the local ComfyUI
 * server at `http://127.0.0.1:8188`. Path after the comfyui prefix is
 * forwarded directly (e.g. `/prompt` → `http://127.0.0.1:8188/prompt`).
 */
export function handleComfyUIProxy(req: IncomingMessage, res: ServerResponse): void {
  const rest = (req.url ?? '').slice(COMFYUI_PROXY_PATH.length);
  if (rest && !rest.startsWith('/')) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'BAD_PROXY_PATH' }));
    return;
  }
  const base = comfyuiBaseUrl();
  let upstream: URL;
  try {
    upstream = new URL(`${base}${rest || '/'}`);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (upstream.origin !== new URL(base).origin) {
    res.writeHead(400).end();
    return;
  }

  const headers: OutgoingHttpHeaders = { ...req.headers };
  delete headers.host;
  delete headers.cookie;

  for (const token of String(req.headers.connection ?? '').split(',')) {
    const name = token.trim().toLowerCase();
    if (name) delete headers[name];
  }
  for (const h of [
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
    delete headers[h];
  }
  headers.host = upstream.host;

  const isHttps = upstream.protocol === 'https:';
  const transport = isHttps ? https : http;
  const proxyReq = transport.request(
    {
      hostname: upstream.hostname,
      port: upstream.port ? Number(upstream.port) : isHttps ? 443 : 80,
      path: `${upstream.pathname}${upstream.search}`,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'COMFYUI_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });

  req.pipe(proxyReq);
}
