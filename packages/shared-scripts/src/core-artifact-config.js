const path = require('node:path');

const rootPackage = require('../../../package.json');

const EXACT_RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const CORE_ARTIFACT_CONFIG = Object.freeze({
  repository: 'finewood2008/centaurai-core',
  service: 'centaurai-core',
  version: rootPackage.centauraiCoreVersion,
  checksumAsset: 'centaurai-core-checksums.txt',
  bundleDirectory: 'bundled-centaurai-core',
  binaryBaseName: 'centaurai-core',
  legacy: Object.freeze({
    repository: 'iOfficeAI/AionCore',
    bundleDirectory: 'bundled-aioncore',
    binaryBaseName: 'aioncore',
  }),
  targets: Object.freeze({
    'darwin-x64': Object.freeze({ releaseTarget: 'x86_64-apple-darwin', archiveExtension: '.tar.gz' }),
    'darwin-arm64': Object.freeze({ releaseTarget: 'aarch64-apple-darwin', archiveExtension: '.tar.gz' }),
    'linux-x64': Object.freeze({ releaseTarget: 'x86_64-unknown-linux-gnu', archiveExtension: '.tar.gz' }),
    'linux-arm64': Object.freeze({ releaseTarget: 'aarch64-unknown-linux-gnu', archiveExtension: '.tar.gz' }),
    'win32-x64': Object.freeze({ releaseTarget: 'x86_64-pc-windows-msvc', archiveExtension: '.zip' }),
    'win32-arm64': Object.freeze({ releaseTarget: 'aarch64-pc-windows-msvc', archiveExtension: '.zip' }),
  }),
});

function assertExactReleaseTag(tag) {
  if (typeof tag !== 'string' || !EXACT_RELEASE_TAG.test(tag)) {
    throw new Error(`CentaurAI Core version must be an exact v-prefixed release tag, received: ${tag || '<empty>'}`);
  }
  return tag;
}

function getRuntimeKey(platform, arch) {
  return `${platform}-${arch}`;
}

function getTarget(platform, arch) {
  const runtimeKey = getRuntimeKey(platform, arch);
  const target = CORE_ARTIFACT_CONFIG.targets[runtimeKey];
  if (!target) throw new Error(`Unsupported CentaurAI Core target: ${runtimeKey}`);
  return { runtimeKey, ...target };
}

function getBinaryName(platform, legacy = false) {
  const baseName = legacy ? CORE_ARTIFACT_CONFIG.legacy.binaryBaseName : CORE_ARTIFACT_CONFIG.binaryBaseName;
  return platform === 'win32' ? `${baseName}.exe` : baseName;
}

function getAssetName(platform, arch, tag = CORE_ARTIFACT_CONFIG.version) {
  const exactTag = assertExactReleaseTag(tag);
  const target = getTarget(platform, arch);
  return `${CORE_ARTIFACT_CONFIG.binaryBaseName}-${exactTag}-${target.releaseTarget}${target.archiveExtension}`;
}

function getReleaseBaseUrl(tag = CORE_ARTIFACT_CONFIG.version) {
  const exactTag = assertExactReleaseTag(tag);
  return `https://github.com/${CORE_ARTIFACT_CONFIG.repository}/releases/download/${exactTag}`;
}

function getArtifactUrl(platform, arch, tag = CORE_ARTIFACT_CONFIG.version) {
  return `${getReleaseBaseUrl(tag)}/${getAssetName(platform, arch, tag)}`;
}

function getChecksumUrl(tag = CORE_ARTIFACT_CONFIG.version) {
  return `${getReleaseBaseUrl(tag)}/${CORE_ARTIFACT_CONFIG.checksumAsset}`;
}

function getBundleBase(resourcesRoot, legacy = false) {
  const directory = legacy ? CORE_ARTIFACT_CONFIG.legacy.bundleDirectory : CORE_ARTIFACT_CONFIG.bundleDirectory;
  return path.join(resourcesRoot, directory);
}

function isLegacyFallbackEnabled(env = process.env) {
  const value = env.CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK ?? env.AIONUI_BACKEND_ALLOW_LEGACY ?? '';
  return /^(1|true|yes)$/i.test(String(value).trim());
}

assertExactReleaseTag(CORE_ARTIFACT_CONFIG.version);

module.exports = {
  CORE_ARTIFACT_CONFIG,
  assertExactReleaseTag,
  getArtifactUrl,
  getAssetName,
  getBinaryName,
  getBundleBase,
  getChecksumUrl,
  getReleaseBaseUrl,
  getRuntimeKey,
  getTarget,
  isLegacyFallbackEnabled,
};
