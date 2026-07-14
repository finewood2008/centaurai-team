import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type AsarApi = {
  extractFile(archive: string, filename: string): Buffer;
  listPackage(archive: string): string[];
};

const require = createRequire(import.meta.url);

function findLatestPackagedAsar(root: string): string {
  const matches: Array<{ file: string; mtimeMs: number }> = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory || !fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      if (entry.isFile() && entry.name === 'app.asar') {
        matches.push({ file, mtimeMs: fs.statSync(file).mtimeMs });
      }
    }
  }

  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!matches[0]) {
    throw new Error('No packaged app.asar found under out/. Build a distributable first.');
  }
  return matches[0].file;
}

function loadAsarApi(): AsarApi {
  const electronBuilderRoot = path.dirname(require.resolve('electron-builder/package.json'));
  const asarModule = require.resolve('@electron/asar', { paths: [electronBuilderRoot] });
  return require(asarModule) as AsarApi;
}

const describePackaged = process.env.PACKAGED_I18N_TEST === '1' ? describe : describe.skip;

describePackaged('packaged renderer i18n assets', () => {
  it('includes the entry assets and all supported locale payloads', () => {
    const archive = findLatestPackagedAsar(path.resolve('out'));
    const asar = loadAsarApi();
    const packagedFiles = new Set(asar.listPackage(archive));
    const indexPath = 'out/renderer/index.html';

    expect(packagedFiles.has(`/${indexPath}`)).toBe(true);
    const html = asar.extractFile(archive, indexPath).toString('utf8');
    const entryAssets = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)["?#]/g)].map(
      (match) => `out/renderer/${match[1]}`
    );

    expect(entryAssets.length).toBeGreaterThan(0);
    for (const asset of entryAssets) {
      expect(packagedFiles.has(`/${asset}`), `${asset} must be present in app.asar`).toBe(true);
    }

    const entryJavaScript = entryAssets
      .filter((asset) => asset.endsWith('.js'))
      .map((asset) => asar.extractFile(archive, asset).toString('utf8'))
      .join('\n');

    expect(entryJavaScript).toContain('Centrally manage AI agent skills. Install once, use across all assistants.');
    expect(entryJavaScript).toContain('集中管理 AI 智能体技能。一次安装，全助手通用。');
    expect(entryJavaScript).toContain('集中管理 AI 智慧體技能。一次安裝，全助手通用。');
  });
});
