const fs = require('node:fs');
const path = require('node:path');

const { CORE_ARTIFACT_CONFIG, getBinaryName } = require('./core-artifact-config.js');

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function bundledPath(runtimeKey, ...parts) {
  return normalize(path.join(CORE_ARTIFACT_CONFIG.bundleDirectory, runtimeKey, ...parts));
}

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function readDirectories(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function requirePath(baseDir, runtimeKey, parts, checked, missing) {
  const relativePath = bundledPath(runtimeKey, ...parts);
  checked.push(relativePath);
  if (!fs.existsSync(path.join(baseDir, ...parts))) missing.push(relativePath);
}

function requireManagedNode(baseDir, runtimeKey, platform, checked, missing) {
  const nodeRoot = path.join(baseDir, 'managed-resources', 'node');
  const executableParts = platform === 'win32' ? ['node.exe'] : ['bin', 'node'];
  const relativePath = bundledPath(runtimeKey, 'managed-resources', 'node', '*', ...executableParts);
  checked.push(relativePath);
  if (!readDirectories(nodeRoot).some((version) => isFile(path.join(nodeRoot, version, ...executableParts)))) {
    missing.push(relativePath);
  }
}

function requireManagedAcpTool(baseDir, runtimeKey, toolId, checked, missing) {
  const toolRoot = path.join(baseDir, 'managed-resources', 'acp', toolId);
  const manifestPattern = bundledPath(runtimeKey, 'managed-resources', 'acp', toolId, '*', runtimeKey, 'manifest.json');
  checked.push(manifestPattern);
  let valid = false;
  for (const version of readDirectories(toolRoot)) {
    const platformRoot = path.join(toolRoot, version, runtimeKey);
    const manifestPath = path.join(platformRoot, 'manifest.json');
    if (!isFile(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (typeof manifest.entrypoint !== 'string') continue;
      const entrypointPath = path.join(platformRoot, manifest.entrypoint);
      checked.push(
        bundledPath(runtimeKey, 'managed-resources', 'acp', toolId, version, runtimeKey, manifest.entrypoint)
      );
      if (isFile(entrypointPath)) valid = true;
    } catch {
      // Report through the manifest pattern below.
    }
  }
  if (!valid) missing.push(manifestPattern);
}

function verifyManifest(baseDir, runtimeKey, checked, missing) {
  const manifestPath = path.join(baseDir, 'manifest.json');
  const relativePath = bundledPath(runtimeKey, 'manifest.json');
  checked.push(relativePath);
  if (!isFile(manifestPath)) {
    missing.push(relativePath);
    return undefined;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const valid =
      manifest.service === CORE_ARTIFACT_CONFIG.service &&
      manifest.repository === CORE_ARTIFACT_CONFIG.repository &&
      manifest.tag === CORE_ARTIFACT_CONFIG.version &&
      typeof manifest.commit === 'string' &&
      /^[a-f0-9]{40}$/i.test(manifest.commit) &&
      typeof manifest.artifactUrl === 'string' &&
      manifest.artifactUrl.includes(`/${CORE_ARTIFACT_CONFIG.repository}/releases/download/${manifest.tag}/`) &&
      typeof manifest.sha256 === 'string' &&
      /^[a-f0-9]{64}$/i.test(manifest.sha256) &&
      manifest.binaryName === getBinaryName(runtimeKey.split('-')[0]) &&
      manifest.fallbackUsed === false;
    if (!valid) missing.push(`${relativePath}<valid-provenance>`);
    return manifest;
  } catch {
    missing.push(`${relativePath}<valid-json>`);
    return undefined;
  }
}

function verifyBundledCentauraiCoreResources({ resourcesDir, electronPlatformName, targetArch }) {
  const runtimeKey = `${electronPlatformName}-${targetArch}`;
  const baseDir = path.join(resourcesDir, CORE_ARTIFACT_CONFIG.bundleDirectory, runtimeKey);
  const checked = [];
  const missing = [];
  requirePath(baseDir, runtimeKey, [getBinaryName(electronPlatformName)], checked, missing);
  const manifest = verifyManifest(baseDir, runtimeKey, checked, missing);
  requirePath(baseDir, runtimeKey, ['managed-resources'], checked, missing);
  requireManagedNode(baseDir, runtimeKey, electronPlatformName, checked, missing);
  requireManagedAcpTool(baseDir, runtimeKey, 'codex-acp', checked, missing);
  requireManagedAcpTool(baseDir, runtimeKey, 'claude-agent-acp', checked, missing);
  return { runtimeKey, checked, missing, manifest };
}

module.exports = {
  verifyBundledAioncoreResources: verifyBundledCentauraiCoreResources,
  verifyBundledCentauraiCoreResources,
};
