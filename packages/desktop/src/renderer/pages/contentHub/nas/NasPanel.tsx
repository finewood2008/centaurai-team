/**
 * NasPanel — Enterprise NAS with AI-generated index and full file tree views.
 *
 * Browses the admin's large shared disk: folders navigate in place, files open
 * (inline preview) or download. Read+write (P2): upload (button + drag-drop),
 * new folder, rename, and delete (soft-delete to a recycle folder). Backed by
 * the web-host /api/nas/* routes (or admin IPC) via NasService.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Message, Modal, Popconfirm } from '@arco-design/web-react';
import { Delete, Download, Editor, FileText, FolderClose, FolderPlus, Right, Upload } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useNas } from './useNas';
import {
  cancelNasIndex,
  downloadNasFile,
  emptyNasTrash,
  getNasLocalFileInfo,
  isNasAdmin,
  listNasTrash,
  nasPreviewUrl,
  openNasFileDirect,
  pollNasIndex,
  purgeNasTrash,
  removeNasEntry,
  restoreNasTrash,
  startNasIndex,
  type NasEntry,
  type NasIndexProgress,
  type NasTrashEntry,
} from '@/renderer/services/NasService';
import { formatFileSize } from '@/renderer/services/FileService';
import EmptyState from '../components/EmptyState';
import BatchActionBar from '../components/manage/BatchActionBar';
import HubFileList from '../components/manage/HubFileList';
import HubRecordCards from '../components/manage/HubRecordCards';
import HubToolbar from '../components/manage/HubToolbar';
import HubUrlPreviewModal, { isActiveHubPreview, type HubUrlPreview } from '../components/manage/HubUrlPreviewModal';
import { listContentAssets } from '../components/manage/contentAssets';
import {
  classifyHubFile,
  clearHubSelection,
  createHubSelectionState,
  filterHubRecords,
  setHubSelectionForIds,
  sortHubRecords,
  toggleHubSelection,
} from '../components/manage/hubState';
import { useHubPreview } from '../useHubPreview';
import type { ContentAsset, FileEntry, HubFileRecord, HubToolbarControls } from '../types';

type NasPanelProps = {
  controls: HubToolbarControls;
};

const pad = (n: number) => String(n).padStart(2, '0');

function formatDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const NasPanel: React.FC<NasPanelProps> = ({ controls }) => {
  const { t } = useTranslation();
  const appNavigate = useNavigate();
  const {
    path,
    entries,
    loading,
    disabled,
    unavailable,
    navigate: navigateNas,
    refresh,
    mkdir,
    upload,
    remove,
    rename,
  } = useNas();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(createHubSelectionState());
  // Naming dialog (shared by "new folder" and "rename").
  const [dialog, setDialog] = useState<{ mode: 'mkdir' | 'rename'; entry?: NasEntry; value: string } | null>(null);
  // Recycle-bin view (admin desktop only).
  const admin = isNasAdmin();
  const [trashView, setTrashView] = useState(false);
  const [trash, setTrash] = useState<NasTrashEntry[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [urlPreview, setUrlPreview] = useState<HubUrlPreview | null>(null);
  const previewLocalFile = useHubPreview();
  const [nasView, setNasView] = useState<'ai' | 'files'>('ai');
  const [aiAssets, setAiAssets] = useState<ContentAsset[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  // Knowledge-base indexing (admin).
  const [indexConfirm, setIndexConfirm] = useState(false);
  const [indexVideo, setIndexVideo] = useState(false);
  const [indexJob, setIndexJob] = useState<{ jobId: string; p: NasIndexProgress } | null>(null);

  const loadAiAssets = useCallback(async () => {
    setAiLoading(true);
    try {
      const assets = await listContentAssets();
      setAiAssets(
        assets.filter(
          (asset) =>
            asset.nasStoragePath &&
            asset.statusFlags.includes('stored_in_nas') &&
            !asset.statusFlags.includes('archived')
        )
      );
    } catch {
      setAiAssets([]);
    } finally {
      setAiLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAiAssets();
  }, [loadAiAssets]);

  useEffect(() => {
    setSelection(clearHubSelection());
  }, [nasView]);

  // Poll the running index job until it finishes.
  useEffect(() => {
    if (!indexJob || indexJob.p.phase === 'done' || indexJob.p.phase === 'error') return;
    const timer = setInterval(async () => {
      let p: NasIndexProgress | null = null;
      try {
        p = await pollNasIndex(indexJob.jobId);
      } catch {
        p = null;
      }
      if (!p) return;
      setIndexJob((prev) => (prev && prev.jobId === indexJob.jobId ? { jobId: prev.jobId, p } : prev));
      if (p.phase === 'done') {
        Message.success(t('contentHub.nas.indexDone', { done: p.done, skipped: p.skipped, failed: p.failed }));
      } else if (p.phase === 'error') {
        Message.error(t('contentHub.nas.indexFailed'));
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [indexJob, t]);

  const startIndex = async () => {
    setIndexConfirm(false);
    try {
      const jobId = await startNasIndex(path, indexVideo);
      setIndexJob({ jobId, p: { phase: 'walking', total: 0, done: 0, failed: 0, skipped: 0, pruned: 0 } });
    } catch {
      Message.error(t('contentHub.nas.indexFailed'));
    }
  };

  const records = useMemo<HubFileRecord<NasEntry>[]>(
    () =>
      entries.map((entry) => ({
        id: entry.relPath,
        name: entry.name,
        path: entry.relPath,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
        kind: entry.isDir ? 'other' : classifyHubFile(entry.name),
        source: 'nas',
        subtitle: entry.relPath,
        isDirectory: entry.isDir,
        raw: entry,
      })),
    [entries]
  );
  const aiRecords = useMemo<HubFileRecord<ContentAsset>[]>(
    () =>
      aiAssets.map((asset) => ({
        id: asset.id,
        name: asset.title,
        path: asset.nasStoragePath,
        size: 0,
        modifiedAt: asset.updatedAt,
        kind: asset.kind,
        source: 'nas',
        subtitle: asset.nasStoragePath,
        raw: asset,
      })),
    [aiAssets]
  );
  const visibleRecords = useMemo(
    () =>
      sortHubRecords(
        filterHubRecords(records, controls.search, controls.kind),
        controls.sortKey,
        controls.sortDirection
      ),
    [records, controls.search, controls.kind, controls.sortKey, controls.sortDirection]
  );
  const visibleAiRecords = useMemo(
    () =>
      sortHubRecords(
        filterHubRecords(aiRecords, controls.search, controls.kind),
        controls.sortKey,
        controls.sortDirection
      ),
    [aiRecords, controls.search, controls.kind, controls.sortKey, controls.sortDirection]
  );
  const visibleEntries = useMemo(() => visibleRecords.map((record) => record.raw), [visibleRecords]);
  const visibleIds = useMemo(() => visibleRecords.map((record) => record.id), [visibleRecords]);
  const selectedEntries = useMemo(
    () => visibleRecords.filter((record) => selection.selectedIds.has(record.id)).map((record) => record.raw),
    [visibleRecords, selection]
  );
  const selectedFiles = useMemo(() => selectedEntries.filter((entry) => !entry.isDir), [selectedEntries]);

  const entryFromAsset = useCallback((asset: ContentAsset): NasEntry => {
    return {
      name: asset.title,
      relPath: asset.nasStoragePath || '',
      isDir: false,
      size: 0,
      modifiedAt: asset.updatedAt,
    };
  }, []);

  const renderAiActions = (asset: ContentAsset) => (
    <Button
      type='text'
      size='mini'
      icon={<Download theme='outline' size={14} />}
      title={t('contentHub.nas.download')}
      onClick={() => {
        if (asset.nasStoragePath) void downloadNasFile(asset.nasStoragePath);
      }}
    />
  );

  // Breadcrumb: root + each cumulative path segment.
  const crumbs = useMemo(() => {
    const segs = path ? path.split('/') : [];
    let acc = '';
    return segs.map((seg) => {
      acc = acc ? `${acc}/${seg}` : seg;
      return { label: seg, path: acc };
    });
  }, [path]);

  const previewEntry = async (entry: NasEntry) => {
    if (entry.isDir) navigateNas(entry.relPath);
    else {
      try {
        // Never route uploaded active content into the desktop HTML preview,
        // whose interactive mode intentionally permits scripts. The URL modal
        // fetches HTML/SVG/XML as bounded inert text instead.
        if (!isActiveHubPreview({ title: entry.name, url: '' })) {
          const local = await getNasLocalFileInfo(entry.relPath);
          if (local) {
            await previewLocalFile({
              name: local.name,
              path: local.path,
              size: local.size,
              mtime: Math.floor(entry.modifiedAt / 1000),
              conversation: t('contentHub.tabs.nas'),
            } satisfies FileEntry);
            return;
          }
        }
        setUrlPreview({ title: entry.name, url: await nasPreviewUrl(entry.relPath) });
      } catch {
        Message.error(t('contentHub.toast.openFailed'));
      }
    }
  };

  const directOpenEntry = async (entry: NasEntry) => {
    if (entry.isDir) navigateNas(entry.relPath);
    else {
      try {
        await openNasFileDirect(entry.relPath);
      } catch {
        Message.error(t('contentHub.toast.openFailed'));
      }
    }
  };

  const run = async (fn: () => Promise<void>, failKey: string) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      Message.error(t(failKey));
    } finally {
      setBusy(false);
    }
  };

  const loadTrash = async () => {
    setTrashLoading(true);
    try {
      setTrash(await listNasTrash());
    } finally {
      setTrashLoading(false);
    }
  };
  const openTrash = () => {
    setTrashView(true);
    void loadTrash();
  };
  const closeTrash = () => {
    setTrashView(false);
    refresh();
  };

  const doUpload = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    void run(async () => {
      await upload(list);
      Message.success(t('contentHub.nas.uploadDone'));
    }, 'contentHub.nas.uploadFailed');
  };

  const batchDownload = () => {
    for (const entry of selectedFiles) void downloadNasFile(entry.relPath);
    Message.success(t('contentHub.batch.downloadDone', { count: selectedFiles.length }));
  };

  const batchDelete = async () => {
    setBusy(true);
    try {
      await Promise.all(selectedEntries.map((entry) => removeNasEntry(entry.relPath)));
      setSelection(clearHubSelection());
      refresh();
      Message.success(t('contentHub.batch.deleteDone', { count: selectedEntries.length }));
    } catch {
      Message.error(t('contentHub.nas.deleteFailed'));
    } finally {
      setBusy(false);
    }
  };

  const renderEntryActions = (entry: NasEntry) => (
    <>
      {!entry.isDir && (
        <Button
          type='text'
          size='mini'
          icon={<Download theme='outline' size={14} />}
          title={t('contentHub.nas.download')}
          onClick={() => void downloadNasFile(entry.relPath)}
        />
      )}
      <Button
        type='text'
        size='mini'
        icon={<Editor theme='outline' size={14} />}
        title={t('contentHub.nas.rename')}
        onClick={() => setDialog({ mode: 'rename', entry, value: entry.name })}
      />
      <Popconfirm
        focusLock
        title={t('contentHub.nas.deleteConfirm', { name: entry.name })}
        okText={t('contentHub.nas.delete')}
        cancelText={t('contentHub.nas.cancel')}
        onOk={() => run(() => remove(entry), 'contentHub.nas.deleteFailed')}
      >
        <Button
          type='text'
          size='mini'
          status='danger'
          icon={<Delete theme='outline' size={14} />}
          title={t('contentHub.nas.delete')}
        />
      </Popconfirm>
    </>
  );

  const submitDialog = () => {
    if (!dialog) return;
    const name = dialog.value.trim();
    if (!name) return;
    const { mode, entry } = dialog;
    setDialog(null);
    void run(
      async () => {
        if (mode === 'mkdir') await mkdir(name);
        else if (entry) await rename(entry, name);
      },
      mode === 'mkdir' ? 'contentHub.nas.mkdirFailed' : 'contentHub.nas.renameFailed'
    );
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files);
  };
  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  if (disabled) {
    return (
      <div className='flex-1 flex items-center justify-center px-16px text-center'>
        <div className='max-w-420px flex flex-col items-center gap-10px'>
          <div className='text-14px text-t-primary font-500'>{t('contentHub.nas.disabled')}</div>
          <div className='text-12px text-t-secondary leading-relaxed'>{t('contentHub.nas.setupStorageDesc')}</div>
          {admin && (
            <Button type='primary' className='rd-100px' onClick={() => void appNavigate('/settings/system')}>
              {t('contentHub.nas.openNasSettings')}
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (unavailable) {
    return (
      <div className='flex-1 flex items-center justify-center px-16px text-center'>
        <div className='max-w-420px flex flex-col items-center gap-10px'>
          <div className='text-14px text-t-primary font-500'>{t('contentHub.nas.unavailable')}</div>
          <div className='text-12px text-t-secondary leading-relaxed'>{t('contentHub.nas.startWebuiHint')}</div>
          {admin && (
            <Button type='primary' className='rd-100px' onClick={() => void appNavigate('/settings/system')}>
              {t('contentHub.nas.openNasSettings')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (trashView) {
    return (
      <div className='flex-1 flex flex-col min-h-0 px-16px pb-16px'>
        <div className='flex items-center gap-8px py-12px text-13px shrink-0'>
          <span className='cursor-pointer text-t-secondary hover:text-t-primary' onClick={closeTrash}>
            ← {t('contentHub.nas.root')}
          </span>
          <Right theme='outline' size={12} className='text-t-tertiary' />
          <span className='text-t-primary'>{t('contentHub.nas.trash')}</span>
          {trash.length > 0 && (
            <Popconfirm
              focusLock
              title={t('contentHub.nas.emptyConfirm')}
              okText={t('contentHub.nas.emptyTrash')}
              cancelText={t('contentHub.nas.cancel')}
              onOk={() =>
                run(async () => {
                  await emptyNasTrash();
                  await loadTrash();
                }, 'contentHub.nas.deleteFailed')
              }
            >
              <Button
                type='text'
                size='mini'
                status='danger'
                className='ml-auto'
                icon={<Delete theme='outline' size={14} />}
              >
                {t('contentHub.nas.emptyTrash')}
              </Button>
            </Popconfirm>
          )}
        </div>
        {trash.length === 0 ? (
          <EmptyState
            loading={trashLoading}
            message={t('contentHub.nas.trashEmpty')}
            loadingMessage={t('contentHub.nas.loading')}
          />
        ) : (
          <div className='flex-1 overflow-auto min-h-0'>
            <div className='flex items-center gap-12px px-12px py-8px text-12px text-t-tertiary border-b border-b-solid border-b-[var(--color-border-2)]'>
              <span className='flex-1'>{t('contentHub.nas.colName')}</span>
              <span className='w-100px text-right'>{t('contentHub.nas.colSize')}</span>
              <span className='w-140px text-right'>{t('contentHub.nas.deletedAt')}</span>
              <span className='w-140px' />
            </div>
            {trash.map((e) => (
              <div
                key={e.trashName}
                className='flex items-center gap-12px px-12px py-10px text-13px rd-6px hover:bg-fill-2 group'
              >
                <span className='flex-1 flex items-center gap-8px truncate'>
                  {e.isDir ? (
                    <FolderClose theme='outline' size={16} className='text-[var(--color-warning-6)] shrink-0' />
                  ) : (
                    <FileText theme='outline' size={16} className='text-t-tertiary shrink-0' />
                  )}
                  <span className='truncate text-t-primary'>{e.originalName}</span>
                </span>
                <span className='w-100px text-right text-t-secondary'>{e.isDir ? '—' : formatFileSize(e.size)}</span>
                <span className='w-140px text-right text-t-secondary'>{formatDate(e.deletedAt)}</span>
                <span className='w-140px flex justify-end gap-2px opacity-0 group-hover:opacity-100 transition-opacity'>
                  <Button
                    type='text'
                    size='mini'
                    onClick={() =>
                      run(async () => {
                        await restoreNasTrash(e.trashName);
                        await loadTrash();
                      }, 'contentHub.nas.restoreFailed')
                    }
                  >
                    {t('contentHub.nas.restore')}
                  </Button>
                  <Popconfirm
                    focusLock
                    title={t('contentHub.nas.purgeConfirm', { name: e.originalName })}
                    okText={t('contentHub.nas.purge')}
                    cancelText={t('contentHub.nas.cancel')}
                    onOk={() =>
                      run(async () => {
                        await purgeNasTrash(e.trashName);
                        await loadTrash();
                      }, 'contentHub.nas.deleteFailed')
                    }
                  >
                    <Button type='text' size='mini' status='danger'>
                      {t('contentHub.nas.purge')}
                    </Button>
                  </Popconfirm>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className='flex-1 flex flex-col min-h-0 px-16px pb-16px relative'
      onDragEnter={nasView === 'files' ? onDragEnter : undefined}
      onDragOver={
        nasView === 'files'
          ? (e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault();
            }
          : undefined
      }
      onDragLeave={nasView === 'files' ? onDragLeave : undefined}
      onDrop={nasView === 'files' ? onDrop : undefined}
    >
      <HubToolbar
        {...controls}
        onRefresh={nasView === 'ai' ? loadAiAssets : refresh}
        refreshing={nasView === 'ai' ? aiLoading : loading}
        start={
          <div className='flex flex-wrap items-center gap-8px min-w-0'>
            <div className='flex items-center gap-2px p-2px rd-8px bg-[var(--color-fill-1)] border border-solid border-[var(--color-border-2)]'>
              <Button
                type='text'
                size='mini'
                className={nasView === 'ai' ? '!bg-[var(--color-fill-3)] !text-t-primary' : '!text-t-secondary'}
                onClick={() => setNasView('ai')}
              >
                {t('contentHub.nas.aiGenerated')}
              </Button>
              <Button
                type='text'
                size='mini'
                className={nasView === 'files' ? '!bg-[var(--color-fill-3)] !text-t-primary' : '!text-t-secondary'}
                onClick={() => setNasView('files')}
              >
                {t('contentHub.nas.allFiles')}
              </Button>
            </div>
            {nasView === 'files' && (
              <div className='flex items-center gap-6px text-13px min-w-0'>
                <span
                  className='cursor-pointer text-t-secondary hover:text-t-primary whitespace-nowrap'
                  onClick={() => navigateNas('')}
                >
                  {t('contentHub.nas.root')}
                </span>
                {crumbs.map((c) => (
                  <React.Fragment key={c.path}>
                    <Right theme='outline' size={12} className='text-t-tertiary shrink-0' />
                    <span
                      className='cursor-pointer text-t-secondary hover:text-t-primary max-w-120px truncate'
                      onClick={() => navigateNas(c.path)}
                    >
                      {c.label}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        }
        end={
          nasView === 'files' ? (
            <div className='flex flex-wrap items-center gap-4px'>
              <Button
                type='text'
                size='mini'
                icon={<Upload theme='outline' size={14} />}
                loading={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {t('contentHub.nas.upload')}
              </Button>
              <Button
                type='text'
                size='mini'
                icon={<FolderPlus theme='outline' size={14} />}
                onClick={() => setDialog({ mode: 'mkdir', value: '' })}
              >
                {t('contentHub.nas.newFolder')}
              </Button>
              {admin && (
                <Button
                  type='text'
                  size='mini'
                  onClick={() => setIndexConfirm(true)}
                  disabled={!!indexJob && indexJob.p.phase !== 'done' && indexJob.p.phase !== 'error'}
                >
                  {t('contentHub.nas.index')}
                </Button>
              )}
              {admin && (
                <Button type='text' size='mini' icon={<Delete theme='outline' size={14} />} onClick={openTrash}>
                  {t('contentHub.nas.trash')}
                </Button>
              )}
            </div>
          ) : null
        }
      />
      <input
        ref={fileInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={(e) => {
          doUpload(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Knowledge-base indexing progress banner */}
      {nasView === 'files' && indexJob && indexJob.p.phase !== 'done' && indexJob.p.phase !== 'error' && (
        <div className='mb-8px shrink-0 rd-8px bg-fill-2 px-12px py-8px text-12px text-t-secondary flex items-center gap-8px'>
          <span>
            {indexJob.p.phase === 'walking'
              ? t('contentHub.nas.indexScanning')
              : t('contentHub.nas.indexProgress', {
                  done: indexJob.p.done,
                  total: indexJob.p.total,
                  skipped: indexJob.p.skipped,
                  failed: indexJob.p.failed,
                })}
          </span>
          <Button
            type='text'
            size='mini'
            className='ml-auto'
            onClick={() => {
              void cancelNasIndex(indexJob.jobId);
            }}
          >
            {t('contentHub.nas.cancel')}
          </Button>
        </div>
      )}

      {nasView === 'ai' ? (
        aiLoading || visibleAiRecords.length === 0 ? (
          <EmptyState
            loading={aiLoading}
            message={
              controls.search || controls.kind !== 'all' ? t('contentHub.empty.noMatch') : t('contentHub.nas.aiEmpty')
            }
            loadingMessage={t('contentHub.nas.loading')}
          />
        ) : (
          <div className='flex-1 overflow-auto min-h-0'>
            {controls.view === 'list' ? (
              <HubFileList
                records={visibleAiRecords}
                onOpen={(record) => void previewEntry(entryFromAsset(record.raw))}
                onDirectOpen={(record) => void directOpenEntry(entryFromAsset(record.raw))}
                renderActions={(record) => renderAiActions(record.raw)}
              />
            ) : (
              <HubRecordCards
                records={visibleAiRecords}
                view={controls.view}
                size={controls.size}
                onOpen={(record) => void previewEntry(entryFromAsset(record.raw))}
                onDirectOpen={(record) => void directOpenEntry(entryFromAsset(record.raw))}
                renderActions={(record) => renderAiActions(record.raw)}
              />
            )}
          </div>
        )
      ) : (
        <>
          {/* Listing */}
          <BatchActionBar
            count={selectedEntries.length}
            onClear={() => setSelection(clearHubSelection())}
            actions={[
              {
                key: 'download',
                label: t('contentHub.actions.download'),
                icon: <Download theme='outline' size={14} />,
                disabled: selectedFiles.length === 0,
                onClick: batchDownload,
              },
              {
                key: 'delete',
                label: t('contentHub.actions.delete'),
                icon: <Delete theme='outline' size={14} />,
                status: 'danger',
                loading: busy,
                onClick: () => void batchDelete(),
              },
            ]}
          />

          {visibleEntries.length === 0 ? (
            <EmptyState
              loading={loading}
              message={
                controls.search || controls.kind !== 'all' ? t('contentHub.empty.noMatch') : t('contentHub.nas.empty')
              }
              loadingMessage={t('contentHub.nas.loading')}
            />
          ) : (
            <div className='flex-1 overflow-auto min-h-0'>
              {controls.view === 'list' ? (
                <HubFileList
                  records={visibleRecords}
                  selectedIds={selection.selectedIds}
                  onToggleSelect={(id) => setSelection((state) => toggleHubSelection(state, id))}
                  onToggleAll={(selected) =>
                    setSelection((state) => setHubSelectionForIds(state, visibleIds, selected))
                  }
                  onOpen={(record) => void previewEntry(record.raw)}
                  onDirectOpen={(record) => void directOpenEntry(record.raw)}
                  renderActions={(record) => renderEntryActions(record.raw)}
                />
              ) : (
                <HubRecordCards
                  records={visibleRecords}
                  view={controls.view}
                  size={controls.size}
                  selectedIds={selection.selectedIds}
                  onToggleSelect={(id) => setSelection((state) => toggleHubSelection(state, id))}
                  onOpen={(record) => void previewEntry(record.raw)}
                  onDirectOpen={(record) => void directOpenEntry(record.raw)}
                  renderActions={(record) => renderEntryActions(record.raw)}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Drag-drop overlay */}
      {nasView === 'files' && dragging && (
        <div className='absolute inset-0 z-10 flex items-center justify-center bg-[rgba(var(--primary-6),0.08)] border-2 border-dashed border-[rgb(var(--primary-6))] rd-12px text-14px text-[rgb(var(--primary-6))] pointer-events-none'>
          {t('contentHub.nas.dropHere')}
        </div>
      )}

      {/* New-folder / rename dialog */}
      <Modal
        visible={!!dialog}
        title={dialog?.mode === 'rename' ? t('contentHub.nas.renameTitle') : t('contentHub.nas.newFolderTitle')}
        okText={t('contentHub.nas.ok')}
        cancelText={t('contentHub.nas.cancel')}
        onOk={submitDialog}
        onCancel={() => setDialog(null)}
        autoFocus
        focusLock
      >
        <Input
          autoFocus
          value={dialog?.value ?? ''}
          placeholder={t('contentHub.nas.namePlaceholder')}
          onChange={(v) => setDialog((d) => (d ? { ...d, value: v } : d))}
          onPressEnter={submitDialog}
        />
      </Modal>

      {/* Index-to-knowledge-base confirm */}
      <Modal
        visible={indexConfirm}
        title={t('contentHub.nas.indexTitle')}
        okText={t('contentHub.nas.index')}
        cancelText={t('contentHub.nas.cancel')}
        onOk={startIndex}
        onCancel={() => setIndexConfirm(false)}
      >
        <div className='text-13px text-t-secondary leading-relaxed mb-12px'>
          {t('contentHub.nas.indexDesc', { folder: path || t('contentHub.nas.root') })}
        </div>
        <Checkbox checked={indexVideo} onChange={setIndexVideo}>
          {t('contentHub.nas.indexVideo')}
        </Checkbox>
      </Modal>
      <HubUrlPreviewModal preview={urlPreview} onClose={() => setUrlPreview(null)} />
    </div>
  );
};

export default NasPanel;
