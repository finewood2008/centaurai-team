/**
 * useHubFileActions — copy-path / download / reveal handlers shared by the hub
 * file cards' hover chips and the right-click context menu.
 */
import { useMemo } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useFileActions } from '@/renderer/hooks/file/useFileActions';
import type { FileEntry } from './types';

export function useHubFileActions() {
  const { t } = useTranslation();
  const fileActions = useFileActions();

  return useMemo(
    () => ({
      canReveal: fileActions.canReveal,
      copyPath: async (file: FileEntry) => {
        try {
          await navigator.clipboard.writeText(file.path);
          Message.success(t('contentHub.toast.copied'));
        } catch {
          Message.error(t('contentHub.toast.copyFailed'));
        }
      },
      download: async (file: FileEntry) => {
        try {
          await fileActions.downloadFile(file);
        } catch {
          Message.error(t('contentHub.toast.downloadFailed'));
        }
      },
      reveal: async (file: FileEntry) => {
        try {
          await fileActions.revealFile(file);
        } catch {
          Message.error(t('contentHub.toast.openFailed'));
        }
      },
      openFile: async (file: FileEntry) => {
        try {
          await fileActions.openFile(file);
        } catch {
          Message.error(t('contentHub.toast.openFailed'));
        }
      },
    }),
    [fileActions, t]
  );
}
