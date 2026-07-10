/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { normalizeAcpModelIdForCreate } from '@/common/utils/acpModelIds';

describe('normalizeAcpModelIdForCreate', () => {
  it('strips Codex reasoning-effort suffixes before session creation', () => {
    expect(normalizeAcpModelIdForCreate('codex', 'gpt-5.6-sol/xhigh')).toBe('gpt-5.6-sol');
    expect(normalizeAcpModelIdForCreate('codex', ' gpt-5.5/high ')).toBe('gpt-5.5');
  });

  it('keeps non-Codex model ids unchanged', () => {
    expect(normalizeAcpModelIdForCreate('claude', 'default/default')).toBe('default/default');
    expect(normalizeAcpModelIdForCreate('hermes', 'deepseek:deepseek-v4-pro')).toBe('deepseek:deepseek-v4-pro');
  });

  it('returns undefined for empty values', () => {
    expect(normalizeAcpModelIdForCreate('codex', '')).toBeUndefined();
    expect(normalizeAcpModelIdForCreate('codex', '   ')).toBeUndefined();
    expect(normalizeAcpModelIdForCreate('codex', null)).toBeUndefined();
  });
});
