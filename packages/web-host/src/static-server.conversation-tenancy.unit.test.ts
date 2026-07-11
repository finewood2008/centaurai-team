import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { startStaticServer, type StaticServerHandle } from './static-server.js';
import { CONVERSATION_OWNER_EXTRA_KEY } from './conversation-tenancy.js';

type Conversation = {
  id: string;
  name?: string;
  type?: string;
  model?: Record<string, unknown>;
  extra: Record<string, unknown>;
};

async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
  res.end(JSON.stringify(data));
}

describe('static server conversation tenancy', () => {
  let handle: StaticServerHandle | null = null;
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((fn) => fn()));
    await handle?.stop();
    handle = null;
  });

  it('uses the gate identity for HTTP ownership and filters the LAN WebSocket stream', async () => {
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenant-static-'));
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenant-data-'));
    await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>tenant</title>');
    cleanup.push(async () => fs.rm(staticDir, { recursive: true, force: true }));
    cleanup.push(async () => fs.rm(dataDir, { recursive: true, force: true }));

    const conversations = new Map<string, Conversation>();
    let lastMessageBody: unknown;
    const backendHttp = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/login') {
        const userId = String(req.headers['x-test-user'] || 'unknown');
        json(res, 200, { success: true, user: { id: userId, username: userId } });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/agents') {
        json(res, 200, {
          success: true,
          data: [
            {
              id: 'safe-aionrs',
              name: 'Direct Model',
              agent_type: 'aionrs',
              agent_source: 'internal',
              enabled: true,
              available: true,
            },
            {
              id: 'trusted-codex',
              name: 'Codex CLI',
              backend: 'codex',
              agent_type: 'acp',
              enabled: true,
              available: true,
              handshake: { available_models: { available_models: [] } },
            },
          ],
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/providers') {
        json(res, 200, {
          success: true,
          data: [{ id: 'trusted-provider', platform: 'openai', enabled: true, models: ['safe-model'] }],
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/assistants') {
        json(res, 200, { success: true, data: [] });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/conversations') {
        const items = [...conversations.values()];
        json(res, 200, { success: true, data: { items, total: items.length, has_more: false } });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/conversations') {
        const input = await body(req);
        const row = { ...input, id: String(input.id), extra: input.extra as Record<string, unknown> } as Conversation;
        conversations.set(row.id, row);
        json(res, 201, { success: true, data: row });
        return;
      }
      const match = /^\/api\/conversations\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (match) {
        const row = conversations.get(match[1] ?? '');
        if (!row) {
          json(res, 404, { success: false });
          return;
        }
        if (req.method === 'GET' && !match[2]) {
          json(res, 200, { success: true, data: row });
          return;
        }
        if (req.method === 'POST' && match[2] === '/messages') {
          lastMessageBody = await body(req);
          json(res, 200, { success: true, data: { msg_id: 'created' } });
          return;
        }
      }
      json(res, 404, { success: false });
    });
    const backendWs = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    backendHttp.on('upgrade', (req, socket, head) => {
      backendWs.handleUpgrade(req, socket, head, (ws) => backendWs.emit('connection', ws, req));
    });
    await new Promise<void>((resolve) => backendHttp.listen(0, '127.0.0.1', resolve));
    const backendPort = (backendHttp.address() as AddressInfo).port;
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          for (const client of backendWs.clients) client.terminate();
          backendWs.close(() => backendHttp.close(() => resolve()));
        })
    );

    handle = await startStaticServer({
      staticDir,
      dataDir,
      backendPort,
      port: 0,
      allowRemote: true,
    });
    const login = async (userId: string): Promise<string> => {
      const response = await fetch(`${handle!.localUrl}/login`, {
        method: 'POST',
        headers: { 'x-test-user': userId, connection: 'close' },
      });
      expect(response.status).toBe(200);
      return response.headers.get('x-webui-gate-token') ?? '';
    };
    const aliceToken = await login('alice');
    const bobToken = await login('bob');
    const lanAgents = (await (
      await fetch(`${handle.localUrl}/api/agents`, {
        headers: { 'x-webui-gate-token': aliceToken, connection: 'close' },
      })
    ).json()) as { data: Array<{ id: string }> };
    expect(lanAgents.data.map((agent) => agent.id)).toEqual(['safe-aionrs']);

    const created = await fetch(`${handle.localUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webui-gate-token': aliceToken,
        connection: 'close',
      },
      body: JSON.stringify({
        id: 'alice-conversation',
        type: 'aionrs',
        model: { provider_id: 'trusted-provider', model: 'safe-model' },
        extra: {
          [CONVERSATION_OWNER_EXTRA_KEY]: 'bob',
          agent_id: 'trusted-codex',
          backend: 'codex',
          cli_path: '/tmp/evil',
          session_mode: 'full-access',
          workspace: '/etc',
        },
      }),
    });
    expect(created.status).toBe(201);
    expect(conversations.get('alice-conversation')?.extra).toMatchObject({
      [CONVERSATION_OWNER_EXTRA_KEY]: 'alice',
      workspace: '',
      is_temporary_workspace: true,
    });
    expect(conversations.get('alice-conversation')?.extra.cli_path).toBeUndefined();

    const bobRead = await fetch(`${handle.localUrl}/api/conversations/alice-conversation`, {
      headers: { 'x-webui-gate-token': bobToken, connection: 'close' },
    });
    expect(bobRead.status).toBe(404);
    const aliceList = (await (
      await fetch(`${handle.localUrl}/api/conversations`, {
        headers: { 'x-webui-gate-token': aliceToken, connection: 'close' },
      })
    ).json()) as { data: { items: Conversation[] } };
    expect(aliceList.data.items.map((row) => row.id)).toEqual(['alice-conversation']);

    const sent = await fetch(`${handle.localUrl}/api/conversations/alice-conversation/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webui-gate-token': aliceToken,
        connection: 'close',
      },
      body: JSON.stringify({ content: 'hello', files: ['/etc/passwd'] }),
    });
    expect(sent.status).toBe(200);
    expect(lastMessageBody).toEqual({ content: 'hello', files: [] });

    const upstreamConnection = new Promise<WebSocket>((resolve) => backendWs.once('connection', resolve));
    const browser = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?gate=${encodeURIComponent(aliceToken)}`, {
      perMessageDeflate: false,
    });
    cleanup.push(async () => browser.terminate());
    await new Promise<void>((resolve, reject) => {
      browser.once('open', resolve);
      browser.once('error', reject);
    });
    const upstream = await upstreamConnection;
    const received: unknown[] = [];
    browser.on('message', (message) => received.push(JSON.parse(message.toString()) as unknown));
    upstream.send(
      JSON.stringify({ name: 'message.stream', data: { conversation_id: 'alice-conversation', text: 'mine' } })
    );
    upstream.send(JSON.stringify({ name: 'message.stream', data: { conversation_id: 'bob-conversation' } }));
    upstream.send(JSON.stringify({ name: 'global.event', data: { host_path: '/home/user' } }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual([
      { name: 'message.stream', data: { conversation_id: 'alice-conversation', text: 'mine' } },
    ]);
  });
});
