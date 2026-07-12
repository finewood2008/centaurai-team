/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpRequest: vi.fn(),
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({ provider: vi.fn(), invoke: vi.fn() })),
    buildEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(() => vi.fn()) })),
  },
}));

vi.mock('@/common/adapter/httpBridge', () => {
  const makeProvider = (
    method: string,
    path: string | ((params: unknown) => string),
    mapBody?: (params: unknown) => unknown
  ) => ({
    provider: vi.fn(),
    invoke: vi.fn((params?: unknown) => {
      const resolvedPath = typeof path === 'function' ? path(params) : path;
      const body = mapBody ? mapBody(params) : method === 'GET' || method === 'DELETE' ? undefined : params;
      return mocks.httpRequest(method, resolvedPath, body);
    }),
  });

  return {
    httpRequest: mocks.httpRequest,
    httpGet: (path: string | ((params: unknown) => string)) => makeProvider('GET', path),
    httpPost: (path: string | ((params: unknown) => string), mapBody?: (params: unknown) => unknown) =>
      makeProvider('POST', path, mapBody),
    httpPut: (path: string | ((params: unknown) => string), mapBody?: (params: unknown) => unknown) =>
      makeProvider('PUT', path, mapBody),
    httpPatch: (path: string | ((params: unknown) => string), mapBody?: (params: unknown) => unknown) =>
      makeProvider('PATCH', path, mapBody),
    httpDelete: (path: string | ((params: unknown) => string)) => makeProvider('DELETE', path),
    stubProvider: vi.fn((_name: string, defaultValue: unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(() => defaultValue),
    })),
    withResponseMap: vi.fn(
      (inner: { invoke: (params?: unknown) => Promise<unknown> }, map: (raw: unknown) => unknown) => ({
        provider: vi.fn(),
        invoke: vi.fn(async (params?: unknown) => map(await inner.invoke(params))),
      })
    ),
    wsEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(() => vi.fn()) })),
    wsMappedEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(() => vi.fn()) })),
  };
});

const row = (overrides: Record<string, unknown>) => ({
  id: 'agent-online',
  name: 'Online Agent',
  backend: 'online',
  agent_type: 'acp',
  agent_source: 'builtin',
  enabled: true,
  installed: true,
  status: 'online',
  config_options: [{ id: 'safe-option' }],
  available_modes: { current_mode_id: 'default' },
  available_models: { current_model_id: 'safe-model' },
  available_commands: [{ name: 'help' }],
  ...overrides,
});

describe('agent management HTTP adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adapts only enabled, installed online or unchecked rows for runtime selection', async () => {
    mocks.httpRequest.mockResolvedValue([
      row({}),
      row({ id: 'agent-unchecked', status: 'unchecked' }),
      row({ id: 'agent-missing', installed: false, status: 'missing' }),
      row({ id: 'agent-offline', status: 'offline' }),
      row({ id: 'agent-disabled', enabled: false }),
      row({ id: 'legacy-openclaw', agent_type: 'openclaw-gateway' }),
    ]);

    const { acpConversation } = await import('@/common/adapter/ipcBridge');
    const agents = await acpConversation.getAvailableAgents.invoke();

    expect(mocks.httpRequest).toHaveBeenCalledWith('GET', '/api/agents/management', undefined);
    expect(agents.map((agent) => agent.id)).toEqual(['agent-online', 'agent-unchecked']);
    expect(agents[0]).toMatchObject({
      available: true,
      management_status: 'online',
      handshake: {
        config_options: [{ id: 'safe-option' }],
        available_modes: { current_mode_id: 'default' },
        available_models: { current_model_id: 'safe-model' },
        available_commands: [{ name: 'help' }],
      },
    });
    expect(agents[0]).toHaveProperty('installed');
    expect(agents[0]).not.toHaveProperty('status');
  });

  it('keeps enabled-but-missing rows in the settings catalog without marking them disabled', async () => {
    mocks.httpRequest.mockResolvedValue([
      row({}),
      row({ id: 'agent-missing', enabled: true, installed: false, status: 'missing' }),
      row({ id: 'agent-disabled', enabled: false, installed: false, status: 'missing' }),
    ]);

    const { acpConversation } = await import('@/common/adapter/ipcBridge');
    const agents = await acpConversation.getManagedAgents.invoke();

    expect(agents).toHaveLength(3);
    expect(agents.find((agent) => agent.id === 'agent-missing')).toMatchObject({
      enabled: true,
      available: false,
      management_status: 'missing',
    });
    expect(agents.find((agent) => agent.id === 'agent-disabled')).toMatchObject({
      enabled: false,
      available: false,
    });
  });

  it('refreshes by re-reading management and never posts the removed legacy refresh route', async () => {
    mocks.httpRequest.mockResolvedValue([]);
    const { acpConversation } = await import('@/common/adapter/ipcBridge');

    await expect(acpConversation.refreshCustomAgents.invoke()).resolves.toBeUndefined();

    expect(mocks.httpRequest).toHaveBeenCalledWith('GET', '/api/agents/management', undefined);
    expect(mocks.httpRequest).not.toHaveBeenCalledWith('POST', '/api/agents/refresh', expect.anything());
  });

  it('runs health checks by immutable agent id and adapts Core diagnostics', async () => {
    mocks.httpRequest.mockResolvedValue(
      row({
        id: 'agent-hermes',
        last_check_latency_ms: 42,
        last_check_error_message: undefined,
      })
    );
    const { acpConversation } = await import('@/common/adapter/ipcBridge');

    await expect(acpConversation.checkAgentHealth.invoke({ id: 'agent-hermes' })).resolves.toEqual({
      available: true,
      latency: 42,
      error: undefined,
    });
    expect(mocks.httpRequest).toHaveBeenCalledWith('POST', '/api/agents/agent-hermes/health-check', undefined);
  });
});
