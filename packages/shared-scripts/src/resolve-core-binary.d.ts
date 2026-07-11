export type CoreBinaryResolution = {
  path: string;
  binaryName: string;
  runtimeKey: string;
  source: 'explicit' | 'bundled' | 'path' | 'legacy-bundled' | 'legacy-path';
  configuredBy?: string;
  flavor: 'centaurai-core' | 'aioncore';
  fallbackUsed: boolean;
  compatibilityConfigUsed: boolean;
  manifestPath?: string;
  manifest?: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
};

export class CoreBinaryResolveError extends Error {
  diagnostics: Record<string, unknown>;
}

export type ResolveCoreBinaryOptions = {
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  resourcesRoot?: string;
};

export function resolveCoreBinary(options?: ResolveCoreBinaryOptions): CoreBinaryResolution;
