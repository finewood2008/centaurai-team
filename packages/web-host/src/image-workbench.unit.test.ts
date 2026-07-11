import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  handleComfyUIProxy,
  handleImageWorkbenchProxy,
  handleImageWorkbenchStatic,
  type ImageWorkbenchProxyOptions,
} from './image-workbench.js';

async function mkSpaDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-imgwb-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><script src="./assets/app.js"></script>');
  await fs.mkdir(path.join(dir, 'assets'));
  await fs.writeFile(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

function rawRequest(
  port: number,
  requestPath: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        res.on('data', (c) => chunks.push(c));
        res.on('aborted', () => fail(new Error('response aborted')));
        res.on('error', fail);
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
            headers: res.headers,
          });
        });
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Static-only server: routes /workbench/image/* (incl. __proxy) through the handlers. */
async function startImgServer(
  dir: string | undefined,
  imageKey?: string,
  imageBaseUrl?: string,
  options: { comfyTrusted?: boolean; proxy?: ImageWorkbenchProxyOptions } = {}
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/workbench/image/__proxy/comfyui/')) {
      handleComfyUIProxy(req, res, { ...options.proxy, trusted: options.comfyTrusted });
    } else if (req.url?.startsWith('/workbench/image/__proxy/')) {
      handleImageWorkbenchProxy(req, res, imageKey, imageBaseUrl, options.proxy);
    } else if (req.url?.startsWith('/workbench/image/') || req.url === '/workbench/image') {
      void handleImageWorkbenchStatic(
        req,
        res,
        dir,
        imageKey ? { apiKey: imageKey, model: 'admin-image-model' } : undefined
      );
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('image workbench — static SPA serving', () => {
  let dir: string | null = null;
  let srv: { port: number; close: () => Promise<void> } | null = null;
  afterEach(async () => {
    if (srv) await srv.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    srv = dir = null;
  });

  it('serves index.html for the explicit entry and the bare subpath', async () => {
    dir = await mkSpaDir();
    srv = await startImgServer(dir);
    for (const url of ['/workbench/image/index.html', '/workbench/image', '/workbench/image/']) {
      const r = await fetch(`http://127.0.0.1:${srv.port}${url}`);
      expect(r.status, url).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/html');
      expect(await r.text()).toContain('<script');
    }
  });

  it('serves a hashed asset with the right content-type', async () => {
    dir = await mkSpaDir();
    srv = await startImgServer(dir);
    const r = await fetch(`http://127.0.0.1:${srv.port}/workbench/image/assets/app.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('javascript');
    expect(await r.text()).toBe('console.log(1)');
  });

  it('falls back to index.html for an extensionless client route', async () => {
    dir = await mkSpaDir();
    srv = await startImgServer(dir);
    const r = await fetch(`http://127.0.0.1:${srv.port}/workbench/image/some/spa/route`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  it('404s a missing asset (never serves HTML as JS)', async () => {
    dir = await mkSpaDir();
    srv = await startImgServer(dir);
    const r = await fetch(`http://127.0.0.1:${srv.port}/workbench/image/assets/missing.js`);
    expect(r.status).toBe(404);
  });

  it('rejects path traversal out of the dist dir', async () => {
    dir = await mkSpaDir();
    srv = await startImgServer(dir);
    const r = await fetch(`http://127.0.0.1:${srv.port}/workbench/image/..%2f..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(r.status);
    expect(await r.text()).not.toContain('root:');
  });

  it('404s when the workbench dir is unset (feature disabled)', async () => {
    srv = await startImgServer(undefined);
    const r = await fetch(`http://127.0.0.1:${srv.port}/workbench/image/index.html`);
    expect(r.status).toBe(404);
  });

  it('redirects the SPA entry to a managed LAN profile without exposing the real key', async () => {
    dir = await mkSpaDir();
    srv = await startImgServer(dir, 'SERVER_KEY');
    const r = await fetch(`http://127.0.0.1:${srv.port}/workbench/image/index.html`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const location = r.headers.get('location') ?? '';
    expect(location).toContain('apiUrl=');
    expect(location).toContain('apiKey=centaur-lan-managed');
    expect(location).toContain('model=admin-image-model');
    expect(location).not.toContain('SERVER_KEY');
  });
});

describe('image workbench — ComfyUI proxy', () => {
  let upstream: {
    port: number;
    close: () => Promise<void>;
    received: http.IncomingMessage[];
    bodies: string[];
  } | null = null;
  let srv: { port: number; close: () => Promise<void> } | null = null;
  const prevEnv = process.env.AIONUI_COMFYUI_UPSTREAM_URL;

  afterEach(async () => {
    if (srv) await srv.close();
    if (upstream) await upstream.close();
    srv = upstream = null;
    if (prevEnv === undefined) delete process.env.AIONUI_COMFYUI_UPSTREAM_URL;
    else process.env.AIONUI_COMFYUI_UPSTREAM_URL = prevEnv;
  });

  async function startMockComfy() {
    const received: http.IncomingMessage[] = [];
    const bodies: string[] = [];
    const server = http.createServer((req, res) => {
      received.push(req);
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf-8'));
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'upstream_session=must-not-stick' });
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    return { port, received, bodies, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it('is disabled by default and never reaches the host-local ComfyUI API', async () => {
    upstream = await startMockComfy();
    process.env.AIONUI_COMFYUI_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined);

    const r = await rawRequest(srv.port, '/workbench/image/__proxy/comfyui/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(r.status).toBe(403);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'COMFYUI_PROXY_DISABLED' });
    expect(upstream.received).toHaveLength(0);
  });

  it('forwards explicitly trusted ComfyUI calls and strips WebUI credentials', async () => {
    upstream = await startMockComfy();
    process.env.AIONUI_COMFYUI_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, undefined, undefined, { comfyTrusted: true });
    const r = await rawRequest(srv.port, '/workbench/image/__proxy/comfyui/prompt', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'webui_gate=secret',
        'x-webui-gate-token': 'native-client-secret',
        connection: 'x-test-hop',
        'x-test-hop': 'drop-me',
      },
      body: JSON.stringify({ prompt: { a: 1 } }),
    });

    expect(r.status).toBe(200);
    expect((JSON.parse(r.body) as { path: string }).path).toBe('/prompt');
    const up = upstream.received[0];
    expect(up.url).toBe('/prompt');
    expect(up.headers.cookie).toBeUndefined();
    expect(up.headers['x-webui-gate-token']).toBeUndefined();
    expect(up.headers['x-test-hop']).toBeUndefined();
    expect(upstream.bodies[0]).toBe(JSON.stringify({ prompt: { a: 1 } }));
  });

  it('preserves query params for image view requests', async () => {
    upstream = await startMockComfy();
    process.env.AIONUI_COMFYUI_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, undefined, undefined, { comfyTrusted: true });
    const r = await fetch(
      `http://127.0.0.1:${srv.port}/workbench/image/__proxy/comfyui/view?filename=a.png&type=output`
    );

    expect(r.status).toBe(200);
    expect((await r.json()).path).toBe('/view?filename=a.png&type=output');
    expect(upstream.received[0].url).toBe('/view?filename=a.png&type=output');
  });
});

describe('image workbench — upstream proxy', () => {
  let upstream: {
    port: number;
    close: () => Promise<void>;
    received: http.IncomingMessage[];
    bodies: string[];
  } | null = null;
  let srv: { port: number; close: () => Promise<void> } | null = null;
  const prevEnv = process.env.AIONUI_IMAGE_UPSTREAM_URL;

  afterEach(async () => {
    if (srv) await srv.close();
    if (upstream) await upstream.close();
    srv = upstream = null;
    if (prevEnv === undefined) delete process.env.AIONUI_IMAGE_UPSTREAM_URL;
    else process.env.AIONUI_IMAGE_UPSTREAM_URL = prevEnv;
  });

  async function startMockUpstream() {
    const received: http.IncomingMessage[] = [];
    const bodies: string[] = [];
    const server = http.createServer((req, res) => {
      received.push(req);
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf-8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    return { port, received, bodies, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  async function startControlledUpstream(
    respond: (req: http.IncomingMessage, res: http.ServerResponse) => void
  ): Promise<NonNullable<typeof upstream>> {
    const received: http.IncomingMessage[] = [];
    const bodies: string[] = [];
    const sockets = new Set<import('node:net').Socket>();
    const server = http.createServer((req, res) => {
      received.push(req);
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf-8'));
        respond(req, res);
      });
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    return {
      port: (server.address() as AddressInfo).port,
      received,
      bodies,
      close: () =>
        new Promise<void>((resolve) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
        }),
    };
  }

  it('injects the server key, strips the session cookie, and forwards path+body', async () => {
    upstream = await startMockUpstream();
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123');
    const r = await fetch(`http://127.0.0.1:${srv.port}/workbench/image/__proxy/v1/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer CLIENT_SHOULD_BE_OVERRIDDEN',
        cookie: 'webui_gate=secret',
        'x-webui-gate-token': 'native-client-secret',
      },
      body: JSON.stringify({ prompt: 'a cat' }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).path).toBe('/v1/images/generations');
    const up = upstream.received[0];
    expect(up.url).toBe('/v1/images/generations');
    expect(up.headers.authorization).toBe('Bearer SERVER_KEY_123');
    expect(up.headers.cookie).toBeUndefined();
    expect(up.headers['x-webui-gate-token']).toBeUndefined();
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(upstream.bodies[0]).toBe(JSON.stringify({ prompt: 'a cat' }));
  });

  it('passes the client Authorization through when no server key is set', async () => {
    upstream = await startMockUpstream();
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined);
    await fetch(`http://127.0.0.1:${srv.port}/workbench/image/__proxy/v1/models`, {
      headers: { authorization: 'Bearer CLIENT_KEY', cookie: 'webui_gate=secret' },
    });
    const up = upstream.received[0];
    expect(up.headers.authorization).toBe('Bearer CLIENT_KEY');
    expect(up.headers.cookie).toBeUndefined();
  });

  it('strips the managed placeholder Authorization when no server key is set', async () => {
    upstream = await startMockUpstream();
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined);
    await fetch(`http://127.0.0.1:${srv.port}/workbench/image/__proxy/v1/models`, {
      headers: { authorization: 'Bearer centaur-lan-managed' },
    });
    expect(upstream.received[0].headers.authorization).toBeUndefined();
  });

  it('makes an active upstream document inert on the authenticated WebHost origin', async () => {
    upstream = await startControlledUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<script>globalThis.pwned=true</script>');
    });
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123');

    const response = await fetch(`http://127.0.0.1:${srv.port}/workbench/image/__proxy/v1/models`);

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("sandbox; default-src 'none'");
    expect(await response.text()).toContain('<script>');
  });

  it('uses the configured upstream base URL without duplicating /v1', async () => {
    upstream = await startMockUpstream();
    srv = await startImgServer(undefined, 'SERVER_KEY_123', `http://127.0.0.1:${upstream.port}/api/v1`);
    await fetch(`http://127.0.0.1:${srv.port}/workbench/image/__proxy/v1/models`);
    expect(upstream.received[0].url).toBe('/api/v1/models');
  });

  it('allows only the bundled workbench generation, edit, responses and model-list routes', async () => {
    upstream = await startMockUpstream();
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123');

    const responses = await rawRequest(srv.port, '/workbench/image/__proxy/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const edits = await rawRequest(srv.port, '/workbench/image/__proxy/v1/images/edits', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body: '--test--\r\n',
    });

    expect(responses.status).toBe(200);
    expect(edits.status).toBe(200);
    expect(upstream.received.map((request) => request.url)).toEqual(['/v1/responses', '/v1/images/edits']);
  });

  it('rejects arbitrary API routes, wrong methods, content types and path-confusion spellings before upstream', async () => {
    upstream = await startMockUpstream();
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123');

    const attempts = [
      await rawRequest(srv.port, '/workbench/image/__proxy/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      await rawRequest(srv.port, '/workbench/image/__proxy/v1/models', { method: 'DELETE' }),
      await rawRequest(srv.port, '/workbench/image/__proxy/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      }),
      await rawRequest(srv.port, '/workbench/image/__proxy/v1/images/%67enerations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      await rawRequest(srv.port, '/workbench/image/__proxy/v1/images/generations?admin=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ];

    expect(attempts.map((attempt) => attempt.status)).toEqual([403, 405, 415, 400, 400]);
    expect(upstream.received).toHaveLength(0);
  });

  it('rejects an oversized request from Content-Length before opening the upstream', async () => {
    upstream = await startMockUpstream();
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123', undefined, { proxy: { maxRequestBytes: 8 } });

    const r = await rawRequest(srv.port, '/workbench/image/__proxy/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '32' },
      body: 'x'.repeat(32),
    });

    expect(r.status).toBe(413);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'PROXY_REQUEST_TOO_LARGE' });
    expect(upstream.received).toHaveLength(0);
  });

  it('cuts off an oversized chunked request even without Content-Length', async () => {
    upstream = await startControlledUpstream((_req, res) => {
      res.writeHead(200).end();
    });
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123', undefined, { proxy: { maxRequestBytes: 8 } });

    const r = await rawRequest(srv.port, '/workbench/image/__proxy/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(32),
    });

    expect(r.status).toBe(413);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'PROXY_REQUEST_TOO_LARGE' });
    expect(upstream.bodies).toHaveLength(0);
  });

  it('rejects an oversized declared upstream response before forwarding bytes', async () => {
    upstream = await startControlledUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '32' });
      res.end('x'.repeat(32));
    });
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123', undefined, { proxy: { maxResponseBytes: 8 } });

    const r = await rawRequest(srv.port, '/workbench/image/__proxy/v1/models');

    expect(r.status).toBe(502);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'PROXY_RESPONSE_TOO_LARGE' });
  });

  it('terminates a chunked upstream response once the byte cap is crossed', async () => {
    upstream = await startControlledUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('x'.repeat(4));
      res.end('y'.repeat(16));
    });
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123', undefined, { proxy: { maxResponseBytes: 8 } });

    await expect(rawRequest(srv.port, '/workbench/image/__proxy/v1/models')).rejects.toThrow(
      /response aborted|socket hang up/
    );
  });

  it('rejects upstream redirects without following them or forwarding Location', async () => {
    upstream = await startControlledUpstream((_req, res) => {
      res.writeHead(302, { location: '/v1/account/secrets' });
      res.end();
    });
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123');

    const r = await rawRequest(srv.port, '/workbench/image/__proxy/v1/models');

    expect(r.status).toBe(502);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'UPSTREAM_REDIRECT_REJECTED' });
    expect(r.headers.location).toBeUndefined();
    expect(upstream.received).toHaveLength(1);
  });

  it('terminates a stalled upstream at the configured wall-clock deadline', async () => {
    upstream = await startControlledUpstream(() => {
      // Intentionally never respond. The proxy deadline must close this socket.
    });
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    srv = await startImgServer(undefined, 'SERVER_KEY_123', undefined, { proxy: { timeoutMs: 30 } });

    const r = await rawRequest(srv.port, '/workbench/image/__proxy/v1/models');

    expect(r.status).toBe(504);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'UPSTREAM_TIMEOUT' });
  });

  it('rejects a userinfo-retarget SSRF attempt at the guard (remainder not starting with /)', () => {
    let code = 0;
    const res = {
      headersSent: false,
      writeHead(c: number) {
        code = c;
        return this;
      },
      end() {
        return this;
      },
      destroy() {},
    } as unknown as http.ServerResponse;
    // `/workbench/image/__proxy@evil…` → remainder `@evil…` would otherwise build
    // `https://api.tokenclub.pro@evil…` (credentials-in-userinfo retarget).
    const req = {
      url: '/workbench/image/__proxy@evil.example.com/x',
      method: 'GET',
      headers: {},
      pipe() {},
    } as unknown as http.IncomingMessage;
    handleImageWorkbenchProxy(req, res, 'K');
    expect(code).toBe(400);
  });
});
