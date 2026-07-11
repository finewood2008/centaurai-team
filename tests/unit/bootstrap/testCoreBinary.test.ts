import { describe, expect, it, vi } from 'vitest';
import type {
  CoreBinaryResolution,
  ResolveCoreBinaryOptions,
} from '../../../packages/shared-scripts/src/resolve-core-binary.js';
import { resolveTestCoreBinary } from '../../coreBinary';

function resolution(path: string, fallbackUsed = false): CoreBinaryResolution {
  return {
    path,
    binaryName: path.split('/').at(-1) ?? path,
    runtimeKey: 'linux-x64',
    source: fallbackUsed ? 'legacy-path' : 'path',
    flavor: fallbackUsed ? 'aioncore' : 'centaurai-core',
    fallbackUsed,
    compatibilityConfigUsed: false,
    diagnostics: {},
  };
}

describe('resolveTestCoreBinary', () => {
  it('honors canonical explicit configuration before PATH lookup', () => {
    const resolver = vi.fn((_options?: ResolveCoreBinaryOptions) => resolution('/explicit/centaurai-core'));

    expect(resolveTestCoreBinary({ CENTAURAI_CORE_BIN: '/explicit/centaurai-core' }, resolver).path).toBe(
      '/explicit/centaurai-core'
    );
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('uses canonical PATH before the deprecated test override', () => {
    const resolver = vi.fn((options?: ResolveCoreBinaryOptions) => {
      if (options?.env?.CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK === '0') {
        return resolution('/usr/bin/centaurai-core');
      }
      return resolution('/legacy/aioncore', true);
    });

    const result = resolveTestCoreBinary(
      {
        CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK: '1',
        AIONUI_BACKEND_BINARY: '/legacy/aioncore',
      },
      resolver
    );

    expect(result.path).toBe('/usr/bin/centaurai-core');
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('uses the deprecated test override only after explicit fallback opt-in', () => {
    const resolver = vi.fn((options?: ResolveCoreBinaryOptions) => {
      if (options?.env?.CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK === '0') throw new Error('canonical core missing');
      expect(options?.env?.AIONUI_BACKEND_BIN).toBe('/legacy/aioncore');
      return resolution('/legacy/aioncore', true);
    });

    expect(
      resolveTestCoreBinary(
        {
          AIONUI_BACKEND_ALLOW_LEGACY: '1',
          AIONUI_BACKEND_BINARY: '/legacy/aioncore',
        },
        resolver
      ).fallbackUsed
    ).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('does not consult legacy candidates without explicit fallback opt-in', () => {
    const resolver = vi.fn(() => {
      throw new Error('canonical core missing');
    });

    expect(() => resolveTestCoreBinary({ AIONUI_BACKEND_BINARY: '/legacy/aioncore' }, resolver)).toThrow(
      'canonical core missing'
    );
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
