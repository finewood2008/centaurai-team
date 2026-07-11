import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  contentAssetPublishToNas,
  contentAssetsList,
  contentAssetSaveFromPath,
  type ContentAsset,
} from './content-assets.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function makeRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function readNasFile(nasRoot: string, relPath: string): Promise<string> {
  return fs.readFile(path.join(nasRoot, ...relPath.split('/')), 'utf-8');
}

describe('content assets', () => {
  it('saves generated assets privately, then publishes them into the AI生成 NAS path', async () => {
    const assetsDir = await makeRoot('content-assets-');
    const nasRoot = await makeRoot('content-assets-nas-');
    const source = path.join(assetsDir, 'source.md');
    await fs.writeFile(source, '# Generated plan');

    const saved = await contentAssetSaveFromPath(assetsDir, {
      sourcePath: source,
      name: 'plan.md',
      ownerUserId: 'alice',
      sourceConversationId: 'conversation-1',
      category: 'Planning: Q3',
      kind: 'document',
    });

    expect(saved.visibility).toBe('private');
    expect(saved.statusFlags).toEqual(['saved']);

    const published = await contentAssetPublishToNas(
      assetsDir,
      nasRoot,
      saved.id,
      { userLabel: 'Alice / CEO', conversationLabel: 'Planning: Q3' },
      'alice'
    );

    expect(published).toMatchObject<Partial<ContentAsset>>({
      id: saved.id,
      visibility: 'team',
      nasStoragePath: 'AI生成/Alice _ CEO/Planning_ Q3/plan.md',
    });
    expect(published?.statusFlags).toEqual(expect.arrayContaining(['saved', 'shared', 'stored_in_nas']));
    expect(await readNasFile(nasRoot, published!.nasStoragePath!)).toBe('# Generated plan');

    const listed = await contentAssetsList(assetsDir, 'alice');
    expect(listed[0]).toMatchObject({ id: saved.id, nasStoragePath: published!.nasStoragePath });
  });

  it('auto-renames NAS publish collisions without creating a second file store', async () => {
    const assetsDir = await makeRoot('content-assets-');
    const nasRoot = await makeRoot('content-assets-nas-');
    const sourceA = path.join(assetsDir, 'a.txt');
    const sourceB = path.join(assetsDir, 'b.txt');
    await fs.writeFile(sourceA, 'A');
    await fs.writeFile(sourceB, 'B');

    const first = await contentAssetSaveFromPath(assetsDir, {
      sourcePath: sourceA,
      name: 'same.txt',
      ownerUserId: 'bob',
      category: 'Session',
      kind: 'document',
    });
    const second = await contentAssetSaveFromPath(assetsDir, {
      sourcePath: sourceB,
      name: 'same.txt',
      ownerUserId: 'bob',
      category: 'Session',
      kind: 'document',
    });

    const publishedA = await contentAssetPublishToNas(assetsDir, nasRoot, first.id, {}, 'bob');
    const publishedB = await contentAssetPublishToNas(assetsDir, nasRoot, second.id, {}, 'bob');

    expect(publishedA?.nasStoragePath).toBe('AI生成/bob/Session/same.txt');
    expect(publishedB?.nasStoragePath).toBe('AI生成/bob/Session/same (1).txt');
    expect(await readNasFile(nasRoot, publishedA!.nasStoragePath!)).toBe('A');
    expect(await readNasFile(nasRoot, publishedB!.nasStoragePath!)).toBe('B');
  });

  it('truncates user-controlled NAS directory labels below filesystem byte limits', async () => {
    const assetsDir = await makeRoot('content-assets-');
    const nasRoot = await makeRoot('content-assets-nas-');
    const source = path.join(assetsDir, 'source.txt');
    await fs.writeFile(source, 'safe');
    const saved = await contentAssetSaveFromPath(assetsDir, {
      sourcePath: source,
      name: 'safe.txt',
      ownerUserId: 'alice',
    });

    const published = await contentAssetPublishToNas(
      assetsDir,
      nasRoot,
      saved.id,
      { conversationLabel: '🚀'.repeat(200) },
      'alice'
    );
    const conversationSegment = published?.nasStoragePath?.split('/')[2] ?? '';
    expect(Buffer.byteLength(conversationSegment)).toBeLessThanOrEqual(180);
    expect(await readNasFile(nasRoot, published!.nasStoragePath!)).toBe('safe');
  });
});
