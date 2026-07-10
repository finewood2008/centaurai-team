import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers: Record<string, ((event: unknown) => void) | undefined> = {};
  const makeOn = (key: string) =>
    vi.fn((handler: (event: unknown) => void) => {
      handlers[key] = handler;
      return vi.fn();
    });

  return {
    handlers,
    responseStreamOn: makeOn('responseStream'),
    turnCompletedOn: makeOn('turnCompleted'),
    fileStreamOn: makeOn('fileStream'),
    officeFileAddedOn: makeOn('officeFileAdded'),
    responseSearchWorkSpaceProvider: vi.fn(() => vi.fn()),
    emitterOn: vi.fn(),
    emitterOff: vi.fn(),
    emitterEmit: vi.fn(),
    useAddEventListener: vi.fn(),
    registerGeneratedArtifacts: vi.fn(),
    registerGeneratedArtifactsFromPayload: vi.fn(),
    registerGeneratedArtifactsFromToolPayload: vi.fn(),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      responseStream: { on: mocks.responseStreamOn },
    },
    conversation: {
      turnCompleted: { on: mocks.turnCompletedOn },
      responseSearchWorkSpace: { provider: mocks.responseSearchWorkSpaceProvider },
    },
    fileStream: {
      contentUpdate: { on: mocks.fileStreamOn },
    },
    workspaceOfficeWatch: {
      fileAdded: { on: mocks.officeFileAddedOn },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    on: mocks.emitterOn,
    off: mocks.emitterOff,
    emit: mocks.emitterEmit,
  },
  useAddEventListener: mocks.useAddEventListener,
}));

vi.mock('@/renderer/utils/file/generatedArtifacts', () => ({
  registerGeneratedArtifacts: mocks.registerGeneratedArtifacts,
  registerGeneratedArtifactsFromPayload: mocks.registerGeneratedArtifactsFromPayload,
  registerGeneratedArtifactsFromToolPayload: mocks.registerGeneratedArtifactsFromToolPayload,
}));

import { useGeneratedFilesAutoRefresh } from '@/renderer/hooks/workspace/useGeneratedFilesAutoRefresh';
import { useWorkspaceEvents } from '@/renderer/pages/conversation/Workspace/hooks/useWorkspaceEvents';

describe('generated file auto-refresh hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.handlers).forEach((key) => {
      mocks.handlers[key] = undefined;
    });
  });

  it('registers direct file stream writes so generated files appear in global file views', () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useGeneratedFilesAutoRefresh(onChange));

    act(() => {
      mocks.handlers.fileStream?.({
        file_path: '/srv/centaur/tmp/conv-1/report.docx',
        workspace: '/srv/centaur/tmp/conv-1',
        operation: 'write',
      });
    });

    expect(mocks.registerGeneratedArtifacts).toHaveBeenCalledWith({
      paths: ['/srv/centaur/tmp/conv-1/report.docx'],
      workspace: '/srv/centaur/tmp/conv-1',
      source: 'conversation',
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('registers workspace watcher file additions so office deliverables appear in global file views', () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useGeneratedFilesAutoRefresh(onChange));

    act(() => {
      mocks.handlers.officeFileAdded?.({
        file_path: '/srv/centaur/tmp/conv-1/方案书.pptx',
        workspace: '/srv/centaur/tmp/conv-1',
      });
    });

    expect(mocks.registerGeneratedArtifacts).toHaveBeenCalledWith({
      paths: ['/srv/centaur/tmp/conv-1/方案书.pptx'],
      workspace: '/srv/centaur/tmp/conv-1',
      source: 'conversation',
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('registers direct writes for the active conversation workspace panel', () => {
    const refreshWorkspace = vi.fn();
    const { unmount } = renderHook(() =>
      useWorkspaceEvents({
        conversation_id: 'conv-1',
        workspace: '/srv/centaur/tmp/conv-1',
        eventPrefix: 'aionrs',
        refreshWorkspace,
        clearSelection: vi.fn(),
        setFiles: vi.fn(),
        setSelected: vi.fn(),
        setExpandedKeys: vi.fn(),
        setTreeKey: vi.fn(),
        selectedNodeRef: { current: null },
        selectedKeysRef: { current: [] },
        closeContextMenu: vi.fn(),
        setContextMenu: vi.fn(),
        closeRenameModal: vi.fn(),
        closeDeleteModal: vi.fn(),
      })
    );
    refreshWorkspace.mockClear();

    act(() => {
      mocks.handlers.fileStream?.({
        file_path: '/srv/centaur/tmp/conv-1/report.docx',
        workspace: '/srv/centaur/tmp/conv-1/',
        operation: 'write',
      });
    });

    expect(mocks.registerGeneratedArtifacts).toHaveBeenCalledWith({
      paths: ['/srv/centaur/tmp/conv-1/report.docx'],
      workspace: '/srv/centaur/tmp/conv-1',
      conversationId: 'conv-1',
      source: 'conversation',
    });
    expect(refreshWorkspace).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('ignores direct write events for other workspaces in the active workspace panel', () => {
    const refreshWorkspace = vi.fn();
    const { unmount } = renderHook(() =>
      useWorkspaceEvents({
        conversation_id: 'conv-1',
        workspace: '/srv/centaur/tmp/conv-1',
        eventPrefix: 'aionrs',
        refreshWorkspace,
        clearSelection: vi.fn(),
        setFiles: vi.fn(),
        setSelected: vi.fn(),
        setExpandedKeys: vi.fn(),
        setTreeKey: vi.fn(),
        selectedNodeRef: { current: null },
        selectedKeysRef: { current: [] },
        closeContextMenu: vi.fn(),
        setContextMenu: vi.fn(),
        closeRenameModal: vi.fn(),
        closeDeleteModal: vi.fn(),
      })
    );
    refreshWorkspace.mockClear();
    mocks.registerGeneratedArtifacts.mockClear();

    act(() => {
      mocks.handlers.fileStream?.({
        file_path: '/srv/centaur/tmp/conv-2/report.docx',
        workspace: '/srv/centaur/tmp/conv-2',
        operation: 'write',
      });
    });

    expect(mocks.registerGeneratedArtifacts).not.toHaveBeenCalled();
    expect(refreshWorkspace).not.toHaveBeenCalled();

    unmount();
  });
});
