import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isDesktop: vi.fn(() => false),
  openPreview: vi.fn(),
  downloadFileFromPath: vi.fn(),
  shellOpenFile: vi.fn(),
  shellShowItemInFolder: vi.fn(),
  readFile: vi.fn(),
  getImageBase64: vi.fn(),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: mocks.isDesktop,
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ openPreview: mocks.openPreview }),
}));

vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromPath: mocks.downloadFileFromPath,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: {
      openFile: { invoke: mocks.shellOpenFile },
      showItemInFolder: { invoke: mocks.shellShowItemInFolder },
    },
    fs: {
      readFile: { invoke: mocks.readFile },
      getImageBase64: { invoke: mocks.getImageBase64 },
    },
  },
}));

import { useFileActions } from '@/renderer/hooks/file/useFileActions';

describe('useFileActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDesktop.mockReturnValue(false);
  });

  it('opens Office files through preview in WebUI/LAN mode', async () => {
    const { result } = renderHook(() => useFileActions());

    await act(async () => {
      await result.current.openFile({ path: '/srv/work/report.xlsx', name: 'report.xlsx', workspace: '/srv/work' });
    });

    expect(mocks.shellOpenFile).not.toHaveBeenCalled();
    expect(mocks.downloadFileFromPath).not.toHaveBeenCalled();
    expect(mocks.openPreview).toHaveBeenCalledWith(
      '',
      'excel',
      {
        title: 'report.xlsx',
        file_name: 'report.xlsx',
        file_path: '/srv/work/report.xlsx',
        workspace: '/srv/work',
        language: 'xlsx',
        truncated: false,
        editable: undefined,
      },
      { replace: true }
    );
  });

  it('downloads non-Office files when opened in WebUI/LAN mode', async () => {
    const { result } = renderHook(() => useFileActions());

    await act(async () => {
      await result.current.openFile({ path: '/srv/work/archive.zip', name: 'archive.zip' });
    });

    expect(mocks.openPreview).not.toHaveBeenCalled();
    expect(mocks.shellOpenFile).not.toHaveBeenCalled();
    expect(mocks.downloadFileFromPath).toHaveBeenCalledWith('/srv/work/archive.zip', 'archive.zip', undefined);
  });

  it('uses the system file handler in desktop mode', async () => {
    mocks.isDesktop.mockReturnValue(true);
    const { result } = renderHook(() => useFileActions());

    await act(async () => {
      await result.current.openFile({ path: '/srv/work/report.xlsx', name: 'report.xlsx' });
    });

    expect(mocks.openPreview).not.toHaveBeenCalled();
    expect(mocks.downloadFileFromPath).not.toHaveBeenCalled();
    expect(mocks.shellOpenFile).toHaveBeenCalledWith('/srv/work/report.xlsx');
  });
});
