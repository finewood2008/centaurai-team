/**
 * ContentHubPage — unified hub for generated content.
 *
 * Top-level sections: generated assets, enterprise NAS, and admin-only
 * Super Knowledge Base management. The
 * shell owns URL-synced search/filter/sort/view state while each section keeps
 * its existing backend DTOs and maps them into a common file-manager model.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Message, Modal } from '@arco-design/web-react';
import {
  Copy,
  Delete,
  Download,
  FolderOpen,
  InboxOut,
  Save,
  Share,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import MineSubTabs from './components/MineSubTabs';
import FileGrid from './components/view/FileGrid';
import ConversationGroup from './components/ConversationGroup';
import EmptyState from './components/EmptyState';
import HubContextMenu, { type HubMenuState } from './components/HubContextMenu';
import BatchActionBar, { type HubBatchAction } from './components/manage/BatchActionBar';
import HubFileList from './components/manage/HubFileList';
import HubSectionHeader from './components/manage/HubSectionHeader';
import HubSidebar from './components/manage/HubSidebar';
import HubToolbar from './components/manage/HubToolbar';
import {
  buildContentHubSearchParams,
  clearHubSelection,
  createHubSelectionState,
  parseContentHubQuery,
  setHubSelectionForIds,
  toggleHubSelection,
} from './components/manage/hubState';
import NasPanel from './nas/NasPanel';
import KnowledgeBasePanel from './knowledge/KnowledgeBasePanel';
import { useHubFiles } from './useHubFiles';
import { useHubPreview } from './useHubPreview';
import { useHubFileActions } from './useHubFileActions';
import { useHubViewPrefs } from './useHubViewPrefs';
import { isAdminFrontendUser } from '@/common/utils/frontendUserScope';
import { PreviewPanel, usePreviewContext } from '@/renderer/pages/conversation/Preview';
import {
  markAssetArchived,
  saveAssetToNas,
  saveDraftToContent,
} from './components/manage/contentAssets';
import type {
  ContentAsset,
  FileEntry,
  HubFileKind,
  HubMineView,
  HubSection,
  HubSortDirection,
  HubSortKey,
  HubToolbarControls,
  HubViewMode,
} from './types';

type AssetTarget = {
  file: FileEntry;
  asset: ContentAsset;
};

async function countFailures<T>(items: readonly T[], run: (item: T) => Promise<unknown>): Promise<number> {
  const results = await Promise.all(
    items.map(async (item) => {
      try {
        await run(item);
        return false;
      } catch {
        return true;
      }
    })
  );
  return results.filter(Boolean).length;
}

const ContentHubPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => parseContentHubQuery(searchParams));
  const viewPrefs = useHubViewPrefs();
  const [section, setSection] = useState<HubSection>(initial.section);
  const [mineView, setMineView] = useState<HubMineView>(initial.mineView);
  const [search, setSearch] = useState(initial.search);
  const [kind, setKind] = useState<HubFileKind>(initial.kind);
  const [sortKey, setSortKey] = useState<HubSortKey>(initial.sortKey);
  const [sortDirection, setSortDirection] = useState<HubSortDirection>(initial.sortDirection);
  const [view, setViewState] = useState<HubViewMode>(initial.view);
  const [mineSelection, setMineSelection] = useState(createHubSelectionState());

  const hub = useHubFiles(search, kind, sortKey, sortDirection);
  const preview = useHubPreview();
  const { isOpen: isPreviewOpen } = usePreviewContext();
  const actions = useHubFileActions();
  const directOpen = (file: FileEntry): void => void actions.openFile(file);
  const { size, setSize } = viewPrefs;
  const [menu, setMenu] = useState<HubMenuState>(null);
  const canManageKnowledge = isAdminFrontendUser();

  const setView = (next: HubViewMode) => {
    setViewState(next);
    viewPrefs.setView(next);
  };

  useEffect(() => {
    if (section === 'knowledge' && !canManageKnowledge) {
      setSection('mine');
      setMineView('drafts');
      return;
    }
    const next = buildContentHubSearchParams({
      section,
      mineView,
      search,
      kind,
      sortKey,
      sortDirection,
      view,
    });
    setSearchParams(next, { replace: true });
  }, [canManageKnowledge, section, mineView, search, kind, sortKey, sortDirection, view, setSearchParams]);

  const openMenu = (target: AssetTarget, draft: boolean, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, file: target.file, asset: target.asset, draft });
  };

  const activeMineRecords =
    mineView === 'drafts'
      ? hub.visibleDraftRecords
      : mineView === 'archived'
        ? hub.visibleArchivedRecords
        : hub.visibleRecords;
  const visibleMineIds = useMemo(() => activeMineRecords.map((record) => record.id), [activeMineRecords]);
  const mineRecordByPath = useMemo(
    () => new Map(hub.visibleRecords.map((record) => [record.raw.path, record])),
    [hub.visibleRecords]
  );
  const savedTargetByPath = useMemo(
    () =>
      new Map<string, AssetTarget>(
        hub.visibleRecords.flatMap(
          (record): Array<[string, AssetTarget]> =>
            record.asset ? [[record.raw.path, { file: record.raw, asset: record.asset } satisfies AssetTarget]] : []
        )
      ),
    [hub.visibleRecords]
  );
  const draftTargetByPath = useMemo(
    () =>
      new Map<string, AssetTarget>(
        hub.visibleDraftRecords.flatMap(
          (record): Array<[string, AssetTarget]> =>
            record.asset ? [[record.raw.path, { file: record.raw, asset: record.asset } satisfies AssetTarget]] : []
        )
      ),
    [hub.visibleDraftRecords]
  );
  const selectedMineRecords = useMemo(
    () => activeMineRecords.filter((record) => mineSelection.selectedIds.has(record.id)),
    [activeMineRecords, mineSelection]
  );
  const selectedMineFiles = useMemo(() => selectedMineRecords.map((record) => record.raw), [selectedMineRecords]);
  const selectedMineTargets = useMemo(
    () =>
      selectedMineRecords.flatMap((record) =>
        record.asset ? [{ file: record.raw, asset: record.asset } satisfies AssetTarget] : []
      ),
    [selectedMineRecords]
  );

  const copyMinePaths = async (files: readonly FileEntry[]) => {
    try {
      await navigator.clipboard.writeText(files.map((file) => file.path).join('\n'));
      Message.success(t('contentHub.toast.copied'));
    } catch {
      Message.error(t('contentHub.toast.copyFailed'));
    }
  };

  const saveDraftFiles = async (files: readonly FileEntry[]) => {
    const failed = await countFailures(files, saveDraftToContent);
    if (failed > 0) Message.error(t('contentHub.asset.saveFailed'));
    else Message.success(t('contentHub.asset.saveDone', { count: files.length }));
    await hub.reload();
  };

  const shareMineTargets = async (targets: readonly AssetTarget[]) => {
    const failed = await countFailures(targets, (target) => saveAssetToNas(target.asset));
    if (failed > 0) Message.error(t('contentHub.nas.publishFailed'));
    else Message.success(t('contentHub.batch.publishDone', { count: targets.length }));
    await hub.reloadAssets();
  };

  const publishDraftFiles = async (files: readonly FileEntry[]) => {
    const failed = await countFailures(files, async (file) => {
      const asset = await saveDraftToContent(file);
      await saveAssetToNas(asset);
    });
    if (failed > 0) Message.error(t('contentHub.nas.publishFailed'));
    else Message.success(t('contentHub.batch.publishDone', { count: files.length }));
    await hub.reload();
  };

  const publishAsset = async (asset: ContentAsset) => {
    try {
      await saveAssetToNas(asset);
      Message.success(t('contentHub.nas.publishedToNas'));
      await hub.reloadAssets();
    } catch {
      Message.error(t('contentHub.nas.publishFailed'));
    }
  };

  const archiveAsset = async (asset: ContentAsset) => {
    try {
      await markAssetArchived(asset);
      Message.success(t('contentHub.asset.archiveDone'));
      await hub.reloadAssets();
      setMineSelection(clearHubSelection());
    } catch {
      Message.error(t('contentHub.asset.archiveFailed'));
    }
  };

  const removeDraftFile = async (file: FileEntry) => {
    await ipcBridge.fs.removeEntry.invoke({ path: file.path });
  };

  const discardDraft = (file: FileEntry) => {
    Modal.confirm({
      title: t('contentHub.draft.deleteTitle'),
      content: t('contentHub.draft.deleteConfirm', { name: file.name }),
      okText: t('contentHub.actions.discardDraft'),
      cancelText: t('contentHub.nas.cancel'),
      onOk: async () => {
        try {
          await removeDraftFile(file);
          Message.success(t('contentHub.draft.deleted'));
          await hub.reload();
        } catch {
          Message.error(t('contentHub.draft.deleteFailed'));
        }
      },
    });
  };

  const discardDraftFiles = (files: readonly FileEntry[]) => {
    if (files.length === 0) return;
    const drafts = [...files];
    Modal.confirm({
      title: t('contentHub.draft.batchDeleteTitle'),
      content: t('contentHub.draft.batchDeleteConfirm', { count: drafts.length }),
      okText: t('contentHub.actions.discardDraft'),
      cancelText: t('contentHub.nas.cancel'),
      onOk: async () => {
        const failed = await countFailures(drafts, removeDraftFile);
        if (failed > 0) {
          Message.error(t('contentHub.draft.deleteFailed'));
        } else {
          Message.success(t('contentHub.draft.batchDeleted', { count: drafts.length }));
          setMineSelection(clearHubSelection());
        }
        await hub.reload();
      },
    });
  };

  const renderEmpty = (messageKey: string) => (
    <EmptyState
      loading={hub.loading}
      loadingMessage={t('contentHub.empty.loading')}
      message={search ? t('contentHub.empty.noMatch') : t(messageKey)}
    />
  );

  const toolbarProps: HubToolbarControls = {
    search,
    kind,
    sortKey,
    sortDirection,
    view,
    size,
    onSearchChange: setSearch,
    onKindChange: setKind,
    onSortKeyChange: setSortKey,
    onSortDirectionChange: setSortDirection,
    onViewChange: setView,
    onSizeChange: setSize,
  };

  // 我的产物 toolbar: legacy sub-view tabs plus global search/filter/sort/view.
  const mineToolbar = (
    <HubToolbar
      {...toolbarProps}
      onRefresh={hub.reload}
      refreshing={hub.loading}
      start={<MineSubTabs active={mineView} onChange={setMineView} />}
    />
  );

  const mineBatchActions: HubBatchAction[] =
    mineView === 'drafts'
      ? [
          {
            key: 'save-content',
            label: t('contentHub.actions.saveToContent'),
            icon: <Save theme='outline' size={14} />,
            onClick: () => void saveDraftFiles(selectedMineFiles),
          },
          {
            key: 'share',
            label: t('contentHub.actions.publishToNas'),
            icon: <Share theme='outline' size={14} />,
            onClick: () => void publishDraftFiles(selectedMineFiles),
          },
          {
            key: 'discard',
            label: t('contentHub.actions.discardDraft'),
            icon: <Delete theme='outline' size={14} />,
            onClick: () => discardDraftFiles(selectedMineFiles),
          },
        ]
      : mineView === 'archived'
        ? [
            {
              key: 'download',
              label: t('contentHub.actions.download'),
              icon: <Download theme='outline' size={14} />,
              onClick: () => {
                for (const file of selectedMineFiles) void actions.download(file);
                Message.success(t('contentHub.batch.downloadDone', { count: selectedMineFiles.length }));
              },
            },
            {
              key: 'copy',
              label: t('contentHub.actions.copyPath'),
              icon: <Copy theme='outline' size={14} />,
              onClick: () => void copyMinePaths(selectedMineFiles),
            },
          ]
        : [
          {
            key: 'download',
            label: t('contentHub.actions.download'),
            icon: <Download theme='outline' size={14} />,
            onClick: () => {
              for (const file of selectedMineFiles) void actions.download(file);
              Message.success(t('contentHub.batch.downloadDone', { count: selectedMineFiles.length }));
            },
          },
          {
            key: 'share',
            label: t('contentHub.actions.publishToNas'),
            icon: <Share theme='outline' size={14} />,
            onClick: () => void shareMineTargets(selectedMineTargets),
          },
          {
            key: 'archive',
            label: t('contentHub.actions.archive'),
            icon: <InboxOut theme='outline' size={14} />,
            onClick: () => void countFailures(selectedMineTargets, (target) => markAssetArchived(target.asset)).then(
              async (failed) => {
                if (failed > 0) Message.error(t('contentHub.asset.archiveFailed'));
                else Message.success(t('contentHub.asset.archiveDone'));
                await hub.reloadAssets();
                setMineSelection(clearHubSelection());
              }
            ),
          },
          {
            key: 'copy',
            label: t('contentHub.actions.copyPath'),
            icon: <Copy theme='outline' size={14} />,
            onClick: () => void copyMinePaths(selectedMineFiles),
          },
        ];

  const mineBatchBar = (
    <BatchActionBar
      count={selectedMineFiles.length}
      onClear={() => setMineSelection(clearHubSelection())}
      actions={mineBatchActions}
    />
  );

  const renderSavedActions = (target: AssetTarget) => (
    <>
      <Button
        type='text'
        size='mini'
        icon={<Share theme='outline' size={14} />}
        title={t('contentHub.actions.publishToNas')}
        onClick={() => void publishAsset(target.asset)}
      />
      <Button
        type='text'
        size='mini'
        icon={<InboxOut theme='outline' size={14} />}
        title={t('contentHub.actions.archive')}
        onClick={() => void archiveAsset(target.asset)}
      />
      <Button
        type='text'
        size='mini'
        icon={<Copy theme='outline' size={14} />}
        title={t('contentHub.actions.copyPath')}
        onClick={() => void actions.copyPath(target.file)}
      />
      <Button
        type='text'
        size='mini'
        icon={<Download theme='outline' size={14} />}
        title={t('contentHub.actions.download')}
        onClick={() => void actions.download(target.file)}
      />
      <Button
        type='text'
        size='mini'
        icon={<FolderOpen theme='outline' size={14} />}
        title={t('contentHub.actions.showInFolder')}
        onClick={() => void actions.reveal(target.file)}
      />
    </>
  );

  const renderDraftActions = (target: AssetTarget) => (
    <>
      <Button
        type='text'
        size='mini'
        icon={<Save theme='outline' size={14} />}
        title={t('contentHub.actions.saveToContent')}
        onClick={() => void saveDraftFiles([target.file])}
      />
      <Button
        type='text'
        size='mini'
        icon={<Share theme='outline' size={14} />}
        title={t('contentHub.actions.publishToNas')}
        onClick={() => void publishDraftFiles([target.file])}
      />
      <Button
        type='text'
        size='mini'
        icon={<Delete theme='outline' size={14} />}
        title={t('contentHub.actions.discardDraft')}
        onClick={() => discardDraft(target.file)}
      />
      <Button
        type='text'
        size='mini'
        icon={<Copy theme='outline' size={14} />}
        title={t('contentHub.actions.copyPath')}
        onClick={() => void actions.copyPath(target.file)}
      />
    </>
  );

  const renderArchivedActions = (target: AssetTarget) => (
    <>
      <Button
        type='text'
        size='mini'
        icon={<Copy theme='outline' size={14} />}
        title={t('contentHub.actions.copyPath')}
        onClick={() => void actions.copyPath(target.file)}
      />
      <Button
        type='text'
        size='mini'
        icon={<Download theme='outline' size={14} />}
        title={t('contentHub.actions.download')}
        onClick={() => void actions.download(target.file)}
      />
      <Button
        type='text'
        size='mini'
        icon={<FolderOpen theme='outline' size={14} />}
        title={t('contentHub.actions.showInFolder')}
        onClick={() => void actions.reveal(target.file)}
      />
    </>
  );

  const renderMine = () => {
    if (mineView === 'drafts') {
      return (
        <>
          {mineToolbar}
          {mineBatchBar}
          {hub.loading || hub.visibleDraftFiles.length === 0 ? (
            renderEmpty('contentHub.empty.noDrafts')
          ) : (
            <div className='flex-1 overflow-y-auto p-16px min-w-0'>
              {view === 'list' ? (
                <HubFileList
                  records={hub.visibleDraftRecords}
                  selectedIds={mineSelection.selectedIds}
                  onToggleSelect={(id) => setMineSelection((state) => toggleHubSelection(state, id))}
                  onToggleAll={(selected) =>
                    setMineSelection((state) => setHubSelectionForIds(state, visibleMineIds, selected))
                  }
                  onOpen={(record) => preview(record.raw)}
                  onDirectOpen={(record) => directOpen(record.raw)}
                  renderActions={(record) =>
                    record.asset ? renderDraftActions({ file: record.raw, asset: record.asset }) : null
                  }
                />
              ) : (
                <FileGrid
                  files={hub.visibleDraftFiles}
                  view={view}
                  size={size}
                  onOpen={preview}
                  onDirectOpen={directOpen}
                  onShare={(file) => void publishDraftFiles([file])}
                  onContextMenu={(file, event) => {
                    const target = draftTargetByPath.get(file.path);
                    if (target) openMenu(target, true, event);
                  }}
                />
              )}
            </div>
          )}
        </>
      );
    }

    if (mineView === 'byConversation') {
      return (
        <>
          {mineToolbar}
          {mineBatchBar}
          {hub.loading || hub.byConversation.length === 0 ? (
            renderEmpty('contentHub.empty.noAssets')
          ) : (
            <div className='flex-1 overflow-y-auto p-16px min-w-0'>
              {hub.byConversation.map((group) => (
                <ConversationGroup
                  key={group.conversation}
                  conversation={group.conversation}
                  files={group.files}
                  view={view}
                  size={size}
                  onOpen={preview}
                  onDirectOpen={directOpen}
                  onShare={(file) => {
                    const target = savedTargetByPath.get(file.path);
                    if (target) void publishAsset(target.asset);
                  }}
                  onContextMenu={(file, event) => {
                    const target = savedTargetByPath.get(file.path);
                    if (target) openMenu(target, false, event);
                  }}
                  renderList={(groupFiles) => {
                    const groupRecords = groupFiles.flatMap((file) => {
                      const record = mineRecordByPath.get(file.path);
                      return record ? [record] : [];
                    });
                    return (
                      <HubFileList
                        records={groupRecords}
                        selectedIds={mineSelection.selectedIds}
                        onToggleSelect={(id) => setMineSelection((state) => toggleHubSelection(state, id))}
                        onToggleAll={(selected) =>
                          setMineSelection((state) =>
                            setHubSelectionForIds(
                              state,
                              groupRecords.map((record) => record.id),
                              selected
                            )
                          )
                        }
                        onOpen={(record) => preview(record.raw)}
                        onDirectOpen={(record) => directOpen(record.raw)}
                        renderActions={(record) =>
                          record.asset ? renderSavedActions({ file: record.raw, asset: record.asset }) : null
                        }
                      />
                    );
                  }}
                />
              ))}
            </div>
          )}
        </>
      );
    }

    const records = mineView === 'archived' ? hub.visibleArchivedRecords : hub.visibleRecords;
    const files =
      mineView === 'archived'
        ? hub.visibleArchivedRecords.map((record) => record.raw)
        : mineView === 'byType'
          ? hub.byType
          : hub.searched;
    return (
      <>
        {mineToolbar}
        {mineBatchBar}
        {hub.loading || files.length === 0 ? (
          renderEmpty('contentHub.empty.noAssets')
        ) : (
          <div className='flex-1 overflow-y-auto p-16px min-w-0'>
            {view === 'list' ? (
              <HubFileList
                records={records}
                selectedIds={mineSelection.selectedIds}
                onToggleSelect={(id) => setMineSelection((state) => toggleHubSelection(state, id))}
                onToggleAll={(selected) =>
                  setMineSelection((state) => setHubSelectionForIds(state, visibleMineIds, selected))
                }
                onOpen={(record) => preview(record.raw)}
                onDirectOpen={(record) => directOpen(record.raw)}
                renderActions={(record) =>
                  record.asset
                    ? mineView === 'archived'
                      ? renderArchivedActions({ file: record.raw, asset: record.asset })
                      : renderSavedActions({ file: record.raw, asset: record.asset })
                    : null
                }
              />
            ) : (
              <FileGrid
                files={files}
                view={view}
                size={size}
                onOpen={preview}
                  onDirectOpen={directOpen}
                  onShare={(file) => {
                    const target = savedTargetByPath.get(file.path);
                    if (target) void publishAsset(target.asset);
                  }}
                onContextMenu={(file, event) => {
                  const target = savedTargetByPath.get(file.path);
                  if (target) openMenu(target, false, event);
                }}
              />
            )}
          </div>
        )}
      </>
    );
  };

  const renderBody = () => {
    if (section === 'nas') return <NasPanel controls={toolbarProps} />;
    if (section === 'knowledge') return canManageKnowledge ? <KnowledgeBasePanel controls={toolbarProps} /> : renderMine();
    return renderMine();
  };

  const mineVisibleCount =
    mineView === 'drafts'
      ? hub.visibleDraftTotal
      : mineView === 'archived'
        ? hub.visibleArchivedTotal
        : hub.visibleTotal;
  const mineTotalCount =
    mineView === 'drafts' ? hub.draftTotal : mineView === 'archived' ? hub.archivedTotal : hub.total;

  return (
    <div className='h-full min-h-0 bg-[var(--color-bg-2)] p-10px'>
      <div className='h-full min-h-0 flex overflow-hidden rd-10px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)]'>
        <HubSidebar
          active={section}
          mineCount={hub.visibleTotal}
          showKnowledge={canManageKnowledge}
          onChange={setSection}
        />
        <main className='flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--color-bg-1)]'>
          <HubSectionHeader
            section={section}
            mineView={mineView}
            visibleCount={section === 'mine' ? mineVisibleCount : undefined}
            totalCount={section === 'mine' ? mineTotalCount : undefined}
            selectedCount={section === 'mine' ? selectedMineFiles.length : 0}
            kind={kind}
            view={view}
          />
          {renderBody()}
        </main>
        {isPreviewOpen && (
          <aside className='w-[min(720px,42vw)] min-w-360px h-full min-h-0 shrink-0 border-l border-l-solid border-l-[var(--color-border-2)] bg-[var(--color-bg-1)] p-8px'>
            <div className='h-full min-h-0 overflow-hidden'>
              <PreviewPanel />
            </div>
          </aside>
        )}
      </div>
      <HubContextMenu
        state={menu}
        onOpen={preview}
        onSaveToContent={(file) => void saveDraftFiles([file])}
        onShare={(file, asset) => {
          if (asset?.id.startsWith('draft:')) void publishDraftFiles([file]);
          else if (asset) void publishAsset(asset);
        }}
        onArchive={(asset) => void archiveAsset(asset)}
        onDiscardDraft={discardDraft}
        onCopyPath={(f) => void actions.copyPath(f)}
        onDownload={(f) => void actions.download(f)}
        onReveal={(f) => void actions.reveal(f)}
        onClose={() => setMenu(null)}
      />
    </div>
  );
};

export default ContentHubPage;
