import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  verifyBundledCentauraiCoreResources,
} = require('../../../packages/shared-scripts/src/verify-bundled-aioncore-resources');

function write(filePath: string, contents = ''): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents, { flush: true });
}

function validManifest(platform: string, arch: string, binaryName: string, fallbackUsed = false): string {
  const target =
    platform === 'win32'
      ? arch === 'arm64'
        ? 'aarch64-pc-windows-msvc.zip'
        : 'x86_64-pc-windows-msvc.zip'
      : platform === 'darwin'
        ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin.tar.gz`
        : `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu.tar.gz`;
  return JSON.stringify({
    service: 'centaurai-core',
    repository: 'finewood2008/centaurai-core',
    tag: 'v0.1.47',
    commit: 'a'.repeat(40),
    artifactUrl: `https://github.com/finewood2008/centaurai-core/releases/download/v0.1.47/centaurai-core-v0.1.47-${target}`,
    sha256: 'b'.repeat(64),
    binaryName,
    fallbackUsed,
  });
}

function populateBundle(resourcesDir: string, platform: string, arch: string): string {
  const runtimeKey = `${platform}-${arch}`;
  const binaryName = platform === 'win32' ? 'centaurai-core.exe' : 'centaurai-core';
  const base = join(resourcesDir, 'bundled-centaurai-core', runtimeKey);
  const managed = join(base, 'managed-resources');
  write(join(base, binaryName));
  write(join(base, 'manifest.json'), validManifest(platform, arch, binaryName));
  write(
    platform === 'win32'
      ? join(managed, 'node', 'node-v24.11.0-win-x64', 'node.exe')
      : join(managed, 'node', `node-v24.11.0-${platform}-${arch}`, 'bin', 'node')
  );
  for (const [tool, version] of [
    ['codex-acp', '1.1.2'],
    ['claude-agent-acp', '0.58.1'],
  ]) {
    const toolRoot = join(managed, 'acp', tool, version, runtimeKey);
    write(join(toolRoot, 'manifest.json'), JSON.stringify({ entrypoint: 'dist/index.js' }));
    write(join(toolRoot, 'dist', 'index.js'));
  }
  return base;
}

describe('verifyBundledCentauraiCoreResources', () => {
  let root: string;
  let resourcesDir: string;
  let base: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'centaurai-core-bundled-resources-'));
    resourcesDir = join(root, 'resources');
    base = populateBundle(resourcesDir, 'win32', 'x64');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('passes for complete binary, provenance, Node, Codex, and Claude resources', () => {
    const result = verifyBundledCentauraiCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });
    expect(result.runtimeKey).toBe('win32-x64');
    expect(result.missing).toEqual([]);
    expect(result.manifest).toMatchObject({ repository: 'finewood2008/centaurai-core', tag: 'v0.1.47' });
  });

  it('reports missing managed Node runtime executable', () => {
    rmSync(join(base, 'managed-resources', 'node', 'node-v24.11.0-win-x64', 'node.exe'));
    const result = verifyBundledCentauraiCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });
    expect(result.missing).toContain('bundled-centaurai-core/win32-x64/managed-resources/node/*/node.exe');
  });

  it('supports the Unix Node layout', () => {
    const unixResources = join(root, 'darwin-resources');
    populateBundle(unixResources, 'darwin', 'arm64');
    const result = verifyBundledCentauraiCoreResources({
      resourcesDir: unixResources,
      electronPlatformName: 'darwin',
      targetArch: 'arm64',
    });
    expect(result.missing).toEqual([]);
    expect(result.checked).toContain('bundled-centaurai-core/darwin-arm64/managed-resources/node/*/bin/node');
  });

  it('reports a missing ACP entrypoint through the required manifest contract', () => {
    rmSync(join(base, 'managed-resources', 'acp', 'codex-acp', '1.1.2', 'win32-x64', 'dist', 'index.js'));
    const result = verifyBundledCentauraiCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });
    expect(result.missing).toContain(
      'bundled-centaurai-core/win32-x64/managed-resources/acp/codex-acp/*/win32-x64/manifest.json'
    );
  });

  it('rejects a manifest that records compatibility fallback', () => {
    write(join(base, 'manifest.json'), validManifest('win32', 'x64', 'centaurai-core.exe', true));
    const result = verifyBundledCentauraiCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });
    expect(result.missing).toContain('bundled-centaurai-core/win32-x64/manifest.json<valid-provenance>');
  });
});
