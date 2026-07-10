import { describe, expect, it } from 'vitest';
import {
  createSavedContentAsset,
  draftAssetFromFile,
  draftAssetIdForPath,
  draftFilesForReview,
  fileEntryFromAsset,
} from '@/renderer/pages/contentHub/components/manage/contentAssets';
import type { ContentAsset, FileEntry } from '@/renderer/pages/contentHub/types';

const draftFile: FileEntry = {
  name: 'proposal.pptx.md',
  path: '/tmp/session-a/proposal.pptx.md',
  size: 42,
  mtime: 100,
  conversation: 'Strategy session',
  sourceConversationId: 'conversation-1',
};

describe('content asset lifecycle helpers', () => {
  it('projects generated workspace files as draft assets', () => {
    const asset = draftAssetFromFile(draftFile, 'user-1');

    expect(asset.id).toBe(draftAssetIdForPath(draftFile.path));
    expect(asset.statusFlags).toEqual(['draft']);
    expect(asset.storageProvider).toBe('workspace');
    expect(asset.storagePath).toBe(draftFile.path);
    expect(asset.sourceWorkspacePath).toBe(draftFile.path);
  });

  it('creates an independent saved asset record after a durable copy exists', () => {
    const asset = createSavedContentAsset(draftFile, '/home/me/CentaurAI Content/proposal.pptx.md', 'user-1', 1234);

    expect(asset.statusFlags).toEqual(['saved']);
    expect(asset.storageProvider).toBe('personal_content');
    expect(asset.storagePath).not.toBe(asset.sourceWorkspacePath);
    expect(asset.sourceConversationId).toBe('conversation-1');
  });

  it('keeps saved sources out of the draft review queue', () => {
    const saved = createSavedContentAsset(draftFile, '/home/me/CentaurAI Content/proposal.pptx.md', 'user-1', 1234);
    const other: FileEntry = { ...draftFile, name: 'brief.md', path: '/tmp/session-a/brief.md' };

    expect(draftFilesForReview([draftFile, other], [saved]).map((file) => file.path)).toEqual([other.path]);
  });

  it('does not hide a draft just because it was indexed or copied elsewhere', () => {
    const indexedDraft: ContentAsset = {
      ...draftAssetFromFile(draftFile, 'user-1'),
      statusFlags: ['draft', 'indexed'],
    };

    expect(draftFilesForReview([draftFile], [indexedDraft]).map((file) => file.path)).toEqual([draftFile.path]);
  });

  it('maps formal assets back to file rows using the stable storage path', () => {
    const archivedButSaved: ContentAsset = {
      ...createSavedContentAsset(draftFile, '/home/me/CentaurAI Content/proposal.pptx.md', 'user-1', 2000),
      statusFlags: ['saved', 'shared'],
      updatedAt: 3000,
    };

    expect(fileEntryFromAsset(archivedButSaved)).toMatchObject({
      name: 'proposal.pptx.md',
      path: '/home/me/CentaurAI Content/proposal.pptx.md',
      mtime: 3,
      conversation: 'Strategy session',
    });
  });
});
