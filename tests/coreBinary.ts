import {
  resolveCoreBinary,
  type CoreBinaryResolution,
  type ResolveCoreBinaryOptions,
} from '../packages/shared-scripts/src/resolve-core-binary.js';
import { isLegacyFallbackEnabled } from '../packages/shared-scripts/src/core-artifact-config.js';

type CoreResolver = (options?: ResolveCoreBinaryOptions) => CoreBinaryResolution;

function hasPrimaryOverride(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CENTAURAI_CORE_BIN?.trim() || env.AIONUI_BACKEND_BIN?.trim());
}

/** Resolve the backend used by throw-away E2E and integration processes. */
export function resolveTestCoreBinary(
  env: NodeJS.ProcessEnv = process.env,
  resolver: CoreResolver = resolveCoreBinary
): CoreBinaryResolution {
  if (hasPrimaryOverride(env)) return resolver({ env });

  const canonicalEnv = {
    ...env,
    CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK: '0',
    AIONUI_BACKEND_ALLOW_LEGACY: '0',
  };
  delete canonicalEnv.AIONUI_BACKEND_BINARY;

  try {
    return resolver({ env: canonicalEnv });
  } catch (canonicalError) {
    if (!isLegacyFallbackEnabled(env)) throw canonicalError;
  }

  const legacyTestOverride = env.AIONUI_BACKEND_BINARY?.trim();
  if (legacyTestOverride) {
    return resolver({
      env: {
        ...env,
        AIONUI_BACKEND_BIN: legacyTestOverride,
        CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK: '1',
      },
    });
  }

  return resolver({ env });
}
