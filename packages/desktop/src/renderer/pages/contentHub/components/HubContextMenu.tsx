/**
 * HubContextMenu — right-click menu for content-hub file cards.
 * Fixed-positioned at the cursor, clamped to the viewport (mirrors
 * WorkspaceContextMenu). Closes on outside click / Escape via the parent.
 */
import React from 'react';
import { Button } from '@arco-design/web-react';
import {
  Copy,
  Delete,
  Download,
  FolderOpen,
  InboxOut,
  PreviewOpen,
  Save,
  Share,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ContentAsset, FileEntry } from '../types';

export type HubMenuState = { x: number; y: number; file: FileEntry; asset?: ContentAsset; draft?: boolean } | null;

type HubContextMenuProps = {
  state: HubMenuState;
  onOpen: (file: FileEntry) => void;
  onSaveToContent?: (file: FileEntry) => void;
  onCopyPath: (file: FileEntry) => void;
  onDownload: (file: FileEntry) => void;
  onReveal: (file: FileEntry) => void;
  onShare: (file: FileEntry, asset?: ContentAsset) => void;
  onArchive?: (asset: ContentAsset) => void;
  onDiscardDraft?: (file: FileEntry) => void;
  onClose: () => void;
};

const MENU_W = 200;
const MENU_H = 390;
const BTN = '!w-full !justify-start !px-14px !py-6px !h-auto !text-13px !text-t-primary !rd-6px hover:!bg-fill-2';

const HubContextMenu: React.FC<HubContextMenuProps> = ({
  state,
  onOpen,
  onSaveToContent,
  onCopyPath,
  onDownload,
  onReveal,
  onShare,
  onArchive,
  onDiscardDraft,
  onClose,
}) => {
  const { t } = useTranslation();
  if (!state) return null;
  const { asset, draft, file } = state;

  const top = typeof window !== 'undefined' ? Math.min(state.y, window.innerHeight - MENU_H) : state.y;
  const left = typeof window !== 'undefined' ? Math.min(state.x, window.innerWidth - MENU_W) : state.x;

  const runFile = (fn: (f: FileEntry) => void) => () => {
    onClose();
    fn(file);
  };
  const runAsset = (fn: (a: ContentAsset) => void) => () => {
    if (!asset) return;
    onClose();
    fn(asset);
  };

  return (
    <>
      {/* Invisible backdrop closes the menu on any outside interaction. */}
      <div
        className='fixed inset-0 z-99'
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className='fixed z-100 min-w-200px rd-12px bg-[var(--color-bg-2)] shadow-md p-6px'
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex flex-col gap-4px'>
          <Button type='text' className={BTN} icon={<PreviewOpen size='14' />} onClick={runFile(onOpen)}>
            {t('contentHub.actions.open')}
          </Button>
          {draft && onSaveToContent && (
            <Button type='text' className={BTN} icon={<Save size='14' />} onClick={runFile(onSaveToContent)}>
              {t('contentHub.actions.saveToContent')}
            </Button>
          )}
          <Button
            type='text'
            className={BTN}
            icon={<Share size='14' />}
            onClick={() => {
              onClose();
              onShare(file, asset);
            }}
          >
            {t('contentHub.actions.publishToNas')}
          </Button>
          <div className='h-1px my-2px bg-[var(--color-border-2)]' />
          <Button type='text' className={BTN} icon={<Copy size='14' />} onClick={runFile(onCopyPath)}>
            {t('contentHub.actions.copyPath')}
          </Button>
          <Button type='text' className={BTN} icon={<Download size='14' />} onClick={runFile(onDownload)}>
            {t('contentHub.actions.download')}
          </Button>
          <Button type='text' className={BTN} icon={<FolderOpen size='14' />} onClick={runFile(onReveal)}>
            {t('contentHub.actions.showInFolder')}
          </Button>
          {asset && !draft && onArchive && (
            <Button type='text' className={BTN} icon={<InboxOut size='14' />} onClick={runAsset(onArchive)}>
              {t('contentHub.actions.archive')}
            </Button>
          )}
          {draft && onDiscardDraft && (
            <Button type='text' className={BTN} icon={<Delete size='14' />} onClick={runFile(onDiscardDraft)}>
              {t('contentHub.actions.discardDraft')}
            </Button>
          )}
        </div>
      </div>
    </>
  );
};

export default HubContextMenu;
