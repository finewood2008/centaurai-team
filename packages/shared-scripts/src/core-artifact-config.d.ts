export type CoreTarget = {
  releaseTarget: string;
  archiveExtension: '.tar.gz' | '.zip';
};

export type CoreArtifactConfig = {
  repository: string;
  service: string;
  version: string;
  checksumAsset: string;
  bundleDirectory: string;
  binaryBaseName: string;
  legacy: {
    repository: string;
    bundleDirectory: string;
    binaryBaseName: string;
  };
  targets: Readonly<Record<string, CoreTarget>>;
};

export const CORE_ARTIFACT_CONFIG: Readonly<CoreArtifactConfig>;
export function assertExactReleaseTag(tag: string): string;
export function getRuntimeKey(platform: NodeJS.Platform | string, arch: string): string;
export function getTarget(platform: NodeJS.Platform | string, arch: string): CoreTarget & { runtimeKey: string };
export function getBinaryName(platform: NodeJS.Platform | string, legacy?: boolean): string;
export function getAssetName(platform: NodeJS.Platform | string, arch: string, tag?: string): string;
export function getReleaseBaseUrl(tag?: string): string;
export function getArtifactUrl(platform: NodeJS.Platform | string, arch: string, tag?: string): string;
export function getChecksumUrl(tag?: string): string;
export function getBundleBase(resourcesRoot: string, legacy?: boolean): string;
export function isLegacyFallbackEnabled(env?: NodeJS.ProcessEnv): boolean;
