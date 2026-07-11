import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  CONVERSATION_OWNER_EXTRA_KEY,
  createConversationTenantBoundary,
  type ConversationTenantBoundary,
} from './conversation-tenancy.js';

type Conversation = {
  id: string;
  name?: string;
  type?: string;
  status?: string;
  model?: Record<string, unknown>;
  extra: Record<string, unknown>;
};

type BackendFixture = {
  port: number;
  conversations: Map<string, Conversation>;
  lastBody: unknown;
  lastHeaders: http.IncomingHttpHeaders | null;
  nonJsonReset: boolean;
  close: () => Promise<void>;
};

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown;
}

function send(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function startBackend(initial: Conversation[]): Promise<BackendFixture> {
  const conversations = new Map(initial.map((row) => [row.id, structuredClone(row)]));
  const fixture: BackendFixture = {
    port: 0,
    conversations,
    lastBody: undefined,
    lastHeaders: null,
    nonJsonReset: false,
    close: async () => {},
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/agents/management') {
      send(res, 200, {
        success: true,
        data: [
          {
            id: 'trusted-codex',
            name: 'Codex CLI',
            backend: 'codex',
            agent_type: 'acp',
            enabled: true,
            available: true,
            handshake: {
              available_models: { available_models: [{ id: 'gpt-safe', label: 'GPT Safe' }] },
            },
          },
        ],
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/providers') {
      send(res, 200, {
        success: true,
        data: [
          {
            id: 'trusted-provider',
            platform: 'openai',
            name: 'Trusted Provider',
            base_url: 'https://trusted.example/v1',
            api_key: 'TRUSTED_SERVER_KEY',
            enabled: true,
            models: ['safe-model'],
          },
        ],
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/assistants') {
      send(res, 200, { success: true, data: [{ id: 'safe-assistant' }, { id: 'centaurai-butler' }] });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/conversations') {
      const items = [...conversations.values()];
      send(res, 200, { success: true, data: { items, total: items.length, has_more: false } });
      return;
    }
    if (
      req.method === 'POST' &&
      (url.pathname === '/api/conversations' || url.pathname === '/api/conversations/clone')
    ) {
      const body = await readBody(req);
      fixture.lastBody = body;
      const source =
        url.pathname.endsWith('/clone') && body && typeof body === 'object'
          ? (body as { conversation?: Conversation }).conversation
          : (body as Conversation | undefined);
      if (!source) {
        send(res, 400, { success: false });
        return;
      }
      const created: Conversation = { ...source, id: source.id || 'generated-id', extra: { ...source.extra } };
      conversations.set(created.id, created);
      send(res, 201, { success: true, data: created });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/messages/search') {
      const items = [...conversations.values()].map((conversation, index) => ({
        message_id: `message-${index}`,
        preview_text: conversation.name,
        conversation,
      }));
      send(res, 200, { success: true, data: { items, total: items.length, has_more: false } });
      return;
    }
    const match = /^\/api\/conversations\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match) {
      send(res, 404, { success: false });
      return;
    }
    const id = decodeURIComponent(match[1] ?? '');
    const suffix = match[2] ?? '';
    const current = conversations.get(id);
    if (!current) {
      send(res, 404, { success: false });
      return;
    }
    if (req.method === 'GET' && suffix === '') {
      send(res, 200, { success: true, data: current });
      return;
    }
    if (req.method === 'GET' && suffix === '/associated') {
      send(res, 200, { success: true, data: [...conversations.values()] });
      return;
    }
    if (req.method === 'PATCH' && suffix === '') {
      const body = (await readBody(req)) as Record<string, unknown>;
      fixture.lastBody = body;
      const extra = body.extra && typeof body.extra === 'object' ? (body.extra as Record<string, unknown>) : undefined;
      conversations.set(id, { ...current, ...body, extra: extra ? { ...current.extra, ...extra } : current.extra, id });
      send(res, 200, { success: true, data: true });
      return;
    }
    if (req.method === 'POST' && suffix === '/messages') {
      fixture.lastBody = await readBody(req);
      send(res, 200, { success: true, data: { msg_id: 'message-created' } });
      return;
    }
    if (req.method === 'POST' && /^\/confirmations\/[^/]+\/confirm$/.test(suffix)) {
      fixture.lastBody = await readBody(req);
      send(res, 200, { success: true, data: null });
      return;
    }
    if (req.method === 'POST' && suffix === '/reset') {
      fixture.lastHeaders = req.headers;
      fixture.lastBody = await readBody(req);
      if (fixture.nonJsonReset) {
        res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'backend_secret=1' });
        res.end('not json');
      } else {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'backend_secret=1',
          'access-control-allow-origin': '*',
        });
        res.end(JSON.stringify({ success: true, data: null }));
      }
      return;
    }
    if (req.method === 'POST' && suffix === '/runtime/ensure') {
      fixture.lastBody = await readBody(req);
      send(res, 200, {
        success: true,
        data: { recovered: false, config_options: [], runtime: { has_task: true } },
      });
      return;
    }
    if (req.method === 'POST' && suffix === '/cancel') {
      fixture.lastBody = await readBody(req);
      send(res, 200, { success: true, data: { runtime: { state: 'cancelling' } } });
      return;
    }
    if (req.method === 'PUT' && /^\/config-options\/(?:mode|model)$/.test(suffix)) {
      const input = (await readBody(req)) as { value?: string };
      fixture.lastBody = input;
      send(res, 200, { success: true, data: { confirmation: 'observed', config_options: [] } });
      return;
    }
    if (req.method === 'DELETE' && suffix === '') {
      conversations.delete(id);
      send(res, 200, { success: true, data: true });
      return;
    }
    send(res, 200, { success: true, data: { ok: true } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fixture.port = (server.address() as AddressInfo).port;
  fixture.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fixture;
}

async function startBoundaryServer(
  boundary: ConversationTenantBoundary
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const userId = typeof req.headers['x-test-user'] === 'string' ? req.headers['x-test-user'] : '';
    const handled = await boundary.handleHttpRequest(req, res, { userId, username: userId });
    if (!handled) send(res, 404, { success: false, error: 'NOT_HANDLED' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('conversation tenant boundary', () => {
  let dataDir = '';
  let backend: BackendFixture | null = null;
  let closeBoundary: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-tenant-'));
  });

  afterEach(async () => {
    await closeBoundary?.();
    closeBoundary = null;
    await backend?.close();
    backend = null;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('stamps an immutable server owner and forces a temporary workspace on create', async () => {
    backend = await startBackend([]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const server = await startBoundaryServer(boundary);
    closeBoundary = server.close;

    const response = await fetch(`${server.url}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'alice' },
      body: JSON.stringify({
        id: 'alice-conversation',
        type: 'aionrs',
        model: { provider_id: 'trusted-provider', model: 'safe-model' },
        user_id: 'bob',
        extra: {
          [CONVERSATION_OWNER_EXTRA_KEY]: 'bob',
          agent_id: 'trusted-codex',
          backend: 'codex',
          cli_path: '/tmp/evil-cli',
          session_mode: 'full-access',
          workspace: '/home/user',
          custom_workspace: true,
          default_files: ['/etc/passwd'],
        },
      }),
    });

    expect(response.status).toBe(201);
    const forwarded = backend.lastBody as { user_id?: string; extra: Record<string, unknown> };
    expect(forwarded.user_id).toBeUndefined();
    expect(forwarded.extra).toMatchObject({
      [CONVERSATION_OWNER_EXTRA_KEY]: 'alice',
      workspace: '',
      custom_workspace: false,
      is_temporary_workspace: true,
      default_files: [],
    });
    expect(forwarded.extra.cli_path).toBeUndefined();
    const sidecar = JSON.parse(await fs.readFile(path.join(dataDir, 'webui-conversation-owners.json'), 'utf-8')) as {
      owners: Record<string, string>;
    };
    expect(sidecar.owners['alice-conversation']).toBe('alice');
    expect((await fs.stat(path.join(dataDir, 'webui-conversation-owners.json'))).mode & 0o777).toBe(0o600);
  });

  it('resolves aionrs provider credentials and endpoint from the server catalog', async () => {
    backend = await startBackend([]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const server = await startBoundaryServer(boundary);
    closeBoundary = server.close;

    const response = await fetch(`${server.url}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'alice' },
      body: JSON.stringify({
        id: 'aionrs-safe',
        type: 'aionrs',
        name: 'Safe direct model',
        model: {
          provider_id: 'trusted-provider',
          model: 'safe-model',
          base_url: 'http://169.254.169.254/latest/meta-data',
          api_key: 'ATTACKER_KEY',
        },
        extra: { workspace: '/etc', runtimeValidation: { cli_path: '/tmp/evil' } },
      }),
    });
    expect(response.status).toBe(201);
    const forwarded = backend.lastBody as { model: Record<string, unknown>; extra: Record<string, unknown> };
    expect(forwarded.model).toEqual({
      provider_id: 'trusted-provider',
      model: 'safe-model',
    });
    expect(forwarded.extra.workspace).toBe('');
    const returnedText = await response.text();
    expect(returnedText).not.toContain('TRUSTED_SERVER_KEY');
    expect(returnedText).not.toContain('trusted.example');
    expect(returnedText).not.toContain('169.254.169.254');
  });

  it('filters list/search/associated rows and returns 404 for cross-tenant ids', async () => {
    backend = await startBackend([
      { id: 'alice-1', name: 'alice secret', type: 'aionrs', extra: { [CONVERSATION_OWNER_EXTRA_KEY]: 'alice' } },
      { id: 'bob-1', name: 'bob secret', type: 'aionrs', extra: { [CONVERSATION_OWNER_EXTRA_KEY]: 'bob' } },
      { id: 'legacy', name: 'admin legacy', extra: {} },
    ]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const server = await startBoundaryServer(boundary);
    closeBoundary = server.close;

    const headers = { 'x-test-user': 'alice' };
    const list = (await (await fetch(`${server.url}/api/conversations?limit=100`, { headers })).json()) as {
      data: { items: Conversation[]; total: number };
    };
    expect(list.data.items.map((row) => row.id)).toEqual(['alice-1']);
    expect(list.data.total).toBe(1);

    const search = (await (
      await fetch(`${server.url}/api/messages/search?keyword=secret&page=1&page_size=50`, { headers })
    ).json()) as { data: { items: Array<{ conversation: Conversation }>; total: number } };
    expect(search.data.items.map((row) => row.conversation.id)).toEqual(['alice-1']);
    expect(search.data.total).toBe(1);

    const associated = (await (
      await fetch(`${server.url}/api/conversations/alice-1/associated`, { headers })
    ).json()) as { data: Conversation[] };
    expect(associated.data.map((row) => row.id)).toEqual(['alice-1']);

    const detail = await fetch(`${server.url}/api/conversations/bob-1`, { headers });
    expect(detail.status).toBe(404);
    const mutation = await fetch(`${server.url}/api/conversations/bob-1/messages`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'attack' }),
    });
    expect(mutation.status).toBe(404);
  });

  it('prevents owner/workspace changes, path traversal and server-path attachments', async () => {
    backend = await startBackend([
      {
        id: 'alice-1',
        type: 'aionrs',
        model: { provider_id: 'trusted-provider', model: 'safe-model' },
        extra: {
          [CONVERSATION_OWNER_EXTRA_KEY]: 'alice',
          backend: 'codex',
          agent_id: 'trusted-codex',
          session_mode: 'auto',
          workspace: '/srv/aionui/alice-1',
          custom_workspace: false,
          is_temporary_workspace: true,
        },
      },
    ]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const server = await startBoundaryServer(boundary);
    closeBoundary = server.close;
    const headers = { 'x-test-user': 'alice', 'content-type': 'application/json' };

    const patchResponse = await fetch(`${server.url}/api/conversations/alice-1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        merge_extra: false,
        user_id: 'bob',
        extra: {
          [CONVERSATION_OWNER_EXTRA_KEY]: 'bob',
          workspace: '/etc',
          custom_workspace: true,
          harmless: 'kept',
          pinned: true,
        },
      }),
    });
    expect(patchResponse.status).toBe(200);
    expect(backend.lastBody).toMatchObject({
      merge_extra: true,
      extra: {
        [CONVERSATION_OWNER_EXTRA_KEY]: 'alice',
        pinned: true,
      },
    });
    expect((backend.lastBody as { extra: Record<string, unknown> }).extra).not.toHaveProperty('workspace');
    expect((backend.lastBody as { extra: Record<string, unknown> }).extra).not.toHaveProperty('harmless');
    expect((backend.lastBody as Record<string, unknown>).user_id).toBeUndefined();

    const modelPatch = await fetch(`${server.url}/api/conversations/alice-1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        model: {
          provider_id: 'trusted-provider',
          model: 'safe-model',
          api_key: 'ATTACKER_KEY',
          base_url: 'http://169.254.169.254',
        },
      }),
    });
    expect(modelPatch.status).toBe(200);
    expect((backend.lastBody as { model: Record<string, unknown> }).model).toEqual({
      provider_id: 'trusted-provider',
      model: 'safe-model',
    });

    const invalidModel = await fetch(`${server.url}/api/conversations/alice-1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ model: { provider_id: 'trusted-provider', model: 'not-in-catalog' } }),
    });
    expect(invalidModel.status).toBe(400);

    const traversal = await fetch(`${server.url}/api/conversations/alice-1/workspace?path=../../etc`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(traversal.status).toBe(400);

    const message = await fetch(`${server.url}/api/conversations/alice-1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'hello', files: ['/etc/passwd'] }),
    });
    expect(message.status).toBe(200);
    expect(backend.lastBody).toEqual({ content: 'hello', files: [] });

    const confirmation = await fetch(`${server.url}/api/conversations/alice-1/confirmations/call-1/confirm`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ msg_id: 'message-1', data: { approved: true }, always_allow: true, workspace: '/etc' }),
    });
    expect(confirmation.status).toBe(200);
    expect(backend.lastBody).toEqual({
      msg_id: 'message-1',
      data: { approved: true },
      always_allow: false,
    });
  });

  it('allowlists child routes, strips trust headers and requires bounded JSON', async () => {
    backend = await startBackend([
      {
        id: 'alice-1',
        type: 'aionrs',
        model: { provider_id: 'trusted-provider', model: 'safe-model' },
        extra: { [CONVERSATION_OWNER_EXTRA_KEY]: 'alice' },
      },
    ]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const server = await startBoundaryServer(boundary);
    closeBoundary = server.close;

    const blocked = await fetch(`${server.url}/api/conversations/alice-1/future-admin-route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'alice' },
      body: '{}',
    });
    expect(blocked.status).toBe(404);
    expect(backend.lastHeaders).toBeNull();

    const sensitiveRuntime = await fetch(`${server.url}/api/conversations/alice-1/openclaw/runtime`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(sensitiveRuntime.status).toBe(404);

    const wrongType = await fetch(`${server.url}/api/conversations/alice-1/reset`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-test-user': 'alice' },
      body: '{}',
    });
    expect(wrongType.status).toBe(415);

    const allowed = await fetch(`${server.url}/api/conversations/alice-1/reset`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
        cookie: 'webui_gate=secret',
        'x-webui-gate-token': 'secret',
        'x-centaur-user-id': 'bob',
        origin: 'https://attacker.invalid',
        referer: 'https://attacker.invalid/steal',
      },
      body: '{}',
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('set-cookie')).toBeNull();
    expect(allowed.headers.get('access-control-allow-origin')).toBeNull();
    expect(backend.lastHeaders).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
    });
    for (const name of ['cookie', 'x-webui-gate-token', 'x-centaur-user-id', 'origin', 'referer']) {
      expect(backend.lastHeaders?.[name]).toBeUndefined();
    }

    const ensured = await fetch(`${server.url}/api/conversations/alice-1/runtime/ensure`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });
    expect(ensured.status).toBe(200);
    expect(backend.lastBody).toEqual({});

    const configured = await fetch(`${server.url}/api/conversations/alice-1/config-options/mode`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'alice' },
      body: JSON.stringify({ value: 'accept_edits', ignored_host_path: '/etc' }),
    });
    expect(configured.status).toBe(200);
    expect(backend.lastBody).toEqual({ value: 'accept_edits' });

    const cancelled = await fetch(`${server.url}/api/conversations/alice-1/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'alice' },
      body: JSON.stringify({ turn_id: 'turn-1', ignored_conversation_id: 'bob-1' }),
    });
    expect(cancelled.status).toBe(200);
    expect(backend.lastBody).toEqual({ turn_id: 'turn-1' });

    const legacyWarmup = await fetch(`${server.url}/api/conversations/alice-1/warmup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'alice' },
      body: '{}',
    });
    expect(legacyWarmup.status).toBe(404);

    backend.nonJsonReset = true;
    const nonJson = await fetch(`${server.url}/api/conversations/alice-1/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'alice' },
      body: '{}',
    });
    expect(nonJson.status).toBe(502);
  });

  it('uses the private sidecar as authority after legacy migration', async () => {
    backend = await startBackend([{ id: 'owned', type: 'aionrs', extra: { [CONVERSATION_OWNER_EXTRA_KEY]: 'alice' } }]);
    const first = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    expect(await first.ownsConversation({ userId: 'alice' }, 'owned')).toBe(true);

    // Even a later backend metadata change cannot reassign the row: the
    // server-owned sidecar remains authoritative across boundary restarts.
    backend.conversations.get('owned')!.extra[CONVERSATION_OWNER_EXTRA_KEY] = 'bob';
    const restarted = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    expect(await restarted.ownsConversation({ userId: 'alice' }, 'owned')).toBe(true);
    expect(await restarted.ownsConversation({ userId: 'bob' }, 'owned')).toBe(false);
  });

  it('projects conversation DTOs without credentials, CLI paths or host paths', async () => {
    backend = await startBackend([
      {
        id: 'sensitive',
        type: 'aionrs',
        model: {
          provider_id: 'trusted-provider',
          model: 'safe-model',
          api_key: 'MODEL_SECRET',
          base_url: 'http://127.0.0.1:9999/private',
        },
        extra: {
          [CONVERSATION_OWNER_EXTRA_KEY]: 'alice',
          backend: 'codex',
          agent_id: 'trusted-codex',
          agent_name: 'Codex CLI',
          session_mode: 'auto',
          workspace: '/home/user/private',
          cli_path: '/tmp/evil-cli',
          sessionKey: 'SESSION_SECRET',
          gateway: { host: '127.0.0.1', token: 'GATEWAY_SECRET', password: 'PASSWORD' },
          runtimeValidation: { expected_cli_path: '/tmp/evil-cli', identity_hash: 'HASH_SECRET' },
        },
      },
    ]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const server = await startBoundaryServer(boundary);
    closeBoundary = server.close;

    const response = await fetch(`${server.url}/api/conversations/sensitive`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: Conversation };
    expect(payload.data.extra.workspace).toBe('');
    expect(payload.data.extra).not.toHaveProperty('cli_path');
    expect(payload.data.model).toEqual({ provider_id: 'trusted-provider', model: 'safe-model' });
    for (const secret of [
      'MODEL_SECRET',
      '127.0.0.1:9999',
      '/home/user/private',
      '/tmp/evil-cli',
      'SESSION_SECRET',
      'GATEWAY_SECRET',
      'PASSWORD',
      'HASH_SECRET',
    ]) {
      expect(JSON.stringify(payload)).not.toContain(secret);
    }
  });

  it('rejects untrusted conversation runtimes and privileged create fields', async () => {
    backend = await startBackend([]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const server = await startBoundaryServer(boundary);
    closeBoundary = server.close;
    const headers = { 'content-type': 'application/json', 'x-test-user': 'alice' };

    for (const payload of [
      { id: 'remote', type: 'remote', extra: { remote_agent_id: 'attacker' } },
      { id: 'gateway', type: 'openclaw-gateway', extra: { gateway: { host: '169.254.169.254' } } },
      { id: 'legacy-codex', type: 'codex', extra: { cli_path: '/tmp/evil' } },
      { id: 'openclaw', type: 'acp', extra: { backend: 'openclaw', agent_id: 'trusted-openclaw' } },
      {
        id: 'butler',
        type: 'acp',
        extra: { backend: 'codex', agent_id: 'trusted-codex', preset_assistant_id: 'centaurai-butler' },
      },
    ]) {
      const response = await fetch(`${server.url}/api/conversations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      expect(response.status, JSON.stringify(payload)).toBe(400);
    }
    expect(backend.conversations.size).toBe(0);
  });

  it('hides and blocks legacy host-executing runtimes from ordinary LAN seats', async () => {
    backend = await startBackend([
      {
        id: 'legacy-full-access',
        type: 'acp',
        extra: {
          [CONVERSATION_OWNER_EXTRA_KEY]: 'alice',
          backend: 'codex',
          agent_id: 'trusted-codex',
          session_mode: 'full-access',
        },
      },
    ]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const server = await startBoundaryServer(boundary);
    closeBoundary = server.close;
    const headers = { 'content-type': 'application/json', 'x-test-user': 'alice' };

    const blockedMessage = await fetch(`${server.url}/api/conversations/legacy-full-access/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'read host secrets' }),
    });
    expect(blockedMessage.status).toBe(404);
    const hiddenDetail = await fetch(`${server.url}/api/conversations/legacy-full-access`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(hiddenDetail.status).toBe(404);
    const adminDetail = await fetch(`${server.url}/api/conversations/legacy-full-access`, {
      headers: { 'x-test-user': 'system_default_user' },
    });
    expect(adminDetail.status).toBe(200);
  });

  it('fails closed for WebSocket events without an owned conversation scope', async () => {
    backend = await startBackend([
      { id: 'alice-1', type: 'aionrs', extra: { [CONVERSATION_OWNER_EXTRA_KEY]: 'alice' } },
      { id: 'bob-1', type: 'aionrs', extra: { [CONVERSATION_OWNER_EXTRA_KEY]: 'bob' } },
    ]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const alice = { userId: 'alice' };

    expect(
      await boundary.shouldForwardWebSocketPayload(alice, {
        name: 'message.stream',
        data: { conversation_id: 'alice-1', content: 'safe' },
      })
    ).toBe(true);
    expect(
      await boundary.shouldForwardWebSocketPayload(alice, {
        name: 'message.stream',
        data: { conversation_id: 'bob-1', content: 'secret' },
      })
    ).toBe(false);
    expect(
      await boundary.shouldForwardWebSocketPayload(alice, {
        name: 'system-settings:language-changed',
        data: { language: 'zh-CN' },
      })
    ).toBe(false);
    expect(
      await boundary.shouldForwardWebSocketPayload(alice, {
        name: 'future.global-event',
        data: { conversation_id: 'alice-1', secret: true },
      })
    ).toBe(false);
    expect(
      await boundary.shouldForwardWebSocketPayload(alice, {
        name: 'team.teammate.message',
        data: { conversation_id: 'alice-1', sender_conversation_id: 'bob-1' },
      })
    ).toBe(false);
  });

  it('refuses to start with a corrupt ownership sidecar', async () => {
    backend = await startBackend([]);
    await fs.writeFile(path.join(dataDir, 'webui-conversation-owners.json'), '{not-json', 'utf-8');
    await expect(createConversationTenantBoundary({ backendPort: backend.port, dataDir })).rejects.toThrow(/corrupt/);
  });

  it('rolls back backend creation when the private owner index cannot persist', async () => {
    backend = await startBackend([]);
    const boundary = await createConversationTenantBoundary({ backendPort: backend.port, dataDir });
    const server = await startBoundaryServer(boundary);
    closeBoundary = server.close;
    await fs.chmod(dataDir, 0o500);
    try {
      const response = await fetch(`${server.url}/api/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'alice' },
        body: JSON.stringify({
          id: 'must-rollback',
          type: 'aionrs',
          model: { provider_id: 'trusted-provider', model: 'safe-model' },
          extra: {},
        }),
      });
      expect(response.status).toBe(502);
      expect(backend.conversations.has('must-rollback')).toBe(false);
      expect(await boundary.ownsConversation({ userId: 'alice' }, 'must-rollback')).toBe(false);
    } finally {
      await fs.chmod(dataDir, 0o700);
    }
  });
});
