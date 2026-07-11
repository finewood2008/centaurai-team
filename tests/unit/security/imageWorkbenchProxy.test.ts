import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWorkbenchUpstreamUrl,
  proxyComfyRequest,
  proxyImageApiRequest,
} from '@/process/security/imageWorkbenchProxy';

type CapturedRequest = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

describe('desktop image-workbench proxies', () => {
  let server: http.Server;
  let baseUrl: string;
  const captured: CapturedRequest[] = [];
  let responseHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeEach(async () => {
    captured.length = 0;
    responseHandler = (_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'upstream-secret=must-not-cross',
        'x-private-upstream-header': 'must-not-cross',
      });
      res.end(JSON.stringify({ ok: true }));
    };
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      captured.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      responseHandler(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('forwards only an allowlisted image route with the server key and safe headers', async () => {
    const response = await proxyImageApiRequest(
      new Request('centaur-image-workbench://app/__tokenclub/v1/images/generations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer attacker-value',
          cookie: 'desktop-secret=must-not-cross',
          'x-centaurai-role': 'admin',
        },
        body: JSON.stringify({ prompt: 'sunset' }),
      }),
      new URL('centaur-image-workbench://app/__tokenclub/v1/images/generations'),
      { prefix: '/__tokenclub', baseUrl, apiKey: 'server-secret' }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-private-upstream-header')).toBeNull();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ method: 'POST', url: '/v1/images/generations' });
    expect(captured[0].headers.authorization).toBe('Bearer server-secret');
    expect(captured[0].headers.cookie).toBeUndefined();
    expect(captured[0].headers['x-centaurai-role']).toBeUndefined();
  });

  it('makes an active upstream document inert on the privileged custom origin', async () => {
    responseHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<script>globalThis.pwned=true</script>');
    };

    const request = new Request('centaur-image-workbench://app/__tokenclub/v1/models');
    const response = await proxyImageApiRequest(request, new URL(request.url), {
      prefix: '/__tokenclub',
      baseUrl,
    });

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("sandbox; default-src 'none'");
    expect(await response.text()).toContain('<script>');
  });

  it('rejects arbitrary paths, methods, queries and content types before contacting upstream', async () => {
    const attempts = [
      new Request('centaur-image-workbench://app/__tokenclub/v1/chat/completions', { method: 'POST' }),
      new Request('centaur-image-workbench://app/__tokenclub/v1/models', { method: 'DELETE' }),
      new Request('centaur-image-workbench://app/__tokenclub/v1/models?target=metadata'),
      new Request('centaur-image-workbench://app/__tokenclub/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'not json',
      }),
    ];

    const statuses: number[] = [];
    for (const request of attempts) {
      statuses.push(
        (
          await proxyImageApiRequest(request, new URL(request.url), {
            prefix: '/__tokenclub',
            baseUrl,
            apiKey: 'server-secret',
          })
        ).status
      );
    }

    expect(statuses).toEqual([403, 405, 400, 415]);
    expect(captured).toHaveLength(0);
  });

  it('rejects redirects and enforces request and declared response size limits', async () => {
    responseHandler = (_req, res) => {
      res.writeHead(302, { location: `${baseUrl}/internal-secret` }).end();
    };
    const redirected = await proxyImageApiRequest(
      new Request('centaur-image-workbench://app/__tokenclub/v1/models'),
      new URL('centaur-image-workbench://app/__tokenclub/v1/models'),
      { prefix: '/__tokenclub', baseUrl }
    );
    expect(redirected.status).toBe(502);
    expect(captured.map((request) => request.url)).toEqual(['/v1/models']);

    captured.length = 0;
    const oversizedRequest = await proxyImageApiRequest(
      new Request('centaur-image-workbench://app/__tokenclub/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'too large' }),
      }),
      new URL('centaur-image-workbench://app/__tokenclub/v1/images/generations'),
      { prefix: '/__tokenclub', baseUrl, maxRequestBytes: 5 }
    );
    expect(oversizedRequest.status).toBe(413);
    expect(captured).toHaveLength(0);

    responseHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' }).end('{}');
    };
    const oversizedResponse = await proxyImageApiRequest(
      new Request('centaur-image-workbench://app/__tokenclub/v1/models'),
      new URL('centaur-image-workbench://app/__tokenclub/v1/models'),
      { prefix: '/__tokenclub', baseUrl, maxResponseBytes: 10 }
    );
    expect(oversizedResponse.status).toBe(502);
  });

  it('keeps the ComfyUI host capability on the four routes used by the bundled client', async () => {
    const allowed = await proxyComfyRequest(
      new Request('centaur-image-workbench://app/__comfyui/view?filename=a.png&subfolder=&type=output'),
      new URL('centaur-image-workbench://app/__comfyui/view?filename=a.png&subfolder=&type=output'),
      { prefix: '/__comfyui', baseUrl }
    );
    expect(allowed.status).toBe(200);
    await allowed.text();
    expect(captured[0].url).toBe('/view?filename=a.png&subfolder=&type=output');

    const blocked = await proxyComfyRequest(
      new Request('centaur-image-workbench://app/__comfyui/object_info'),
      new URL('centaur-image-workbench://app/__comfyui/object_info'),
      { prefix: '/__comfyui', baseUrl }
    );
    expect(blocked.status).toBe(403);
    expect(captured).toHaveLength(1);
  });

  it('preserves a configured /v1 base without duplicating the path', () => {
    expect(buildWorkbenchUpstreamUrl(`${baseUrl}/v1`, '/v1/models')?.href).toBe(`${baseUrl}/v1/models`);
    expect(buildWorkbenchUpstreamUrl('file:///etc/passwd', '/v1/models')).toBeNull();
    expect(buildWorkbenchUpstreamUrl('https://user:pass@example.com', '/v1/models')).toBeNull();
  });
});
