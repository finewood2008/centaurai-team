const DEFAULT_REQUEST_LIMIT_BYTES = 64 * 1024 * 1024;
const DEFAULT_RESPONSE_LIMIT_BYTES = 256 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

const IMAGE_API_ROUTES = new Map<string, { method: 'GET' | 'POST'; contentType?: RegExp }>([
  ['/v1/models', { method: 'GET' }],
  ['/v1/images/generations', { method: 'POST', contentType: /^application\/json(?:\s*;|$)/i }],
  ['/v1/images/edits', { method: 'POST', contentType: /^multipart\/form-data(?:\s*;|$)/i }],
  ['/v1/responses', { method: 'POST', contentType: /^application\/json(?:\s*;|$)/i }],
]);

const COMFY_HISTORY_PATH_RE = /^\/history\/[A-Za-z0-9_-]{1,128}$/;
const COMFY_VIEW_QUERY_KEYS = new Set(['filename', 'subfolder', 'type']);
const MANAGED_AUTH_RE = /^Bearer\s+centaur-managed$/i;

export type WorkbenchProxyLimits = {
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

export type ImageApiProxyOptions = WorkbenchProxyLimits & {
  prefix: string;
  baseUrl: string;
  apiKey?: string;
};

export type ComfyProxyOptions = WorkbenchProxyLimits & {
  prefix: string;
  baseUrl: string;
};

class ProxyFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function limits(options: WorkbenchProxyLimits): Required<WorkbenchProxyLimits> {
  return {
    maxRequestBytes: positiveLimit(options.maxRequestBytes, DEFAULT_REQUEST_LIMIT_BYTES),
    maxResponseBytes: positiveLimit(options.maxResponseBytes, DEFAULT_RESPONSE_LIMIT_BYTES),
    timeoutMs: positiveLimit(options.timeoutMs, DEFAULT_TIMEOUT_MS),
  };
}

function jsonError(status: number, code: string): Response {
  return Response.json(
    { error: { code, message: code } },
    {
      status,
      headers: {
        ...corsHeaders(),
        'cache-control': 'no-store',
      },
    }
  );
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  };
}

