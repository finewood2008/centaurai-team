import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalVectorProtocolHandler } from '@/process/security/localVectorProtocol';

type CapturedRequest = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

describe('local vector custom protocol', () => {
  let server: http.Server;
  let endpoint: string;
  const captured: CapturedRequest[] = [];

  beforeEach(async () => {
    captured.length = 0;
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      captured.push({
        method: req.method || '',
        url: req.url || '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-cross' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('streams an allowlisted search and injects the local mutation marker', async () => {
    const handler = createLocalVectorProtocolHandler(async () => endpoint);
    const response = await handler(
      new Request('centaur-vector://local/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'quarterly plan' }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(captured[0]).toMatchObject({ method: 'POST', url: '/api/search' });
    expect(captured[0].headers['x-requested-by']).toBe('centaur-vdb');
    expect(JSON.parse(captured[0].body.toString('utf8'))).toEqual({ query: 'quarterly plan' });
  });

  it('streams multipart uploads without exposing an arbitrary upstream URL', async () => {
    const form = new FormData();
    form.append('file', new Blob(['hello knowledge']), 'notes.txt');
    const handler = createLocalVectorProtocolHandler(async () => endpoint);

    const response = await handler(
      new Request('centaur-vector://local/api/upload', {
        method: 'POST',
        body: form,
      })
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(captured[0].url).toBe('/api/upload');
    expect(captured[0].headers['content-type']).toContain('multipart/form-data; boundary=');
    expect(captured[0].body.toString('utf8')).toContain('hello knowledge');
  });

  it.each(['/api/health', '/api/stats'])('allows the read-only status route %s', async (path) => {
    const handler = createLocalVectorProtocolHandler(async () => endpoint);

    const response = await handler(new Request(`centaur-vector://local${path}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(captured[0]).toMatchObject({ method: 'GET', url: path });
  });

  it('makes active upstream content inert and strips non-allowlisted headers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<svg><script>globalThis.pwned=true</script></svg>', {
        headers: {
          'content-type': 'image/svg+xml',
          'set-cookie': 'secret=must-not-cross',
          'x-vector-private': 'must-not-cross',
        },
      })
    );
    const handler = createLocalVectorProtocolHandler(async () => endpoint, fetchImpl);

    const response = await handler(new Request('centaur-vector://local/api/image?path=diagram.svg'));

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("sandbox; default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-vector-private')).toBeNull();
    expect(await response.text()).toContain('<script>');
  });

  it('rejects reindex, memory, foreign-host and malformed document routes before fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const handler = createLocalVectorProtocolHandler(async () => endpoint, fetchImpl);
    const requests = [
      new Request('centaur-vector://local/api/reindex', { method: 'POST' }),
      new Request('centaur-vector://local/api/memory/files'),
      new Request('centaur-vector://attacker/api/search', { method: 'POST' }),
      new Request('centaur-vector://local/api/documents/a/b', { method: 'DELETE' }),
    ];

    const responses = await Promise.all(requests.map((request) => handler(request)));
    for (const response of responses) expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers preflight only for the route's allowed method", async () => {
    const handler = createLocalVectorProtocolHandler(async () => endpoint);
    const allowed = await handler(
      new Request('centaur-vector://local/api/search', {
        method: 'OPTIONS',
        headers: { 'access-control-request-method': 'POST' },
      })
    );
    const denied = await handler(
      new Request('centaur-vector://local/api/reindex', {
        method: 'OPTIONS',
        headers: { 'access-control-request-method': 'POST' },
      })
    );

    expect(allowed.status).toBe(204);
    expect(denied.status).toBe(403);
    expect(captured).toHaveLength(0);
  });
});
