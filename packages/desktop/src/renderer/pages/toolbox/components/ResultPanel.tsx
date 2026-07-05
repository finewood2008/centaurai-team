/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Image, Message, Progress, Spin } from '@arco-design/web-react';
import { CloseSmall, DownloadOne, FilePpt, FolderOpen, PreviewOpen, Refresh, Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { downloadFileFromPath, downloadTextContent } from '@/renderer/utils/file/download';
import type { ToolImageResult, ToolRunLogEvent, ToolRunProgress, ToolRunResult } from '../types';

type ResultStatus = 'idle' | 'running' | 'done' | 'error';

type ResultPanelProps = {
  status: ResultStatus;
  result: ToolRunResult | null;
  progress?: ToolRunProgress | null;
  events?: ToolRunLogEvent[];
  error: string | null;
  onOpenConversation: (conversationId: string) => void;
  onRegenerate: () => void;
  onCancel?: () => void;
};

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || 'image.png';
}

const POWERPOINT_RESULT_RE = /\.(pptx?|potx)$/i;

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function resolveResultFilePath(path: string, workspace?: string): string {
  if (!workspace || isAbsolutePath(path)) return path;
  return `${workspace.replace(/[\\/]+$/, '')}/${path.replace(/^\.?[\\/]+/, '')}`;
}

function eventColor(kind: ToolRunLogEvent['kind']): string {
  switch (kind) {
    case 'success':
      return 'rgb(var(--success-6))';
    case 'warning':
      return 'rgb(var(--warning-6))';
    case 'error':
      return 'rgb(var(--danger-6))';
    case 'agent':
      return 'rgb(var(--primary-6))';
    case 'tool':
      return 'var(--centaur-clay-deep)';
    case 'file':
      return 'var(--centaur-gold-deep)';
    case 'info':
    default:
      return 'var(--centaur-ink-mute)';
  }
}

const ImageCard: React.FC<{ image: ToolImageResult }> = ({ image }) => {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col overflow-hidden rounded-8px b-1 b-solid b-line-2 bg-1'>
      {/* Arco Image gives click-to-zoom preview out of the box. */}
      <Image
        src={image.dataUrl}
        alt={fileName(image.path)}
        width='100%'
        height={320}
        className='bg-2 cursor-zoom-in'
        style={{ objectFit: 'contain' }}
      />
      <div className='flex min-w-0 items-center justify-between gap-8px border-0 border-t b-solid b-line-2 px-10px py-8px'>
        <span className='min-w-0 truncate text-12px text-t-tertiary'>{fileName(image.path)}</span>
        <Button
          size='mini'
          type='text'
          icon={<DownloadOne />}
          onClick={() => void downloadFileFromPath(image.path, fileName(image.path))}
        >
          {t('toolbox.download')}
        </Button>
      </div>
    </div>
  );
};

