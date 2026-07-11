import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBinaryPath } from '@/process/backend/binaryResolver';

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const originalEnv = { ...process.env };
const roots: string[] = [];

function setResourcesPath(resourcesPath: string | undefined): void {
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesPath });
}

function fixtureFile(...parts: string[]): string {
  const root = join(tmpdir(), `centaurai-core-resolver-${process.pid}-${roots.length}`);
  roots.push(root);
  const filePath = join(root, ...parts);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, 'fixture');
  if (process.platform !== 'win32') chmodSync(filePath, 0o755);
  return filePath;
}

describe('desktop CentaurAI Core binary resolver', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, PATH: '' };
    delete process.env.CENTAURAI_CORE_BIN;
    delete process.env.AIONUI_BACKEND_BIN;
    delete process.env.CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK;
    delete process.env.AIONUI_BACKEND_ALLOW_LEGACY;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setResourcesPath(originalResourcesPath);
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('honors the canonical explicit binary setting', () => {
    const binaryPath = fixtureFile(process.platform === 'win32' ? 'custom-core.exe' : 'custom-core');
    process.env.CENTAURAI_CORE_BIN = binaryPath;
    expect(resolveBinaryPath()).toBe(binaryPath);
  });

  it('resolves the canonical bundled layout', () => {
    const binaryName = process.platform === 'win32' ? 'centaurai-core.exe' : 'centaurai-core';
    const binaryPath = fixtureFile('bundled-centaurai-core', `${process.platform}-${process.arch}`, binaryName);
    setResourcesPath(join(binaryPath, '..', '..', '..'));
    expect(resolveBinaryPath()).toBe(binaryPath);
  });

  it('requires explicit rollback mode for legacy aioncore', () => {
    const binaryName = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';
    const binaryPath = fixtureFile(binaryName);
    process.env.AIONUI_BACKEND_BIN = binaryPath;
    expect(() => resolveBinaryPath()).toThrow('requires CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK=1');

    process.env.CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK = '1';
    expect(resolveBinaryPath()).toBe(binaryPath);
    expect(console.warn).toHaveBeenCalledWith(
      '[centaurai-core] LEGACY FALLBACK binary resolved',
      expect.objectContaining({ fallbackUsed: true })
    );
  });

  it('attaches shared resolver diagnostics when no binary is found', () => {
    setResourcesPath(fixtureFile('placeholder').replace(/[/\\]placeholder$/, ''));
    expect(() => resolveBinaryPath()).toThrow('Cannot find CentaurAI Core');
    try {
      resolveBinaryPath();
    } catch (error) {
      expect(error).toMatchObject({
        name: 'BackendBinaryResolveError',
        diagnostics: expect.objectContaining({
          runtimeKey: `${process.platform}-${process.arch}`,
          legacyFallbackAllowed: false,
        }),
      });
    }
  });
});
