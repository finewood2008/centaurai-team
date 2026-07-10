/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildAgentConversationParams,
  getConversationTypeForBackend,
  normalizeAcpBackend,
} from '@/common/utils/buildAgentConversationParams';

describe('normalizeAcpBackend', () => {
  it('rewrites the legacy openclaw-gateway backend to openclaw', () => {
    expect(normalizeAcpBackend('openclaw-gateway')).toBe('openclaw');
  });

  it('passes through every other backend unchanged', () => {
    for (const b of ['openclaw', 'aionrs', 'gemini', 'codex', 'nanobot', 'remote']) {
      expect(normalizeAcpBackend(b)).toBe(b);
    }
  });
});

describe('getConversationTypeForBackend', () => {
  it('maps aionrs / nanobot / remote to their own conversation types', () => {
    expect(getConversationTypeForBackend('aionrs')).toBe('aionrs');
    expect(getConversationTypeForBackend('nanobot')).toBe('nanobot');
    expect(getConversationTypeForBackend('remote')).toBe('remote');
  });

  it('maps both openclaw and the legacy openclaw-gateway to acp', () => {
    expect(getConversationTypeForBackend('openclaw')).toBe('acp');
    expect(getConversationTypeForBackend('openclaw-gateway')).toBe('acp');
  });

  it('defaults unknown / builtin ACP backends (gemini, codex, claude) to acp', () => {
    for (const b of ['gemini', 'codex', 'claude', 'something-new']) {
      expect(getConversationTypeForBackend(b)).toBe('acp');
    }
  });
});

describe('buildAgentConversationParams workspace defaults', () => {
  const model = {} as Parameters<typeof buildAgentConversationParams>[0]['model'];

  it('treats an empty workspace as an auto-created temporary workspace', () => {
    const params = buildAgentConversationParams({
      backend: 'claude',
      name: 'draft run',
      workspace: '',
      model,
    });

    expect(params.extra.custom_workspace).toBe(false);
    expect(params.extra.is_temporary_workspace).toBe(true);
  });

  it('treats a non-empty workspace as a user-selected custom workspace', () => {
    const params = buildAgentConversationParams({
      backend: 'claude',
      name: 'custom run',
      workspace: '/tmp/project',
      model,
    });

    expect(params.extra.custom_workspace).toBe(true);
    expect(params.extra.is_temporary_workspace).toBe(false);
  });

  it('honors an explicit custom workspace override', () => {
    const params = buildAgentConversationParams({
      backend: 'claude',
      name: 'forced temp',
      workspace: '/tmp/session-space',
      custom_workspace: false,
      model,
    });

    expect(params.extra.custom_workspace).toBe(false);
    expect(params.extra.is_temporary_workspace).toBe(true);
  });

  it('normalizes Codex synthetic model ids before persisting create params', () => {
    const params = buildAgentConversationParams({
      backend: 'codex',
      name: 'codex run',
      workspace: '/tmp/project',
      model,
      current_model_id: 'gpt-5.6-sol/xhigh',
    });

    expect(params.extra.current_model_id).toBe('gpt-5.6-sol');
  });

  it('does not normalize non-Codex model ids with slashes', () => {
    const params = buildAgentConversationParams({
      backend: 'claude',
      name: 'claude run',
      workspace: '/tmp/project',
      model,
      current_model_id: 'default/default',
    });

    expect(params.extra.current_model_id).toBe('default/default');
  });
});