function isCleanPath(pathname: string): boolean {
  return (
    pathname.startsWith('/') &&
    !pathname.includes('%') &&
    !pathname.includes('\\') &&
    !pathname.includes('\0') &&
    !pathname.includes('//') &&
    !pathname.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

function validateBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function buildWorkbenchUpstreamUrl(baseUrl: string, upstreamPath: string, search = ''): URL | null {
  const base = validateBaseUrl(baseUrl);
  if (!base || !isCleanPath(upstreamPath)) return null;

  const upstream = new URL(base.href);
  const basePath = upstream.pathname.replace(/\/+$/, '');
  const baseEndsWithV1 = basePath.toLowerCase().endsWith('/v1');
  const restPath =
    baseEndsWithV1 && (upstreamPath === '/v1' || upstreamPath.startsWith('/v1/'))
      ? upstreamPath.slice(3) || '/'
      : upstreamPath;
  upstream.pathname = `${basePath}${restPath}`.replace(/\/{2,}/g, '/') || '/';
  upstream.search = search;
  return upstream.origin === base.origin ? upstream : null;
}

function declaredContentLength(headers: Headers): number | null {
  const value = headers.get('content-length');
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
  signal: AbortSignal
): Promise<ArrayBuffer | undefined> {
  const declared = declaredContentLength(request.headers);
  if (declared != null && declared > maxBytes) throw new ProxyFailure(413, 'PROXY_REQUEST_TOO_LARGE');
  if (!request.body) return undefined;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortReject: ((reason: ProxyFailure) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortReject = reject;
  });
  const onAbort = (): void => abortReject?.(new ProxyFailure(504, 'UPSTREAM_TIMEOUT'));
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const result = await Promise.race([reader.read(), aborted]);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch((): undefined => undefined);
        throw new ProxyFailure(413, 'PROXY_REQUEST_TOO_LARGE');
      }
      chunks.push(result.value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer as ArrayBuffer;
}

function safeRequestHeaders(request: Request, authorization?: string): Headers {
  const headers = new Headers();
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('accept-encoding', 'identity');
  if (authorization) headers.set('authorization', authorization);
  return headers;
}

function safeResponseHeaders(upstream: Response): Headers {
  const headers = new Headers(corsHeaders());
  for (const name of [
    'content-type',
    'content-length',
    'cache-control',
    'etag',
    'last-modified',
    'content-disposition',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const contentType = headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    contentType === 'text/html' ||
    contentType === 'application/xhtml+xml' ||
    contentType === 'image/svg+xml' ||
    contentType === 'text/xml' ||
    contentType === 'application/xml' ||
    contentType.endsWith('+xml')
  ) {
    // Proxy URLs share the privileged custom origin. An upstream error page
    // must not become executable merely because a user navigates to the API
    // URL directly or a workbench bug embeds it as a document.
    headers.set('content-type', 'text/plain; charset=utf-8');
    headers.set('content-security-policy', "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'");
  } else if (!contentType) {
    headers.set('content-type', 'application/octet-stream');
    headers.set('content-security-policy', "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'");
  }
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  return headers;
}

function boundedResponseBody(
  upstream: Response,
  maxBytes: number,
  controller: AbortController,
  clearDeadline: () => void
): ReadableStream<Uint8Array> | null {
  if (!upstream.body) {
    clearDeadline();
    return null;
  }
  const reader = upstream.body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(target) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearDeadline();
          target.close();
          return;
        }
        total += value.byteLength;
        if (total > maxBytes) {
          clearDeadline();
          controller.abort();
          await reader.cancel().catch((): undefined => undefined);
          target.error(new Error('PROXY_RESPONSE_TOO_LARGE'));
          return;
        }
        target.enqueue(value);
      } catch (error) {
        clearDeadline();
        target.error(error);
      }
    },
    async cancel(reason) {
      clearDeadline();
      controller.abort();
      await reader.cancel(reason).catch((): undefined => undefined);
    },
  });
}

async function forward(
  request: Request,
  upstreamUrl: URL,
  requestHeaders: Headers,
  proxyLimits: Required<WorkbenchProxyLimits>
): Promise<Response> {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), proxyLimits.timeoutMs);
  const clearDeadline = (): void => {
    if (deadline) clearTimeout(deadline);
    deadline = undefined;
  };

  try {
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readBoundedBody(request, proxyLimits.maxRequestBytes, controller.signal);
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: requestHeaders,
      body,
      redirect: 'error',
      signal: controller.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      clearDeadline();
      await upstream.body?.cancel().catch((): undefined => undefined);
      return jsonError(502, 'UPSTREAM_REDIRECT_REJECTED');
    }

    const declared = declaredContentLength(upstream.headers);
    if (declared != null && declared > proxyLimits.maxResponseBytes) {
      clearDeadline();
      controller.abort();
      await upstream.body?.cancel().catch((): undefined => undefined);
      return jsonError(502, 'PROXY_RESPONSE_TOO_LARGE');
    }

    const responseHeaders = safeResponseHeaders(upstream);
    const responseBody = boundedResponseBody(upstream, proxyLimits.maxResponseBytes, controller, clearDeadline);
    return new Response(responseBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    clearDeadline();
    if (error instanceof ProxyFailure) return jsonError(error.status, error.code);
    if (controller.signal.aborted) return jsonError(504, 'UPSTREAM_TIMEOUT');
    return jsonError(502, 'UPSTREAM_UNREACHABLE');
  }
}

