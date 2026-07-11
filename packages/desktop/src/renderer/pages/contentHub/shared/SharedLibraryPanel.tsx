/**
 * SharedLibraryPanel — legacy Enterprise NAS-compatible shared-drive panel.
 *
 * Files here are visible to everyone on the LAN, organized by category.
 * Backed by the web-host /api/shared-drive/* routes via SharedDriveService.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Button, Message } from '@arco-design/web-react';
import { Delete, Download, Share, Upload } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import CategorySidebar from './CategorySidebar';
import SharedFileCard from './SharedFileCard';
import EmptyState from '../components/EmptyState';
import BatchActionBar from '../components/manage/BatchActionBar';
import HubFileList from '../components/manage/HubFileList';
import HubToolbar from '../components/manage/HubToolbar';
import HubUrlPreviewModal, { type HubUrlPreview } from '../components/manage/HubUrlPreviewModal';
import {
  classifyHubFile,
  clearHubSelection,
  createHubSelectionState,
  filterHubRecords,
  setHubSelectionForIds,
  sortHubRecords,
  toggleHubSelection,
} from '../components/manage/hubState';
import { WATERFALL_COL_WIDTH } from '../components/view/viewConfig';
import { useHubPreview } from '../useHubPreview';
import { useSharedDrive } from '../useSharedDrive';
import {
  downloadShared,
  getSharedLocalInfo,
  openSharedDirect,
  removeShared,
  sharedPreviewUrl,
} from '@/renderer/services/SharedDriveService';
import type { FileEntry, HubFileRecord, HubToolbarControls } from '../types';
import type { SharedFileEntry } from '@/common/adapter/ipcBridge';

type SharedLibraryPanelProps = {
  controls: HubToolbarControls;
};

const SharedLibraryPanel: React.FC<SharedLibraryPanelProps> = ({ controls }) => {
  const { t } = useTranslation();
  const { files, categories, category, setCategory, loading, unavailable, reload, remove, addFiles } = useSharedDrive();
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState(createHubSelectionState());
  const [urlPreview, setUrlPreview] = useState<HubUrlPreview | null>(null);
  const previewLocalFile = useHubPreview();
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const total = categories.reduce((sum, c) => sum + c.count, 0);
  const records = useMemo<HubFileRecord<SharedFileEntry>[]>(
    () =>
      files.map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        modifiedAt: Math.floor(file.createdAt / 1000),
        kind: classifyHubFile(file.name),
        source: 'shared',
        subtitle: file.uploaderName || file.uploaderId || file.category,
        raw: file,
      })),
    [files]
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
  const visibleFiles = useMemo(() => visibleRecords.map((record) => record.raw), [visibleRecords]);
  const visibleIds = useMemo(() => visibleRecords.map((record) => record.id), [visibleRecords]);
  const selectedFiles = useMemo(
    () => visibleRecords.filter((record) => selection.selectedIds.has(record.id)).map((record) => record.raw),
    [visibleRecords, selection]
  );

  const uploadFiles = async (incoming: File[]) => {
    if (incoming.length === 0) return;
    try {
      await addFiles(incoming);
      Message.success(t('contentHub.share.success'));
    } catch {
      Message.error(t('contentHub.share.error'));
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };
  const onDragLeave = () => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length === 0) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    await uploadFiles(dropped);
  };

  const batchDownload = async () => {
    try {
      await Promise.all(selectedFiles.map((file) => downloadShared(file.id, file.name)));
      Message.success(t('contentHub.batch.downloadDone', { count: selectedFiles.length }));
    } catch {
      Message.error(t('contentHub.toast.downloadFailed'));
    }
  };

  const batchDelete = async () => {
    try {
      await Promise.all(selectedFiles.map((file) => removeShared(file.id)));
      await reload();
      setSelection(clearHubSelection());
      Message.success(t('contentHub.batch.deleteDone', { count: selectedFiles.length }));
    } catch {
      Message.error(t('contentHub.batch.deleteFailed'));
    }
  };

  const previewSharedFile = async (file: SharedFileEntry) => {
    try {
      const local = await getSharedLocalInfo(file.id);
      if (local) {
        await previewLocalFile({
          name: local.name,
          path: local.path,
          size: file.size,
          mtime: Math.floor(file.createdAt / 1000),
          conversation: file.category || t('contentHub.tabs.shared'),
        } satisfies FileEntry);
        return;
      }
      setUrlPreview({ title: file.name, url: await sharedPreviewUrl(file.id) });
    } catch {
      Message.error(t('contentHub.toast.openFailed'));
    }
  };

  const directOpenSharedFile = async (file: SharedFileEntry) => {
    try {
      await openSharedDirect(file.id);
    } catch {
      Message.error(t('contentHub.toast.openFailed'));
    }
  };

  const renderListActions = (file: SharedFileEntry) => {
    return (
      <>
        <Button
          type='text'
          size='mini'
          icon={<Download theme='outline' size={14} />}
          title={t('contentHub.actions.download')}
          onClick={() => void downloadShared(file.id, file.name)}
        />
        <Button
          type='text'
          size='mini'
          status='danger'
          icon={<Delete theme='outline' size={14} />}
          title={t('contentHub.actions.delete')}
          onClick={() => void remove(file.id)}
        />
      </>
    );
  };

  if (unavailable) {
    return (
      <div className='flex-1 flex flex-col items-center justify-center gap-12px text-t-secondary'>
        <Share size='40' className='opacity-50' />
        <div className='text-14px'>{t('contentHub.shared.comingSoon')}</div>
        <div className='text-12px opacity-70'>{t('contentHub.shared.allVisible')}</div>
      </div>
    );
  }

  return (
    <div
      className='flex-1 flex min-h-0 relative'
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={(event) => {
          void uploadFiles(event.target.files ? Array.from(event.target.files) : []);
          event.target.value = '';
        }}
      />
      {dragging && (
        <div className='absolute inset-0 z-50 flex flex-col items-center justify-center gap-8px bg-[var(--color-bg-1)]/85 border-2 border-dashed border-[var(--color-primary-6)] rd-12px pointer-events-none'>
          <Upload size='32' className='text-[var(--color-primary-6)]' />
          <div className='text-14px text-t-primary'>{t('contentHub.shared.upload')}</div>
        </div>
      )}
      <CategorySidebar categories={categories} total={total} selected={category} onSelect={setCategory} />
      <div className='flex-1 flex flex-col min-w-0'>
        <HubToolbar
          {...controls}
          onRefresh={reload}
          refreshing={loading}
          start={
            <span className='text-11px text-t-secondary whitespace-nowrap'>{t('contentHub.shared.allVisible')}</span>
          }
          end={
            <Button
              type='text'
              size='mini'
              icon={<Upload theme='outline' size={14} />}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('contentHub.shared.upload')}
            </Button>
          }
        />
        <BatchActionBar
          count={selectedFiles.length}
          onClear={() => setSelection(clearHubSelection())}
          actions={[
            {
              key: 'download',
              label: t('contentHub.actions.download'),
              icon: <Download theme='outline' size={14} />,
              onClick: () => void batchDownload(),
            },
            {
              key: 'delete',
              label: t('contentHub.actions.delete'),
              icon: <Delete theme='outline' size={14} />,
              status: 'danger',
              onClick: () => void batchDelete(),
            },
          ]}
        />
        {loading || visibleFiles.length === 0 ? (
          <EmptyState
            loading={loading}
            loadingMessage={t('contentHub.empty.loading')}
            message={
              controls.search || controls.kind !== 'all' ? t('contentHub.empty.noMatch') : t('contentHub.shared.empty')
            }
          />
        ) : (
          <div className='flex-1 overflow-y-auto p-16px'>
            {controls.view === 'list' ? (
              <HubFileList
                records={visibleRecords}
                selectedIds={selection.selectedIds}
                onToggleSelect={(id) => setSelection((state) => toggleHubSelection(state, id))}
                onToggleAll={(selected) => setSelection((state) => setHubSelectionForIds(state, visibleIds, selected))}
                onOpen={(record) => void previewSharedFile(record.raw)}
                onDirectOpen={(record) => void directOpenSharedFile(record.raw)}
                renderActions={(record) => renderListActions(record.raw)}
              />
            ) : controls.view === 'waterfall' ? (
              <div style={{ columnWidth: WATERFALL_COL_WIDTH[controls.size], columnGap: 12 }}>
                {visibleFiles.map((file) => (
                  <SharedFileCard
                    key={file.id}
                    file={file}
                    view={controls.view}
                    size={controls.size}
                    onRemove={remove}
                    onPreview={(target) => void previewSharedFile(target)}
                    onDirectOpen={(target) => void directOpenSharedFile(target)}
                  />
                ))}
              </div>
            ) : (
              <div className='flex flex-wrap gap-8px'>
                {visibleFiles.map((file) => (
                  <SharedFileCard
                    key={file.id}
                    file={file}
                    view={controls.view}
                    size={controls.size}
                    onRemove={remove}
                    onPreview={(target) => void previewSharedFile(target)}
                    onDirectOpen={(target) => void directOpenSharedFile(target)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <HubUrlPreviewModal preview={urlPreview} onClose={() => setUrlPreview(null)} />
    </div>
  );
};

export default SharedLibraryPanel;
