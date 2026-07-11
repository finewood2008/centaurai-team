import { isAllowedLocalVectorProxyRequest } from './mainWindowSecurity';

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Range, X-Requested-By',
  };
}

function safeVectorResponseHeaders(upstream: Response): Headers {
  const headers = new Headers(corsHeaders());
  for (const name of [
    'content-type',
    'content-length',
    'cache-control',
    'etag',
    'last-modified',
    'content-disposition',
    'accept-ranges',
    'content-range',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const contentType = headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    !contentType ||
    contentType === 'text/html' ||
    contentType === 'application/xhtml+xml' ||
    contentType === 'image/svg+xml' ||
    contentType === 'text/xml' ||
    contentType === 'application/xml' ||
    contentType.endsWith('+xml')
  ) {
    headers.set('content-type', contentType ? 'text/plain; charset=utf-8' : 'application/octet-stream');
    headers.set('content-security-policy', "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'");
  }
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  return headers;
}

export function createLocalVectorProtocolHandler(
  resolveEndpoint: () => Promise<string>,
  fetchImpl: typeof fetch = fetch
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const responseCorsHeaders = corsHeaders();
    if (url.hostname !== 'local') {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: responseCorsHeaders });
    }

    if (request.method === 'OPTIONS') {
      const requestedMethod = request.headers.get('access-control-request-method')?.toUpperCase() || '';
      if (!isAllowedLocalVectorProxyRequest(requestedMethod, url.pathname)) {
        return Response.json({ error: 'Forbidden' }, { status: 403, headers: responseCorsHeaders });
      }
      return new Response(null, { status: 204, headers: responseCorsHeaders });
    }
    if (!isAllowedLocalVectorProxyRequest(request.method, url.pathname)) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: responseCorsHeaders });
    }

    const headers = new Headers();
    for (const name of ['content-type', 'accept', 'range']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('accept-encoding', 'identity');
    if (request.method === 'POST' || request.method === 'DELETE') {
      headers.set('x-requested-by', 'centaur-vdb');
    }

    try {
      const endpoint = new URL(await resolveEndpoint());
      if (
        (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      ) {
        throw new Error('INVALID_VECTOR_ENDPOINT');
      }
      endpoint.pathname = url.pathname;
      endpoint.search = url.search;
      const timeoutMs = url.pathname === '/api/upload' ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
      const methodHasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const init = {
        method: request.method,
        headers,
        body: methodHasBody ? request.body : undefined,
        redirect: 'error' as const,
        signal: AbortSignal.timeout(timeoutMs),
        duplex: 'half' as const,
      } as RequestInit & { duplex: 'half' };
      const upstreamResponse = await fetchImpl(endpoint, init);
      const responseHeaders = safeVectorResponseHeaders(upstreamResponse);
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CentaurAI] Local vector proxy failed:', message);
      return Response.json({ error: 'VECTOR_DB_UNREACHABLE' }, { status: 502, headers: responseCorsHeaders });
    }
  };
}
