import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createStandaloneAppMetadata,
  parseAppVersion,
  resolveStandaloneImageWorkbenchConfig,
} from '../../../scripts/webui';

describe('webui script app version', () => {
  it('passes the root package version to the standalone runtime', () => {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageMetadata = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string };

    expect(createStandaloneAppMetadata('/tmp/centaurai-test').version).toBe(packageMetadata.version);
  });

  it('rejects package metadata without a non-empty version', () => {
    expect(() => parseAppVersion({ version: '  ' })).toThrow('Root package.json does not contain a valid version');
  });

  it('prefers CentaurAI image settings while preserving the legacy secret alias', () => {
    expect(
      resolveStandaloneImageWorkbenchConfig({
        CENTAURAI_IMAGE_WORKBENCH_KEY: 'centaur-key',
        AIONUI_IMAGE_KEY: 'legacy-key',
        CENTAURAI_IMAGE_UPSTREAM_URL: 'https://images.example/v1',
      })
    ).toMatchObject({ apiKey: 'centaur-key', baseUrl: 'https://images.example/v1' });
    expect(resolveStandaloneImageWorkbenchConfig({ AIONUI_IMAGE_KEY: 'legacy-key' })).toMatchObject({
      apiKey: 'legacy-key',
    });
  });
});
