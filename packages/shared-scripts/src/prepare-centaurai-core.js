const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CORE_ARTIFACT_CONFIG,
  assertExactReleaseTag,
  getArtifactUrl,
  getAssetName,
  getBinaryName,
  getChecksumUrl,
  getRuntimeKey,
  getTarget,
} = require('./core-artifact-config.js');

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function calculateSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseChecksumFile(text, assetName) {
  const matches = String(text)
    .split(/\r?\n/)
    .map((line) => line.match(/^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/))
    .filter(Boolean)
    .filter((match) => path.basename(match[2]) === assetName);
  if (matches.length !== 1) {
    throw new Error(`Checksum file must contain exactly one entry for ${assetName}`);
  }
  return matches[0][1].toLowerCase();
}

function authCurlArgs(token) {
  return token ? ['-H', `Authorization: Bearer ${token}`] : [];
}

function downloadFile(url, outputPath, token = '') {
  console.log(`  Downloading ${url}`);
  if (process.platform === 'win32') {
    const headers = token ? ` -Headers @{Authorization='Bearer ${token.replace(/'/g, "''")}'}` : '';
    const command = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url.replace(/'/g, "''")}'${headers} -OutFile '${outputPath.replace(/'/g, "''")}'`;
    childProcess.execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
      timeout: 180000,
    });
    return;
  }
  childProcess.execFileSync(
    'curl',
    ['-L', '--fail', '--silent', '--show-error', ...authCurlArgs(token), '-o', outputPath, url],
    { timeout: 180000 }
  );
}

function fetchJson(url, token = '') {
  if (process.platform === 'win32') {
    const headers = token ? ` -Headers @{Authorization='Bearer ${token.replace(/'/g, "''")}'}` : '';
    const command = `$ProgressPreference='SilentlyContinue'; (Invoke-RestMethod -Uri '${url.replace(/'/g, "''")}'${headers}) | ConvertTo-Json -Depth 20`;
    return JSON.parse(
      childProcess.execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        timeout: 30000,
      })
    );
  }
  const output = childProcess.execFileSync(
    'curl',
    ['-L', '--fail', '--silent', '--show-error', ...authCurlArgs(token), url],
    { encoding: 'utf8', timeout: 30000 }
  );
  return JSON.parse(output);
}

function resolveReleaseCommit(tag, token = '') {
  const apiUrl = `https://api.github.com/repos/${CORE_ARTIFACT_CONFIG.repository}/commits/${encodeURIComponent(tag)}`;
  const payload = fetchJson(apiUrl, token);
  if (typeof payload?.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(payload.sha)) {
    throw new Error(`Unable to resolve commit for ${CORE_ARTIFACT_CONFIG.repository}@${tag}`);
  }
  return payload.sha.toLowerCase();
}

