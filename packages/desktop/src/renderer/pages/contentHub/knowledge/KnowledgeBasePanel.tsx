/**
 * KnowledgeBasePanel — the Super Knowledge Base tab: browse, upload, and
 * remove documents indexed in the local vector DB, with the same list / grid /
 * waterfall controls as the rest of the Workspace.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Button, Message, Modal } from '@arco-design/web-react';
import { Book, Copy, Delete, Open, Upload } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useFileActions } from '@/renderer/hooks/file/useFileActions';
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
import KnowledgeCard from './KnowledgeCard';
import { useKnowledgeBase } from './useKnowledgeBase';
import { useHubPreview } from '../useHubPreview';
import type { FileEntry, HubFileRecord, HubToolbarControls } from '../types';
import { deleteKnowledgeDoc, loadKnowledgeImage, uploadKnowledgeFile, type KnowledgeDoc } from './knowledgeApi';

type KnowledgeBasePanelProps = {
  controls: HubToolbarControls;
};

const KnowledgeBasePanel: React.FC<KnowledgeBasePanelProps> = ({ controls }) => {
  const { t } = useTranslation();
  const { docs, total, loading, error, reload } = useKnowledgeBase();
  const [selection, setSelection] = useState(createHubSelectionState());
  const [uploading, setUploading] = useState(false);
  const [urlPreview, setUrlPreview] = useState<HubUrlPreview | null>(null);
  const previewLocalFile = useHubPreview();
  const fileActions = useFileActions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const records = useMemo<HubFileRecord<KnowledgeDoc>[]>(
    () =>
      docs.map((doc) => ({
        id: doc.id,
        name: doc.name,
        path: doc.path,
        size: doc.size,
        modifiedAt: doc.mtime,
        kind: classifyHubFile(doc.name),
        source: 'knowledge',
        subtitle: doc.path,
        raw: doc,
      })),
    [docs]
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
  const visibleDocs = useMemo(() => visibleRecords.map((record) => record.raw), [visibleRecords]);
  const visibleIds = useMemo(() => visibleRecords.map((record) => record.id), [visibleRecords]);
  const selectedDocs = useMemo(
    () => visibleRecords.filter((record) => selection.selectedIds.has(record.id)).map((record) => record.raw),
    [visibleRecords, selection]
  );

  const openDoc = (doc: KnowledgeDoc) => {
    void fileActions
      .openFile({
        name: doc.name,
        path: doc.path,
      })
      .catch(() => Message.error(t('contentHub.toast.openFailed')));
  };

  const previewDoc = async (doc: KnowledgeDoc) => {
    if (classifyHubFile(doc.name) === 'image') {
      const dataUrl = await loadKnowledgeImage(doc.path);
      if (!dataUrl) {
        Message.error(t('contentHub.toast.openFailed'));
        return;
      }
      // Data URLs avoid iframe/img requests that cannot attach the distributed
      // client's WebUI gate token. HubUrlPreviewModal still forces SVG to inert
      // text based on the title, even though other images use <img>.
      setUrlPreview({ title: doc.name, url: dataUrl, mode: 'image' });
      return;
    }
    void previewLocalFile({
      name: doc.name,
      path: doc.path,
      size: doc.size,
      mtime: doc.mtime,
      conversation: t('contentHub.tabs.knowledge'),
    } satisfies FileEntry);
  };

  const copyPaths = async (selected: readonly KnowledgeDoc[]) => {
    try {
      await navigator.clipboard.writeText(selected.map((doc) => doc.path).join('\n'));
      Message.success(t('contentHub.toast.copied'));
    } catch {
      Message.error(t('contentHub.toast.copyFailed'));
    }
  };

  const uploadFiles = async (incoming: File[]) => {
    if (incoming.length === 0 || uploading) return;
    setUploading(true);
    try {
      for (const file of incoming) {
        await uploadKnowledgeFile(file);
      }
      Message.success(t('contentHub.knowledge.uploadDone', { count: incoming.length }));
      reload();
    } catch {
      Message.error(t('contentHub.knowledge.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const batchDelete = () => {
    if (selectedDocs.length === 0) return;
    const docsToDelete = [...selectedDocs];
    Modal.confirm({
      title: t('contentHub.batch.deleteTitle'),
      content: t('contentHub.batch.deleteConfirm', { count: docsToDelete.length }),
      okText: t('contentHub.actions.delete'),
      cancelText: t('contentHub.nas.cancel'),
      onOk: async () => {
        try {
          await Promise.all(docsToDelete.map((doc) => deleteKnowledgeDoc(doc.id)));
          setSelection(clearHubSelection());
          reload();
          Message.success(t('contentHub.batch.deleteDone', { count: docsToDelete.length }));
        } catch {
          Message.error(t('contentHub.batch.deleteFailed'));
        }
      },
    });
  };

  return (
    <div className='flex-1 flex flex-col min-h-0'>
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
      <HubToolbar
        {...controls}
        onRefresh={reload}
        refreshing={loading}
        start={
          <span className='flex items-center gap-6px text-12px text-t-secondary whitespace-nowrap'>
            <Book size='14' />
            {t('contentHub.knowledge.readonly', { n: total })}
          </span>
        }
        end={
          <Button
            type='text'
            size='mini'
            loading={uploading}
            icon={<Upload theme='outline' size={14} />}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? t('contentHub.knowledge.uploading') : t('contentHub.knowledge.upload')}
          </Button>
        }
      />
      <BatchActionBar
        count={selectedDocs.length}
        onClear={() => setSelection(clearHubSelection())}
        actions={[
          {
            key: 'copy',
            label: t('contentHub.actions.copyPath'),
            icon: <Copy theme='outline' size={14} />,
            onClick: () => void copyPaths(selectedDocs),
          },
          {
            key: 'delete',
            label: t('contentHub.actions.delete'),
            icon: <Delete theme='outline' size={14} />,
            status: 'danger',
            onClick: batchDelete,
          },
        ]}
      />
      {loading || error || visibleDocs.length === 0 ? (
        <EmptyState
          loading={loading}
          loadingMessage={t('contentHub.empty.loading')}
          message={
            error
              ? t('contentHub.knowledge.unreachable')
              : controls.search || controls.kind !== 'all'
                ? t('contentHub.empty.noMatch')
                : t('contentHub.knowledge.empty')
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
              onOpen={(record) => void previewDoc(record.raw)}
              onDirectOpen={(record) => openDoc(record.raw)}
              renderActions={(record) => (
                <>
                  <Button
                    type='text'
                    size='mini'
                    icon={<Open theme='outline' size={14} />}
                    title={t('contentHub.actions.openSource')}
                    onClick={() => openDoc(record.raw)}
                  />
                  <Button
                    type='text'
                    size='mini'
                    icon={<Copy theme='outline' size={14} />}
                    title={t('contentHub.actions.copyPath')}
                    onClick={() => void copyPaths([record.raw])}
                  />
                </>
              )}
            />
          ) : controls.view === 'waterfall' ? (
            <div style={{ columnWidth: WATERFALL_COL_WIDTH[controls.size], columnGap: 12 }}>
              {visibleDocs.map((doc) => (
                <KnowledgeCard
                  key={doc.id}
                  doc={doc}
                  view={controls.view}
                  size={controls.size}
                  onOpen={previewDoc}
                  onDirectOpen={openDoc}
                />
              ))}
            </div>
          ) : (
            <div className='flex flex-wrap gap-8px'>
              {visibleDocs.map((doc) => (
                <KnowledgeCard
                  key={doc.id}
                  doc={doc}
                  view={controls.view}
                  size={controls.size}
                  onOpen={previewDoc}
                  onDirectOpen={openDoc}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <HubUrlPreviewModal preview={urlPreview} onClose={() => setUrlPreview(null)} />
    </div>
  );
};

export default KnowledgeBasePanel;
