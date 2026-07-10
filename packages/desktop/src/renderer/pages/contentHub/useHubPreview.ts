import { useCallback } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useFileActions } from '@/renderer/hooks/file/useFileActions';
import { classifyPreviewError, previewErrorToI18nKey } from '@/renderer/utils/previewError';
import type { FileEntry } from './types';

export function useHubPreview() {
  const { t } = useTranslation();
  const fileActions = useFileActions();

  return useCallback(
    async (file: FileEntry) => {
      try {
        await fileActions.previewFile(file);
      } catch (error) {
        const kind = classifyPreviewError(error);
        Message.error(t(previewErrorToI18nKey(kind)));
      }
    },
    [fileActions, t]
  );
}
