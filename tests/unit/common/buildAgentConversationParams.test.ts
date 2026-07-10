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
});
