/**
 * useHubFiles — loads the current user's generated files and derives the
 * search / by-conversation / by-type views consumed by the Content Hub.
 *
 * Data source is reused verbatim from the homepage RecentFiles helpers so the
 * hub and the home rail always show the same visibility-scoped set.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcBridge } from '@/common';
import { getCurrentFrontendUserId } from '@/common/utils/frontendUserScope';
import { filterConversationsWithChannelScope } from '@/renderer/utils/user/conversationVisibility';
import { useGeneratedFilesAutoRefresh } from '@/renderer/hooks/workspace/useGeneratedFilesAutoRefresh';
import { fetchRecentFiles } from '@/renderer/pages/guid/components/RecentFiles';
import { loadStandaloneGeneratedArtifactFiles } from '@/renderer/utils/file/generatedArtifacts';
import { filterHubRecords, sortHubRecords } from './components/manage/hubState';
import {
  draftAssetFromFile,
  draftFilesForReview,
  fileEntryFromAsset,
  filterArchivedContentAssets,
  filterSavedContentAssets,
  listContentAssets,
  migrateLegacyContentAssets,
} from './components/manage/contentAssets';
import type {
  ContentAsset,
  FileEntry,
  HubConversationGroup,
  HubFileKind,
  HubFileRecord,
  HubSortDirection,
  HubSortKey,
} from './types';

export function useHubFiles(search: string, kind: HubFileKind, sortKey: HubSortKey, sortDirection: HubSortDirection) {
  const [generatedFiles, setGeneratedFiles] = useState<FileEntry[]>([]);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAssets = useCallback(async () => {
    setAssets(await listContentAssets(getCurrentFrontendUserId()));
  }, []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const conversations = await ipcBridge.database.getUserConversations.invoke({ limit: 10000 });
      const visibleConversations = await filterConversationsWithChannelScope(conversations.items ?? []);
      const [conversationFiles, standaloneFiles] = await Promise.all([
        fetchRecentFiles(visibleConversations),
        loadStandaloneGeneratedArtifactFiles(),
      ]);
      await migrateLegacyContentAssets();
      setGeneratedFiles([...conversationFiles, ...standaloneFiles]);
      setAssets(await listContentAssets(getCurrentFrontendUserId()));
    } catch {
      setGeneratedFiles([]);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Live-refresh while the hub is open: when any agent finishes writing files,
  // re-enumerate (loadFiles re-fetches conversations too, so brand-new
  // conversations' outputs surface without a manual reload).
  useGeneratedFilesAutoRefresh(loadFiles);

  const savedAssets = useMemo(() => filterSavedContentAssets(assets), [assets]);
  const archivedAssets = useMemo(() => filterArchivedContentAssets(assets), [assets]);

  const records = useMemo<HubFileRecord<FileEntry>[]>(
    () =>
      savedAssets.map((asset) => {
        const file = fileEntryFromAsset(asset);
        return {
          id: asset.id,
          name: file.name,
          path: file.path,
          size: file.size,
          modifiedAt: file.mtime,
          kind: asset.kind,
          source: 'mine',
          subtitle: file.conversation,
          raw: file,
          asset,
        };
      }),
    [savedAssets]
  );

  const draftFiles = useMemo(() => draftFilesForReview(generatedFiles, assets), [assets, generatedFiles]);

  const archivedRecords = useMemo<HubFileRecord<FileEntry>[]>(
    () =>
      archivedAssets.map((asset) => {
        const file = fileEntryFromAsset(asset);
        return {
          id: asset.id,
          name: file.name,
          path: file.path,
          size: file.size,
          modifiedAt: file.mtime,
          kind: asset.kind,
          source: 'mine',
          subtitle: file.conversation,
          raw: file,
          asset,
        };
      }),
    [archivedAssets]
  );

  const draftRecords = useMemo<HubFileRecord<FileEntry>[]>(
    () =>
      draftFiles.map((file) => {
        const asset = draftAssetFromFile(file);
        return {
          id: asset.id,
          name: file.name,
          path: file.path,
          size: file.size,
          modifiedAt: file.mtime,
          kind: asset.kind,
          source: 'mine',
          subtitle: file.conversation,
          raw: file,
          asset,
        };
      }),
    [draftFiles]
  );

  // Files matching search + type filter, sorted by the shared hub sort state.
  const visibleRecords = useMemo(() => {
    return sortHubRecords(filterHubRecords(records, search, kind), sortKey, sortDirection);
  }, [records, search, kind, sortKey, sortDirection]);

  const visibleDraftRecords = useMemo(() => {
    return sortHubRecords(filterHubRecords(draftRecords, search, kind), sortKey, sortDirection);
  }, [draftRecords, search, kind, sortKey, sortDirection]);

  const visibleArchivedRecords = useMemo(() => {
    return sortHubRecords(filterHubRecords(archivedRecords, search, kind), sortKey, sortDirection);
  }, [archivedRecords, search, kind, sortKey, sortDirection]);

  const searched = useMemo(() => {
    return visibleRecords.map((record) => record.raw);
  }, [visibleRecords]);

  const visibleDraftFiles = useMemo(() => {
    return visibleDraftRecords.map((record) => record.raw);
  }, [visibleDraftRecords]);

  // Legacy by-type view now uses the same global filter pipeline.
  const byType = useMemo(() => {
    return searched;
  }, [searched]);

  // Files grouped by conversation for the 按会话 view.
  const byConversation = useMemo<HubConversationGroup[]>(() => {
    const map = new Map<string, FileEntry[]>();
    for (const file of searched) {
      const list = map.get(file.conversation) ?? [];
      list.push(file);
      map.set(file.conversation, list);
    }
    return [...map.entries()]
      .map(([conversation, list]) => ({ conversation, files: list }))
      .toSorted((a, b) => (b.files[0]?.mtime ?? 0) - (a.files[0]?.mtime ?? 0));
  }, [searched]);

  return {
    loading,
    total: savedAssets.length,
    visibleTotal: searched.length,
    draftTotal: draftFiles.length,
    visibleDraftTotal: visibleDraftFiles.length,
    archivedTotal: archivedAssets.length,
    visibleArchivedTotal: visibleArchivedRecords.length,
    assets,
    savedAssets,
    records,
    visibleRecords,
    draftRecords,
    visibleDraftRecords,
    archivedRecords,
    visibleArchivedRecords,
    searched,
    draftFiles,
    visibleDraftFiles,
    byType,
    byConversation,
    reload: loadFiles,
    reloadAssets: loadAssets,
  };
}