function extractArchive(archivePath, outputDir) {
  ensureDirectory(outputDir);
  if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const command = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`;
      childProcess.execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command]);
    } else {
      childProcess.execFileSync('unzip', ['-q', '-o', archivePath, '-d', outputDir]);
    }
    return;
  }
  childProcess.execFileSync('tar', ['-xzf', archivePath, '-C', outputDir]);
}

function findBinaryInDir(dirPath, binaryNames) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile() && binaryNames.includes(entry.name)) return { path: fullPath, name: entry.name };
    if (entry.isDirectory()) {
      const found = findBinaryInDir(fullPath, binaryNames);
      if (found) return found;
    }
  }
  return undefined;
}

function ensureExecutableMode(filePath, platform) {
  if (platform !== 'win32') fs.chmodSync(filePath, 0o755);
}

function prepareManagedResources(binaryPath, targetDir) {
  const bundleOut = path.join(targetDir, 'managed-resources');
  const dataDir = path.join(targetDir, '.prepare-data');
  removeDirectorySafe(bundleOut);
  removeDirectorySafe(dataDir);
  ensureDirectory(bundleOut);
  ensureDirectory(dataDir);
  try {
    childProcess.execFileSync(
      binaryPath,
      ['--data-dir', dataDir, 'prepare-managed-resources', '--bundle-out', bundleOut],
      {
        stdio: 'inherit',
        env: { ...process.env, AIONUI_BUNDLED_MANAGED_RESOURCES: '' },
      }
    );
  } finally {
    removeDirectorySafe(dataDir);
  }
  return bundleOut;
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readDirectories(dirPath) {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function verifyManagedResources(bundleOut, platform, runtimeKey) {
  const missing = [];
  const nodeExecutableParts = platform === 'win32' ? ['node.exe'] : ['bin', 'node'];
  const nodeRoots = readDirectories(path.join(bundleOut, 'node'));
  if (!nodeRoots.some((version) => isFile(path.join(bundleOut, 'node', version, ...nodeExecutableParts)))) {
    missing.push(`node/*/${nodeExecutableParts.join('/')}`);
  }

  for (const tool of ['codex-acp', 'claude-agent-acp']) {
    const versions = readDirectories(path.join(bundleOut, 'acp', tool));
    let valid = false;
    for (const version of versions) {
      const platformRoot = path.join(bundleOut, 'acp', tool, version, runtimeKey);
      const manifestPath = path.join(platformRoot, 'manifest.json');
      if (!isFile(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (typeof manifest.entrypoint === 'string' && isFile(path.join(platformRoot, manifest.entrypoint))) {
          valid = true;
          break;
        }
      } catch {
        // Report the tool as missing below.
      }
    }
    if (!valid) missing.push(`acp/${tool}/*/${runtimeKey}/manifest.json + entrypoint`);
  }

  if (missing.length > 0) {
    throw new Error(`Managed resources are incomplete: ${missing.join(', ')}`);
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function prepareCentauraiCore(options) {
  const { projectRoot, platform, arch } = options;
  const tag = assertExactReleaseTag(options.version ?? CORE_ARTIFACT_CONFIG.version);
  const runtimeKey = getRuntimeKey(platform, arch);
  getTarget(platform, arch);
  const assetName = getAssetName(platform, arch, tag);
  const artifactUrl = getArtifactUrl(platform, arch, tag);
  const checksumUrl = getChecksumUrl(tag);
  const canonicalBinaryName = getBinaryName(platform);
  const legacyBinaryName = getBinaryName(platform, true);
  const targetDir = path.join(projectRoot, 'resources', CORE_ARTIFACT_CONFIG.bundleDirectory, runtimeKey);
  const tempDir = path.join(os.tmpdir(), 'centaurai-core-prepare', tag, runtimeKey);
  const archivePath = path.join(tempDir, assetName);
  const checksumPath = path.join(tempDir, CORE_ARTIFACT_CONFIG.checksumAsset);
  const extractDir = path.join(tempDir, 'extracted');
  const stageDir = path.join(tempDir, 'stage');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const deps = {
    downloadFile,
    extractArchive,
    resolveReleaseCommit,
    prepareManagedResources,
    execFileSync: childProcess.execFileSync,
    ...options.deps,
  };

  console.log(`Preparing CentaurAI Core for ${runtimeKey} (${tag})`);
  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  try {
    deps.downloadFile(artifactUrl, archivePath, token);
    deps.downloadFile(checksumUrl, checksumPath, token);
    const expectedSha256 = parseChecksumFile(fs.readFileSync(checksumPath, 'utf8'), assetName);
    const artifactSha256 = calculateSha256(archivePath);
    if (artifactSha256 !== expectedSha256) {
      throw new Error(`Checksum mismatch for ${assetName}: expected ${expectedSha256}, received ${artifactSha256}`);
    }

    const commit = (process.env.CENTAURAI_CORE_RELEASE_COMMIT || deps.resolveReleaseCommit(tag, token)).toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Invalid release commit for ${tag}: ${commit}`);

    deps.extractArchive(archivePath, extractDir);
    const found = findBinaryInDir(extractDir, [canonicalBinaryName, legacyBinaryName]);
    if (!found) {
      throw new Error(`Neither ${canonicalBinaryName} nor ${legacyBinaryName} was found in ${assetName}`);
    }

    ensureDirectory(stageDir);
    const stageBinaryPath = path.join(stageDir, canonicalBinaryName);
    fs.copyFileSync(found.path, stageBinaryPath);
    ensureExecutableMode(stageBinaryPath, platform);

    const versionOutput = String(deps.execFileSync(stageBinaryPath, ['--version'], { encoding: 'utf8' })).trim();
    if (!versionOutput.includes(tag.slice(1))) {
      throw new Error(`Downloaded binary version does not match ${tag}: ${versionOutput || '<empty>'}`);
    }

    const managedResourcesDir = deps.prepareManagedResources(stageBinaryPath, stageDir);
    verifyManagedResources(managedResourcesDir, platform, runtimeKey);

    const binarySha256 = calculateSha256(stageBinaryPath);
    const fallbackUsed = found.name === legacyBinaryName;
    const manifest = {
      schemaVersion: 2,
      service: CORE_ARTIFACT_CONFIG.service,
      repository: CORE_ARTIFACT_CONFIG.repository,
      tag,
      commit,
      platform,
      arch,
      runtimeKey,
      generatedAt: new Date().toISOString(),
      sourceType: 'github-release',
      artifactName: assetName,
      artifactUrl,
      checksumUrl,
      sha256: artifactSha256,
      binaryName: canonicalBinaryName,
      sourceBinaryName: found.name,
      binarySha256,
      fallbackUsed,
      files: [canonicalBinaryName, 'managed-resources/'],
    };
    writeJson(path.join(stageDir, 'manifest.json'), manifest);

    removeDirectorySafe(targetDir);
    ensureDirectory(path.dirname(targetDir));
    fs.cpSync(stageDir, targetDir, { recursive: true });
    ensureExecutableMode(path.join(targetDir, canonicalBinaryName), platform);
    console.log(`  Prepared resources/${CORE_ARTIFACT_CONFIG.bundleDirectory}/${runtimeKey}/${canonicalBinaryName}`);
    console.log(`  Provenance ${CORE_ARTIFACT_CONFIG.repository}@${tag} commit=${commit} sha256=${artifactSha256}`);
    if (fallbackUsed)
      console.warn(`  Compatibility binary name ${found.name} was normalized to ${canonicalBinaryName}`);
    return { prepared: true, dir: targetDir, sourceType: 'github-release', manifest };
  } catch (error) {
    removeDirectorySafe(targetDir);
    throw error;
  } finally {
    removeDirectorySafe(tempDir);
  }
}

module.exports = {
  calculateSha256,
  findBinaryInDir,
  parseChecksumFile,
  prepareCentauraiCore,
  verifyManagedResources,
};