/** Renders the run state: loading, generated images / text, or an error. */
export const ResultPanel: React.FC<ResultPanelProps> = ({
  status,
  result,
  progress,
  events = [],
  error,
  onOpenConversation,
  onRegenerate,
  onCancel,
}) => {
  const { t } = useTranslation();

  const renderEvents = () => {
    if (status === 'idle' && events.length === 0) return null;
    const visibleEvents = events.slice(-12);
    return (
      <div className='rounded-12px border border-solid border-[var(--centaur-line)] bg-[var(--centaur-card)] p-12px'>
        <div className='flex items-center justify-between gap-10px'>
          <span className='text-13px font-700 text-t-primary'>{t('toolbox.runEvents.logTitle')}</span>
          <span className='text-11px text-t-tertiary'>{events.length}</span>
        </div>
        <div className='mt-10px flex max-h-240px flex-col gap-8px overflow-y-auto pr-2px'>
          {visibleEvents.length === 0 ? (
            <div className='rounded-8px bg-[var(--centaur-bg-warm)] px-10px py-9px text-12px text-t-tertiary'>
              {t('toolbox.runEvents.emptyLog')}
            </div>
          ) : (
            visibleEvents.map((event) => (
              <div key={event.id} className='flex gap-8px rounded-8px bg-[var(--centaur-bg-warm)] px-10px py-8px'>
                <span
                  className='mt-6px h-7px w-7px shrink-0 rounded-full'
                  style={{ backgroundColor: eventColor(event.kind) }}
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex min-w-0 items-center justify-between gap-8px'>
                    <span className='min-w-0 truncate text-12px font-700 text-t-primary'>{event.title}</span>
                    <span className='shrink-0 text-10px text-t-tertiary'>
                      {new Date(event.at).toLocaleTimeString()}
                    </span>
                  </div>
                  {event.detail && (
                    <div className='mt-3px line-clamp-2 break-all text-11px leading-16px text-t-secondary'>
                      {event.detail}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (status === 'running') {
      const percent = Math.max(0, Math.min(progress?.percent ?? 8, 100));
      return (
        <div className='flex min-h-360px flex-col items-center justify-center gap-14px rounded-12px bg-[var(--centaur-bg-warm)] px-28px'>
          <div className='flex h-48px w-48px items-center justify-center rounded-8px bg-1 text-primary-6'>
            <Spin dot />
          </div>
          <div className='flex w-full max-w-520px flex-col gap-8px'>
            <div className='flex items-center justify-between gap-10px text-13px font-500 text-t-secondary'>
              <span>{progress?.label || t('toolbox.generating')}</span>
              {progress?.step && progress.total && (
                <span className='shrink-0 text-12px text-t-tertiary'>
                  {progress.step} / {progress.total}
                </span>
              )}
            </div>
            <Progress percent={percent} showText={false} />
            <div className='flex items-center justify-between gap-10px text-12px text-t-tertiary'>
              {onCancel ? (
                <Button size='mini' status='danger' type='outline' icon={<CloseSmall />} onClick={onCancel}>
                  {t('toolbox.cancelRun')}
                </Button>
              ) : (
                <span />
              )}
              <span>{percent}%</span>
            </div>
          </div>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className='flex min-h-360px flex-col items-center justify-center gap-12px rounded-12px bg-[var(--centaur-bg-warm)] px-20px text-center'>
          <span className='text-13px text-rgb-danger'>{t('toolbox.runFailed')}</span>
          {error && <span className='text-12px text-t-tertiary break-all'>{error}</span>}
          <Button icon={<Refresh />} onClick={onRegenerate}>
            {t('toolbox.retry')}
          </Button>
        </div>
      );
    }

    if (status === 'done' && result) {
      const hasImages = result.images.length > 0;
      const savedFiles = result.files ?? [];
      const savedFile = savedFiles[0];
      const pptFiles = savedFiles.filter((path) => POWERPOINT_RESULT_RE.test(path));
      const handleOpenFile = async (path: string) => {
        try {
          await ipcBridge.shell.openFile.invoke(resolveResultFilePath(path, result.workspace));
        } catch (openError) {
          console.warn('[Toolbox] open generated file failed', openError);
          Message.error(t('toolbox.openFileFailed'));
        }
      };
      const handleRevealFile = async (path: string) => {
        try {
          await ipcBridge.shell.showItemInFolder.invoke(resolveResultFilePath(path, result.workspace));
        } catch (revealError) {
          console.warn('[Toolbox] reveal generated file failed', revealError);
          Message.error(t('toolbox.revealFileFailed'));
        }
      };
      const handleDownloadText = () => {
        if (savedFile) {
          void downloadFileFromPath(savedFile, fileName(savedFile), result.workspace);
          return;
        }
        downloadTextContent(result.text || '', 'AI工作台产物.md', 'text/markdown;charset=utf-8');
      };
      return (
        <div className='flex flex-col gap-12px'>
          <div className='flex flex-wrap justify-end gap-8px'>
            <Button size='small' icon={<Refresh />} onClick={onRegenerate}>
              {t('toolbox.regenerate')}
            </Button>
            {!hasImages && (
              <Button size='small' type='outline' icon={<DownloadOne />} onClick={handleDownloadText}>
                {t('toolbox.download')}
              </Button>
            )}
            {result.conversation_id && !result.hiddenConversation && (
              <Button
                size='small'
                type='outline'
                icon={<Right />}
                onClick={() => onOpenConversation(result.conversation_id)}
              >
                {t('toolbox.openInConversation')}
              </Button>
            )}
          </div>
          {hasImages ? (
            <Image.PreviewGroup infinite={false}>
              <div
                className={
                  result.images.length === 1 ? 'grid grid-cols-1 gap-12px' : 'grid grid-cols-1 sm:grid-cols-2 gap-12px'
                }
              >
                {result.images.map((image) => (
                  <ImageCard key={image.path} image={image} />
                ))}
              </div>
            </Image.PreviewGroup>
          ) : (
            <>
              {pptFiles.length > 0 && (
                <div
                  className='flex flex-col gap-8px rounded-10px px-12px py-10px'
                  style={{ background: 'rgb(var(--success-1))', border: '1px solid rgb(var(--success-3))' }}
                >
                  <div className='flex min-w-0 items-center gap-9px'>
                    <div
                      className='flex h-34px w-34px shrink-0 items-center justify-center rounded-8px'
                      style={{ background: 'var(--centaur-card)', color: 'rgb(var(--success-6))' }}
                    >
                      <FilePpt size={18} />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <div className='text-13px font-800' style={{ color: 'rgb(var(--success-6))' }}>
                        {t('toolbox.powerpointReady')}
                      </div>
                      <div className='mt-2px truncate text-12px text-t-secondary' title={pptFiles[0]}>
                        {fileName(pptFiles[0])}
                      </div>
                    </div>
                  </div>
                  <div className='flex flex-wrap gap-8px'>
                    <Button
                      size='small'
                      type='primary'
                      icon={<PreviewOpen />}
                      onClick={() => void handleOpenFile(pptFiles[0])}
                    >
                      {t('toolbox.openFile')}
                    </Button>
                    <Button
                      size='small'
                      type='outline'
                      icon={<FolderOpen />}
                      onClick={() => void handleRevealFile(pptFiles[0])}
                    >
                      {t('toolbox.revealFile')}
                    </Button>
                    <Button
                      size='small'
                      type='outline'
                      icon={<DownloadOne />}
                      onClick={() => void downloadFileFromPath(pptFiles[0], fileName(pptFiles[0]), result.workspace)}
                    >
                      {t('toolbox.download')}
                    </Button>
                  </div>
                </div>
              )}
              {savedFile && (
                <div className='flex flex-col gap-8px rounded-10px border border-solid border-[var(--centaur-line)] bg-[var(--centaur-card)] px-12px py-9px'>
                  <div className='text-12px leading-18px text-t-secondary'>
                    {t('toolbox.savedToContentHub', { fileName: fileName(savedFile) })}
                  </div>
                  <div className='flex items-center justify-between gap-10px text-12px font-700 text-t-primary'>
                    <span>{t('toolbox.generatedFiles')}</span>
                    <span className='text-11px font-400 text-t-tertiary'>{savedFiles.length}</span>
                  </div>
                  <div className='flex flex-col gap-6px'>
                    {savedFiles.map((path) => (
                      <div
                        key={path}
                        className='flex min-w-0 flex-col gap-8px rounded-8px bg-[var(--centaur-bg-warm)] px-9px py-7px sm:flex-row sm:items-center sm:justify-between'
                      >
                        <div className='flex min-w-0 items-center gap-7px'>
                          {POWERPOINT_RESULT_RE.test(path) ? (
                            <FilePpt className='shrink-0 text-primary-6' size={15} />
                          ) : (
                            <PreviewOpen className='shrink-0 text-t-tertiary' size={15} />
                          )}
                          <span className='min-w-0 truncate text-12px text-t-secondary' title={path}>
                            {fileName(path)}
                          </span>
                        </div>
                        <div className='flex shrink-0 flex-wrap items-center gap-4px'>
                          <Button
                            size='mini'
                            type='text'
                            icon={<PreviewOpen />}
                            onClick={() => void handleOpenFile(path)}
                          >
                            {t('toolbox.openFile')}
                          </Button>
                          <Button
                            size='mini'
                            type='text'
                            icon={<FolderOpen />}
                            onClick={() => void handleRevealFile(path)}
                          >
                            {t('toolbox.revealFile')}
                          </Button>
                          <Button
                            size='mini'
                            type='text'
                            icon={<DownloadOne />}
                            onClick={() => void downloadFileFromPath(path, fileName(path), result.workspace)}
                          >
                            {t('toolbox.download')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className='min-h-260px whitespace-pre-wrap rounded-12px bg-[var(--centaur-bg-warm)] p-14px text-13px leading-20px text-t-primary'>
                {result.text || t('toolbox.noOutput')}
              </div>
            </>
          )}
        </div>
      );
    }

    return (
      <div className='flex min-h-360px items-center justify-center rounded-12px bg-[var(--centaur-bg-warm)]'>
        <Empty description={t('toolbox.resultHint')} />
      </div>
    );
  };

  return (
    <div className='centaur-card min-h-420px w-full' style={{ borderRadius: 'var(--centaur-radius-sm)' }}>
      <div
        className='flex items-center gap-10px px-16px py-14px'
        style={{ borderBottom: '1px solid var(--centaur-line)' }}
      >
        <div
          className='flex h-30px w-30px items-center justify-center rounded-10px'
          style={{ background: 'var(--centaur-gold-tint)', color: 'var(--centaur-gold-deep)' }}
        >
          <PreviewOpen size={16} />
        </div>
        <span className='text-14px font-600' style={{ color: 'var(--centaur-ink)' }}>
          {t('toolbox.resultTitle')}
        </span>
      </div>
      <div className='flex flex-col gap-12px p-16px'>
        {renderEvents()}
        {renderContent()}
      </div>
    </div>
  );
};

export default ResultPanel;
