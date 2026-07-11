const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  CORE_ARTIFACT_CONFIG,
  getBinaryName,
  getRuntimeKey,
  isLegacyFallbackEnabled,
} = require('./core-artifact-config.js');

const MAX_DIR_ENTRIES = 20;
const MAX_LOOKUP_TEXT_LENGTH = 1000;

class CoreBinaryResolveError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = 'CoreBinaryResolveError';
    this.diagnostics = diagnostics;
  }
}

function trimText(value) {
  return String(value ?? '').trim().slice(0, MAX_LOOKUP_TEXT_LENGTH);
}

function listDirEntries(dirPath, readdirSync) {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  } catch {
    return undefined;
  }
}

function readManifest(manifestPath, readFileSync) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest && typeof manifest === 'object' ? manifest : undefined;
  } catch {
    return undefined;
  }
}

function lookupOnPath(binaryName, platform, deps, diagnostics) {
  const command = platform === 'win32' ? 'where' : 'which';
  diagnostics.pathLookups.push({ command, binaryName });
  try {
    const output = deps.execFileSync(command, [binaryName], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const firstMatch = String(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstMatch) return undefined;
    diagnostics.pathLookups.at(-1).result = trimText(output);
    if (deps.existsSync(firstMatch)) return firstMatch;
  } catch (error) {
    diagnostics.pathLookups.at(-1).error = trimText(error instanceof Error ? error.message : error);
  }
  return undefined;
}

function buildResolution(candidate, context) {
  const manifestPath = candidate.manifestPath;
  const manifest = manifestPath ? readManifest(manifestPath, context.deps.readFileSync) : undefined;
  return {
    path: candidate.path,
    binaryName: context.pathApi.basename(candidate.path),
    runtimeKey: context.runtimeKey,
    source: candidate.source,
    configuredBy: candidate.configuredBy,
    flavor: candidate.legacy ? 'aioncore' : 'centaurai-core',
    fallbackUsed: Boolean(candidate.legacy),
    compatibilityConfigUsed: Boolean(candidate.compatibilityConfigUsed),
    manifestPath,
    manifest,
    diagnostics: context.diagnostics,
  };
}

function resolveCoreBinary(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  const resourcesRoot = options.resourcesRoot;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const runtimeKey = getRuntimeKey(platform, arch);
  const canonicalBinaryName = getBinaryName(platform);
  const legacyBinaryName = getBinaryName(platform, true);
  const legacyFallbackAllowed = isLegacyFallbackEnabled(env);
  const deps = {
    existsSync: options.existsSync ?? fs.existsSync,
    readdirSync: options.readdirSync ?? fs.readdirSync,
    readFileSync: options.readFileSync ?? fs.readFileSync,
    execFileSync: options.execFileSync ?? childProcess.execFileSync,
  };
  const diagnostics = {
    runtimeKey,
    binaryName: canonicalBinaryName,
    canonicalBinaryName,
    legacyBinaryName,
    resourcesRoot,
    resourcesPath: resourcesRoot,
    legacyFallbackAllowed,
    attempts: [],
    pathLookups: [],
  };
  const context = { deps, diagnostics, pathApi, runtimeKey };
  if (resourcesRoot) diagnostics.resourcesDirEntries = listDirEntries(resourcesRoot, deps.readdirSync);

  for (const explicit of [
    { envName: 'CENTAURAI_CORE_BIN', compatibilityConfigUsed: false },
    { envName: 'AIONUI_BACKEND_BIN', compatibilityConfigUsed: true },
  ]) {
    const configuredPath = env[explicit.envName]?.trim();
    if (!configuredPath) continue;
    const legacy = pathApi.basename(configuredPath).toLowerCase() === legacyBinaryName.toLowerCase();
    diagnostics.attempts.push({ source: 'explicit', configuredBy: explicit.envName, path: configuredPath });
    if (!deps.existsSync(configuredPath)) {
      throw new CoreBinaryResolveError(
        `Configured CentaurAI Core binary does not exist: ${configuredPath}`,
        diagnostics
      );
    }
    if (legacy && !legacyFallbackAllowed) {
      throw new CoreBinaryResolveError(
        `Legacy aioncore binary requires CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK=1: ${configuredPath}`,
        diagnostics
      );
    }
    return buildResolution(
      {
        path: configuredPath,
        source: 'explicit',
        configuredBy: explicit.envName,
        compatibilityConfigUsed: explicit.compatibilityConfigUsed,
        legacy,
      },
      context
    );
  }

  if (resourcesRoot || env.CENTAURAI_CORE_BUNDLED_DIR) {
    const bundleBase = env.CENTAURAI_CORE_BUNDLED_DIR?.trim()
      ? env.CENTAURAI_CORE_BUNDLED_DIR.trim()
      : pathApi.join(resourcesRoot, CORE_ARTIFACT_CONFIG.bundleDirectory);
    const runtimeDir = pathApi.join(bundleBase, runtimeKey);
    const candidatePath = pathApi.join(runtimeDir, canonicalBinaryName);
    diagnostics.attempts.push({ source: 'bundled', path: candidatePath });
    diagnostics.canonicalBundleBase = bundleBase;
    diagnostics.canonicalBundleEntries = listDirEntries(runtimeDir, deps.readdirSync);
    diagnostics.checkedBundledPath = candidatePath;
    diagnostics.bundledDirExists = deps.existsSync(bundleBase);
    diagnostics.runtimeDirExists = deps.existsSync(runtimeDir);
    diagnostics.runtimeDirEntries = diagnostics.canonicalBundleEntries;
    if (deps.existsSync(candidatePath)) {
      return buildResolution(
        {
          path: candidatePath,
          source: 'bundled',
          configuredBy: env.CENTAURAI_CORE_BUNDLED_DIR ? 'CENTAURAI_CORE_BUNDLED_DIR' : undefined,
          manifestPath: pathApi.join(runtimeDir, 'manifest.json'),
          legacy: false,
        },
        context
      );
    }
  }

  const canonicalPath = lookupOnPath(canonicalBinaryName, platform, deps, diagnostics);
  if (canonicalPath) {
    return buildResolution({ path: canonicalPath, source: 'path', legacy: false }, context);
  }

  if (legacyFallbackAllowed) {
    if (resourcesRoot || env.AIONUI_BACKEND_BUNDLED_DIR) {
      const bundleBase = env.AIONUI_BACKEND_BUNDLED_DIR?.trim()
        ? env.AIONUI_BACKEND_BUNDLED_DIR.trim()
        : pathApi.join(resourcesRoot, CORE_ARTIFACT_CONFIG.legacy.bundleDirectory);
      const runtimeDir = pathApi.join(bundleBase, runtimeKey);
      const candidatePath = pathApi.join(runtimeDir, legacyBinaryName);
      diagnostics.attempts.push({ source: 'legacy-bundled', path: candidatePath });
      diagnostics.legacyBundleBase = bundleBase;
      diagnostics.legacyBundleEntries = listDirEntries(runtimeDir, deps.readdirSync);
      if (deps.existsSync(candidatePath)) {
        return buildResolution(
          {
            path: candidatePath,
            source: 'legacy-bundled',
            configuredBy: env.AIONUI_BACKEND_BUNDLED_DIR ? 'AIONUI_BACKEND_BUNDLED_DIR' : undefined,
            compatibilityConfigUsed: Boolean(env.AIONUI_BACKEND_BUNDLED_DIR),
            manifestPath: pathApi.join(runtimeDir, 'manifest.json'),
            legacy: true,
          },
          context
        );
      }
    }

    const legacyPath = lookupOnPath(legacyBinaryName, platform, deps, diagnostics);
    if (legacyPath) return buildResolution({ path: legacyPath, source: 'legacy-path', legacy: true }, context);
  }

  throw new CoreBinaryResolveError(
    legacyFallbackAllowed
      ? `Cannot find CentaurAI Core or legacy aioncore for ${runtimeKey}`
      : `Cannot find CentaurAI Core for ${runtimeKey}; legacy fallback is disabled`,
    diagnostics
  );
}

module.exports = { CoreBinaryResolveError, resolveCoreBinary };
