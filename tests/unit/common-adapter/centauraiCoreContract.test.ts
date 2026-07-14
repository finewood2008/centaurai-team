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
      invoke: vi.fn(async () => defaultValue),
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

const runtimeSnapshot = {
  recovered: false,
  runtime: { has_task: true },
  config_options: [
    {
      id: 'mode',
      category: 'mode',
      type: 'select',
      current_value: 'accept_edits',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'accept_edits', label: 'Accept edits' },
      ],
    },
    {
      id: 'model',
      category: 'model',
      type: 'select',
      current_value: 'model-pro',
      options: [
        { value: 'model-flash', label: 'Flash' },
        { value: 'model-pro', label: 'Pro' },
      ],
    },
  ],
};

describe('CentaurAI Core HTTP contract adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prepares a conversation through the runtime ensure endpoint', async () => {
    mocks.httpRequest.mockResolvedValue(runtimeSnapshot);
    const { conversation } = await import('@/common/adapter/ipcBridge');

    await expect(conversation.warmup.invoke({ conversation_id: 'conv-1' })).resolves.toBeUndefined();

    expect(mocks.httpRequest).toHaveBeenCalledWith('POST', '/api/conversations/conv-1/runtime/ensure', undefined);
  });

  it('reads legacy mode state from the runtime config snapshot', async () => {
    mocks.httpRequest.mockResolvedValue(runtimeSnapshot);
    const { acpConversation } = await import('@/common/adapter/ipcBridge');

    await expect(acpConversation.getMode.invoke({ conversation_id: 'conv-1' })).resolves.toEqual({
      mode: 'accept_edits',
      initialized: true,
    });

    expect(mocks.httpRequest).toHaveBeenCalledWith('POST', '/api/conversations/conv-1/runtime/ensure', undefined);
  });

  it('reads model metadata from the runtime config snapshot', async () => {
    mocks.httpRequest.mockResolvedValue(runtimeSnapshot);
    const { acpConversation } = await import('@/common/adapter/ipcBridge');

    const result = await acpConversation.getModel.invoke({ conversation_id: 'conv-1' });

    expect(result.model_info).toEqual({
      current_model_id: 'model-pro',
      current_model_label: 'Pro',
      available_models: [
        { id: 'model-flash', label: 'Flash' },
        { id: 'model-pro', label: 'Pro' },
      ],
    });
  });

  it('sets mode through the config-options endpoint and value body', async () => {
    mocks.httpRequest.mockResolvedValue({ confirmation: 'observed', config_options: runtimeSnapshot.config_options });
    const { acpConversation } = await import('@/common/adapter/ipcBridge');

    await acpConversation.setMode.invoke({ conversation_id: 'conv-1', mode: 'accept_edits' });

    expect(mocks.httpRequest).toHaveBeenCalledWith('PUT', '/api/conversations/conv-1/config-options/mode', {
      value: 'accept_edits',
    });
  });

  it('sets model through the config-options endpoint and maps its confirmation', async () => {
    mocks.httpRequest.mockResolvedValue({ confirmation: 'observed', config_options: runtimeSnapshot.config_options });
    const { acpConversation } = await import('@/common/adapter/ipcBridge');

    const result = await acpConversation.setModel.invoke({ conversation_id: 'conv-1', model_id: 'model-pro' });

    expect(mocks.httpRequest).toHaveBeenCalledWith('PUT', '/api/conversations/conv-1/config-options/model', {
      value: 'model-pro',
    });
    expect(result.model_info?.current_model_id).toBe('model-pro');
  });

  it('keeps the requested model when Core only acknowledges the command', async () => {
    mocks.httpRequest.mockResolvedValue({ confirmation: 'command_ack', config_options: null });
    const { acpConversation } = await import('@/common/adapter/ipcBridge');

    const result = await acpConversation.setModel.invoke({ conversation_id: 'conv-1', model_id: 'model-flash' });

    expect(result.model_info?.current_model_id).toBe('model-flash');
    expect(result.model_info?.available_models).toEqual([]);
  });

  it('omits masked provider API keys from partial updates', async () => {
    mocks.httpRequest.mockResolvedValue({});
    const { mode } = await import('@/common/adapter/ipcBridge');

    await mode.updateProvider.invoke({
      id: 'ollama-local',
      api_key: 'masked:v1:********',
      model_enabled: { 'qwen2.5:latest': false },
    });

    expect(mocks.httpRequest).toHaveBeenCalledWith('PUT', '/api/providers/ollama-local', {
      model_enabled: { 'qwen2.5:latest': false },
    });
  });

  it('keeps a new plaintext provider API key in updates', async () => {
    mocks.httpRequest.mockResolvedValue({});
    const { mode } = await import('@/common/adapter/ipcBridge');

    await mode.updateProvider.invoke({ id: 'provider-1', api_key: 'new-plaintext-key' });

    expect(mocks.httpRequest).toHaveBeenCalledWith('PUT', '/api/providers/provider-1', {
      api_key: 'new-plaintext-key',
    });
  });

  it('derives auto-injected skills from the unified skill catalog', async () => {
    mocks.httpRequest.mockResolvedValue([
      { name: 'auto', description: 'Auto', location: '/auto', is_auto_inject: true },
      { name: 'manual', description: 'Manual', location: '/manual', is_auto_inject: false },
    ]);
    const { fs } = await import('@/common/adapter/ipcBridge');

    const result = await fs.listBuiltinAutoSkills.invoke();

    expect(mocks.httpRequest).toHaveBeenCalledWith('GET', '/api/skills', undefined);
    expect(result.map((skill) => skill.name)).toEqual(['auto']);
  });

  it('imports formerly linked skills through the supported copy endpoint', async () => {
    mocks.httpRequest.mockResolvedValue({ skill_name: 'demo' });
    const { fs } = await import('@/common/adapter/ipcBridge');

    await fs.importSkillWithSymlink.invoke({ skill_path: '/tmp/demo' });

    expect(mocks.httpRequest).toHaveBeenCalledWith('POST', '/api/skills/import', { skill_path: '/tmp/demo' });
  });

  it('cancels a team run with POST and no request body', async () => {
    mocks.httpRequest.mockResolvedValue(undefined);
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.cancelRun.invoke({ team_id: 'team-1', team_run_id: 'run-1' });

    expect(mocks.httpRequest).toHaveBeenCalledWith('POST', '/api/teams/team-1/runs/run-1/cancel', undefined);
  });

  it('resolves the active turn before cancelling a conversation', async () => {
    mocks.httpRequest
      .mockResolvedValueOnce([
        { conversation_id: 'conv-1', turn_id: 'turn-1', status: 'running' },
        { conversation_id: 'conv-2', turn_id: 'turn-2', status: 'queued' },
      ])
      .mockResolvedValueOnce(undefined);
    const { conversation } = await import('@/common/adapter/ipcBridge');

    await conversation.stop.invoke({ conversation_id: 'conv-1' });

    expect(mocks.httpRequest).toHaveBeenNthCalledWith(1, 'GET', '/api/agent-runs');
    expect(mocks.httpRequest).toHaveBeenNthCalledWith(2, 'POST', '/api/conversations/conv-1/cancel', {
      turn_id: 'turn-1',
    });
  });

  it('does not call the removed server-side Star Office probe', async () => {
    const { starOffice } = await import('@/common/adapter/ipcBridge');

    await expect(starOffice.detectUrl.invoke({ preferredUrl: 'http://127.0.0.1:19000' })).resolves.toEqual({
      url: null,
    });

    expect(mocks.httpRequest).not.toHaveBeenCalled();
  });
});
