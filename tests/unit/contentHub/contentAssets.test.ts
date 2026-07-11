import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationGet: vi.fn(),
  getFileMetadata: vi.fn(),
  removeEntry: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: mocks.conversationGet },
    },
    fs: {
      getFileMetadata: { invoke: mocks.getFileMetadata },
      removeEntry: { invoke: mocks.removeEntry },
    },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

import {
  canDiscardDraftFile,
  createSavedContentAsset,
  discardDraftFile,
  draftAssetFromFile,
  draftAssetIdForPath,
  draftFilesForReview,
  fileEntryFromAsset,
  isDraftFileEligibleForReview,
} from '@/renderer/pages/contentHub/components/manage/contentAssets';
import type { ContentAsset, FileEntry } from '@/renderer/pages/contentHub/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

const draftFile: FileEntry = {
  name: 'proposal.pptx.md',
  path: '/tmp/session-a/proposal.pptx.md',
  size: 42,
  mtime: 100,
  conversation: 'Strategy session',
  sourceConversationId: 'conversation-1',
  workspaceRoot: '/tmp/session-a',
  draftProvenance: 'managed-temporary-workspace',
  canDiscardDraft: true,
};

describe('content asset lifecycle helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('keeps an unprovenanced custom workspace file out of the draft review queue', () => {
    const customWorkspaceFile: FileEntry = {
      name: 'production-source.ts',
      path: '/srv/projects/customer-app/src/production-source.ts',
      size: 100,
      mtime: 200,
      conversation: 'Customer app',
      sourceConversationId: 'conversation-custom',
    };

    expect(draftFilesForReview([customWorkspaceFile], [])).toEqual([]);
  });

  it('refuses to project an untrusted file as a draft asset', () => {
    const untrusted = { ...draftFile, draftProvenance: undefined, canDiscardDraft: undefined };

    expect(() => draftAssetFromFile(untrusted)).toThrow('UNTRUSTED_DRAFT_SOURCE');
  });

  it('keeps an explicitly registered artifact reviewable but not discardable', () => {
    const registered: FileEntry = {
      ...draftFile,
      sourceConversationId: undefined,
      workspaceRoot: undefined,
      draftProvenance: 'registered-generated-artifact',
      canDiscardDraft: false,
    };

    expect(isDraftFileEligibleForReview(registered)).toBe(true);
    expect(draftFilesForReview([registered], [])).toEqual([registered]);
    expect(canDiscardDraftFile(registered)).toBe(false);
  });

  it.each([
    ['/tmp/session-a', 'the workspace root itself'],
    ['/tmp/session-a-sibling/source.ts', 'a sibling with the same path prefix'],
    ['/tmp/session-a/../customer-app/source.ts', 'a traversal path'],
  ])('rejects %s as a managed-workspace draft (%s)', (path) => {
    expect(isDraftFileEligibleForReview({ ...draftFile, path })).toBe(false);
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

describe('draft deletion authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes only the backend-verified file inside the still-managed temporary workspace', async () => {
    mocks.conversationGet.mockResolvedValue({
      id: 'conversation-1',
      extra: {
        workspace: '/tmp/session-a',
        is_temporary_workspace: true,
        custom_workspace: false,
      },
    });
    mocks.getFileMetadata.mockResolvedValue({ path: draftFile.path, isDirectory: false });
    mocks.removeEntry.mockResolvedValue(undefined);

    await discardDraftFile(draftFile);

    expect(mocks.getFileMetadata).toHaveBeenCalledWith({ path: draftFile.path, workspace: '/tmp/session-a' });
    expect(mocks.removeEntry).toHaveBeenCalledWith({ path: draftFile.path });
  });

  it('does not delete when the owning conversation has become a custom workspace', async () => {
    mocks.conversationGet.mockResolvedValue({
      id: 'conversation-1',
      extra: {
        workspace: '/tmp/session-a',
        is_temporary_workspace: true,
        custom_workspace: true,
      },
    });

    await expect(discardDraftFile(draftFile)).rejects.toThrow('DRAFT_WORKSPACE_CHANGED');
    expect(mocks.getFileMetadata).not.toHaveBeenCalled();
    expect(mocks.removeEntry).not.toHaveBeenCalled();
  });

  it('does not delete when metadata resolves to a file outside the managed root', async () => {
    mocks.conversationGet.mockResolvedValue({
      id: 'conversation-1',
      extra: {
        workspace: '/tmp/session-a',
        is_temporary_workspace: true,
        custom_workspace: false,
      },
    });
    mocks.getFileMetadata.mockResolvedValue({
      path: '/srv/projects/customer-app/source.ts',
      isDirectory: false,
    });

    await expect(discardDraftFile(draftFile)).rejects.toThrow('DRAFT_FILE_CHANGED');
    expect(mocks.removeEntry).not.toHaveBeenCalled();
  });

  it('rejects a registered standalone artifact before any backend delete lookup', async () => {
    const registered: FileEntry = {
      ...draftFile,
      sourceConversationId: undefined,
      workspaceRoot: undefined,
      draftProvenance: 'registered-generated-artifact',
      canDiscardDraft: false,
    };

    await expect(discardDraftFile(registered)).rejects.toThrow('DRAFT_DISCARD_NOT_ALLOWED');
    expect(mocks.conversationGet).not.toHaveBeenCalled();
    expect(mocks.removeEntry).not.toHaveBeenCalled();
  });

  it('never deletes server workspace files from a distributed Electron client', async () => {
    vi.stubGlobal('window', {
      __clientMode: true,
      __backendPort: 25812,
      __backendHost: '192.168.1.20',
    });

    expect(canDiscardDraftFile(draftFile)).toBe(false);
    await expect(discardDraftFile(draftFile)).rejects.toThrow('DRAFT_DISCARD_NOT_ALLOWED');
    expect(mocks.conversationGet).not.toHaveBeenCalled();
    expect(mocks.removeEntry).not.toHaveBeenCalled();
  });
});
