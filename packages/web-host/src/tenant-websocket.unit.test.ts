import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import type { ConversationTenantBoundary } from './conversation-tenancy.js';
import { isAllowedTenantWebSocketOrigin, proxyTenantWebSocket } from './tenant-websocket.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

async function waitFor<T>(register: (resolve: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), 3_000);
    register(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

describe('tenant WebSocket gateway', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('requires same-origin browser handshakes but permits a valid native bearer origin', () => {
    expect(isAllowedTenantWebSocketOrigin('http://server.local:25812', 'server.local:25812', false)).toBe(true);
    expect(isAllowedTenantWebSocketOrigin('https://attacker.example', 'server.local:25812', false)).toBe(false);
    expect(isAllowedTenantWebSocketOrigin('file://', 'server.local:25812', false)).toBe(false);
    expect(isAllowedTenantWebSocketOrigin('file://', 'server.local:25812', true)).toBe(true);
    expect(isAllowedTenantWebSocketOrigin('null', 'server.local:25812', true)).toBe(true);
    expect(isAllowedTenantWebSocketOrigin('javascript:alert(1)', 'server.local:25812', true)).toBe(false);
  });

  it('forwards only owned conversation events, handles ping locally and drops client controls', async () => {
    const backendHttp = http.createServer();
    const backendWs = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    backendHttp.on('upgrade', (req, socket, head) => {
      // Assert the gateway stripped both gate credentials and compression from
      // the trusted-backend handshake.
      expect(req.headers.cookie).toBeUndefined();
      expect(req.headers['x-webui-gate-token']).toBeUndefined();
      expect(req.headers['sec-websocket-extensions']).toBeUndefined();
      backendWs.handleUpgrade(req, socket, head, (ws) => backendWs.emit('connection', ws, req));
    });
    await new Promise<void>((resolve) => backendHttp.listen(0, '127.0.0.1', resolve));
    const backendPort = (backendHttp.address() as AddressInfo).port;
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          backendWs.close(() => backendHttp.close(() => resolve()));
          for (const client of backendWs.clients) client.terminate();
        })
    );

    let authorized = true;
    const boundary: ConversationTenantBoundary = {
      handleHttpRequest: async () => false,
      ownsConversation: async (_identity, conversationId) => conversationId === 'owned',
      shouldForwardWebSocketPayload: async (_identity, payload) => {
        const record = payload as { data?: { conversation_id?: string } };
        return record.data?.conversation_id === 'owned';
      },
    };

    const gateway = net.createServer((client) => {
      let initial = Buffer.alloc(0);
      const onData = (chunk: Buffer): void => {
        initial = Buffer.concat([initial, chunk]);
        if (initial.indexOf('\r\n\r\n') < 0) return;
        client.removeListener('data', onData);
        proxyTenantWebSocket(client, {
          backendPort,
          initialBytes: initial,
          identity: { userId: 'alice' },
          boundary,
          isStillAuthorized: () => authorized,
          allowCrossOriginWithBearer: true,
        });
      };
      client.on('data', onData);
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    const gatewayPort = (gateway.address() as AddressInfo).port;
    cleanups.push(() => new Promise<void>((resolve) => gateway.close(() => resolve())));

    const backendConnection = waitFor<WebSocket>((resolve) => {
      backendWs.once('connection', (ws) => resolve(ws));
    });
    const browser = new WebSocket(`ws://127.0.0.1:${gatewayPort}/ws?gate=secret`, {
      headers: {
        Cookie: 'webui_gate=secret; backend=cookie',
        'X-WebUI-Gate-Token': 'secret',
        Origin: 'file://',
      },
      perMessageDeflate: true,
    });
    cleanups.push(async () => browser.terminate());
    await waitFor<void>((resolve, reject) => {
      browser.once('open', () => resolve());
      browser.once('error', (error) => reject(error));
    });
    const upstream = await backendConnection;

    const browserMessages: unknown[] = [];
    browser.on('message', (data) => browserMessages.push(JSON.parse(data.toString()) as unknown));
    const upstreamMessages: unknown[] = [];
    upstream.on('message', (data) => upstreamMessages.push(JSON.parse(data.toString()) as unknown));

    upstream.send(JSON.stringify({ name: 'message.stream', data: { conversation_id: 'owned', text: 'visible' } }));
    upstream.send(JSON.stringify({ name: 'message.stream', data: { conversation_id: 'other', text: 'secret' } }));
    upstream.send(JSON.stringify({ name: 'global.event', data: { secret: true } }));
    upstream.send(JSON.stringify({ name: 'ping', data: { timestamp: Date.now() } }));
    browser.send(JSON.stringify({ name: 'dangerous.control', data: { delete: true } }));

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(browserMessages).toEqual([{ name: 'message.stream', data: { conversation_id: 'owned', text: 'visible' } }]);
    expect(upstreamMessages).toHaveLength(1);
    expect((upstreamMessages[0] as { name?: string }).name).toBe('pong');

    const closed = waitFor<number>((resolve) => browser.once('close', (code) => resolve(code)));
    authorized = false;
    upstream.send(JSON.stringify({ name: 'message.stream', data: { conversation_id: 'owned' } }));
    expect(await closed).toBe(1008);
  });

  it('rejects a backend handshake with a forged Sec-WebSocket-Accept', async () => {
    const backend = net.createServer((socket) => {
      socket.once('data', (head: Buffer) => {
        const key = /sec-websocket-key:\s*([^\r\n]+)/i.exec(head.toString('latin1'))?.[1]?.trim() ?? '';
        const correct = createHash('sha1').update(`${key}${GUID}`).digest('base64');
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: forged-${correct}\r\n\r\n`
        );
      });
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const backendPort = (backend.address() as AddressInfo).port;
    cleanups.push(() => new Promise<void>((resolve) => backend.close(() => resolve())));

    const boundary: ConversationTenantBoundary = {
      handleHttpRequest: async () => false,
      ownsConversation: async () => true,
      shouldForwardWebSocketPayload: async () => true,
    };
    const gateway = net.createServer((client) => {
      client.once('data', (initialBytes: Buffer) => {
        proxyTenantWebSocket(client, {
          backendPort,
          initialBytes,
          identity: { userId: 'alice' },
          boundary,
          isStillAuthorized: () => true,
        });
      });
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    const gatewayPort = (gateway.address() as AddressInfo).port;
    cleanups.push(() => new Promise<void>((resolve) => gateway.close(() => resolve())));

    const response = await waitFor<string>((resolve, reject) => {
      const client = net.connect({ host: '127.0.0.1', port: gatewayPort }, () => {
        client.write(
          'GET /ws HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${gatewayPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
        );
      });
      const chunks: Buffer[] = [];
      client.on('data', (chunk) => chunks.push(chunk));
      client.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
      client.on('error', reject);
    });
    expect(response).toContain('502 Bad Gateway');
  });
});
