/**
 * @license
 * Copyright 2025 CentaurAI (centaurai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { normalizeReleaseChannel, shouldShowDevelopmentBuildBadge } from '@/common/config/constants';

describe('release channel normalization', () => {
  it.each(['development', 'dev'])('marks %s artifacts as development builds', (value) => {
    expect(normalizeReleaseChannel(value)).toBe('development');
  });

  it.each(['stable', 'production', 'unexpected', undefined])('fails closed to stable for %s artifacts', (value) => {
    expect(normalizeReleaseChannel(value)).toBe('stable');
  });

  it('shows the badge for development builds of the Team edition', () => {
    expect(shouldShowDevelopmentBuildBadge('team', 'development')).toBe(true);
  });

  it.each([
    ['team', 'stable'],
    ['full', 'development'],
    ['decision', 'development'],
  ] as const)('hides the badge for the %s/%s build', (edition, releaseChannel) => {
    expect(shouldShowDevelopmentBuildBadge(edition, releaseChannel)).toBe(false);
  });
});
