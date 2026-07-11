/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: { deepLink: { received: { emit: vi.fn() } } },
}));

import { findDeepLinkUrl, LEGACY_PROTOCOL_SCHEME, parseDeepLinkUrl, PROTOCOL_SCHEME } from '@/process/utils/deepLink';

describe('CentaurAI deep-link brand migration', () => {
  it('uses centaurai as the primary scheme', () => {
    expect(PROTOCOL_SCHEME).toBe('centaurai');
  });

  it('parses the primary CentaurAI scheme', () => {
    expect(parseDeepLinkUrl('centaurai://add-provider?name=Local')).toEqual({
      action: 'add-provider',
      params: { name: 'Local' },
    });
  });

  it('continues to parse legacy AionUi links', () => {
    expect(LEGACY_PROTOCOL_SCHEME).toBe('aionui');
    expect(parseDeepLinkUrl('aionui://navigate?route=%2Fteam%2F123')).toEqual({
      action: 'navigate',
      params: { route: '/team/123' },
    });
  });

  it('finds either scheme in process arguments', () => {
    expect(findDeepLinkUrl(['app', '--flag', 'centaurai://provider/add'])).toBe('centaurai://provider/add');
    expect(findDeepLinkUrl(['app', 'aionui://provider/add'])).toBe('aionui://provider/add');
  });

  it('rejects unrelated schemes', () => {
    expect(parseDeepLinkUrl('https://centaurai.com/provider/add')).toBeNull();
  });
});
