import {
  CoreBinaryResolveError,
  resolveCoreBinary,
  type CoreBinaryResolution,
} from '../../../../shared-scripts/src/resolve-core-binary.js';

type BackendBinaryResolveDiagnostics = Record<string, unknown>;

class BackendBinaryResolveError extends Error {
  readonly diagnostics: BackendBinaryResolveDiagnostics;

  constructor(message: string, diagnostics: BackendBinaryResolveDiagnostics) {
    super(message);
    this.name = 'BackendBinaryResolveError';
    this.diagnostics = diagnostics;
  }
}

function logResolution(resolution: CoreBinaryResolution): void {
  const manifest = resolution.manifest ?? {};
  const details = {
    path: resolution.path,
    source: resolution.source,
    configuredBy: resolution.configuredBy,
    fallbackUsed: resolution.fallbackUsed,
    compatibilityConfigUsed: resolution.compatibilityConfigUsed,
    repository: manifest.repository,
    tag: manifest.tag,
    commit: manifest.commit,
    artifactUrl: manifest.artifactUrl,
    sha256: manifest.sha256,
    binaryName: resolution.binaryName,
  };
  if (resolution.fallbackUsed) {
    console.warn('[centaurai-core] LEGACY FALLBACK binary resolved', details);
  } else {
    console.info('[centaurai-core] binary resolved', details);
  }
}

export function resolveBinary(): CoreBinaryResolution {
  try {
    const resolution = resolveCoreBinary({
      resourcesRoot: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    });
    logResolution(resolution);
    return resolution;
  } catch (error) {
    const diagnostics = error instanceof CoreBinaryResolveError ? error.diagnostics : {};
    throw new BackendBinaryResolveError(error instanceof Error ? error.message : String(error), diagnostics);
  }
}

export function resolveBinaryPath(): string {
  return resolveBinary().path;
}

export type { BackendBinaryResolveDiagnostics };