function preflight(routeMethod: string, request: Request): Response {
  const requestedMethod = request.headers.get('access-control-request-method')?.toUpperCase();
  if (requestedMethod && requestedMethod !== routeMethod) return jsonError(405, 'PROXY_METHOD_FORBIDDEN');
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function proxyImageApiRequest(
  request: Request,
  url: URL,
  options: ImageApiProxyOptions
): Promise<Response> {
  const upstreamPath = url.pathname.slice(options.prefix.length) || '/';
  if (!url.pathname.startsWith(`${options.prefix}/`) || url.search || !isCleanPath(upstreamPath)) {
    return jsonError(400, 'BAD_PROXY_PATH');
  }

  const route = IMAGE_API_ROUTES.get(upstreamPath);
  if (!route) return jsonError(403, 'PROXY_ROUTE_FORBIDDEN');
  if (request.method === 'OPTIONS') return preflight(route.method, request);
  if (request.method !== route.method) return jsonError(405, 'PROXY_METHOD_FORBIDDEN');
  if (route.contentType && !route.contentType.test(request.headers.get('content-type') ?? '')) {
    return jsonError(415, 'PROXY_CONTENT_TYPE_FORBIDDEN');
  }

  const upstream = buildWorkbenchUpstreamUrl(options.baseUrl, upstreamPath);
  if (!upstream) return jsonError(502, 'INVALID_UPSTREAM_CONFIG');
  const configuredKey = options.apiKey?.trim();
  const clientAuthorization = request.headers.get('authorization')?.trim();
  const authorization = configuredKey
    ? `Bearer ${configuredKey}`
    : clientAuthorization && !MANAGED_AUTH_RE.test(clientAuthorization)
      ? clientAuthorization
      : undefined;
  return forward(request, upstream, safeRequestHeaders(request, authorization), limits(options));
}

function validateComfyRoute(request: Request, upstreamPath: string, url: URL): Response | null {
  let expectedMethod: 'GET' | 'POST' | undefined;
  if (upstreamPath === '/system_stats' && !url.search) expectedMethod = 'GET';
  else if (upstreamPath === '/prompt' && !url.search) expectedMethod = 'POST';
  else if (COMFY_HISTORY_PATH_RE.test(upstreamPath) && !url.search) expectedMethod = 'GET';
  else if (upstreamPath === '/view') {
    if (!url.searchParams.get('filename')) return jsonError(400, 'BAD_PROXY_PATH');
    for (const [key, value] of url.searchParams) {
      if (!COMFY_VIEW_QUERY_KEYS.has(key) || value.length > 1024 || value.includes('\0')) {
        return jsonError(400, 'BAD_PROXY_PATH');
      }
    }
    const type = url.searchParams.get('type');
    if (type && type !== 'input' && type !== 'output' && type !== 'temp') return jsonError(400, 'BAD_PROXY_PATH');
    expectedMethod = 'GET';
  }
  if (!expectedMethod) return jsonError(403, 'PROXY_ROUTE_FORBIDDEN');
  if (request.method === 'OPTIONS') return preflight(expectedMethod, request);
  if (request.method !== expectedMethod) return jsonError(405, 'PROXY_METHOD_FORBIDDEN');
  if (expectedMethod === 'POST' && !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return jsonError(415, 'PROXY_CONTENT_TYPE_FORBIDDEN');
  }
  return null;
}

export async function proxyComfyRequest(request: Request, url: URL, options: ComfyProxyOptions): Promise<Response> {
  const upstreamPath = url.pathname.slice(options.prefix.length) || '/';
  if (!url.pathname.startsWith(`${options.prefix}/`) || !isCleanPath(upstreamPath)) {
    return jsonError(400, 'BAD_PROXY_PATH');
  }
  const rejection = validateComfyRoute(request, upstreamPath, url);
  if (rejection) return rejection;

  const upstream = buildWorkbenchUpstreamUrl(options.baseUrl, upstreamPath, url.search);
  if (!upstream) return jsonError(502, 'INVALID_UPSTREAM_CONFIG');
  return forward(request, upstream, safeRequestHeaders(request), limits(options));
}
