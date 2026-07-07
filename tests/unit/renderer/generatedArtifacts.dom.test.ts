import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationGet: vi.fn(),
  copyFilesToWorkspace: vi.fn(),
  getFileMetadata: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: mocks.conversationGet },
    },
    fs: {
      copyFilesToWorkspace: { invoke: mocks.copyFilesToWorkspace },
      getFileMetadata: { invoke: mocks.getFileMetadata },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: mocks.emit,
  },
}));

import {
  extractGeneratedArtifactPaths,
  loadStandaloneGeneratedArtifactFiles,
  registerGeneratedArtifacts,
} from '@/renderer/utils/file/generatedArtifacts';

describe('generatedArtifacts LAN/temp-space registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('resolves a conversation workspace from conversationId when LAN events omit workspace', async () => {
    mocks.conversationGet.mockResolvedValueOnce({
      id: 'conv-lan',
      extra: { workspace: '/srv/centaur/tmp/conv-lan' },
    });

    const files = await registerGeneratedArtifacts({
      paths: ['reports/方案.docx'],
      conversationId: 'conv-lan',
      source: 'conversation',
    });

    expect(files).toEqual(['/srv/centaur/tmp/conv-lan/reports/方案.docx']);
    expect(mocks.copyFilesToWorkspace).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith('generated-files.changed');
  });

  it('copies external server-side artifacts into the temporary workspace instead of storing only local manifest data', async () => {
    mocks.copyFilesToWorkspace.mockResolvedValueOnce({
      copied_files: ['/srv/centaur/tmp/conv-lan/outputs/report.pdf'],
    });

    const files = await registerGeneratedArtifacts({
      paths: ['/tmp/agent-output/report.pdf'],
      workspace: '/srv/centaur/tmp/conv-lan',
      conversationId: 'conv-lan',
      source: 'conversation',
    });

    expect(mocks.copyFilesToWorkspace).toHaveBeenCalledWith({
      file_paths: ['/tmp/agent-output/report.pdf'],
      workspace: '/srv/centaur/tmp/conv-lan',
    });
    expect(files).toEqual(['/srv/centaur/tmp/conv-lan/outputs/report.pdf']);
    expect(localStorage.getItem('centaurai.generated-artifacts.v1')).toBeNull();
  });

  it('keeps standalone generated artifacts visible to Content Hub when there is no conversation workspace', async () => {
    await registerGeneratedArtifacts({
      paths: ['/srv/centaur/temp/toolbox/img-1.png'],
      source: 'toolbox',
      standaloneLabel: '工具箱',
    });
    mocks.getFileMetadata.mockResolvedValueOnce({
      name: 'img-1.png',
      path: '/srv/centaur/temp/toolbox/img-1.png',
      size: 1200,
      lastModified: 1_720_000_000_000,
      isDirectory: false,
    });

    const files = await loadStandaloneGeneratedArtifactFiles();

    expect(files).toEqual([
      {
        name: 'img-1.png',
        path: '/srv/centaur/temp/toolbox/img-1.png',
        size: 1200,
        mtime: 1_720_000_000,
        conversation: '工具箱',
      },
    ]);
  });

  it('extracts generated documents and images from mixed payloads', () => {
    expect(
      extractGeneratedArtifactPaths({
        content: '已生成 "/srv/tmp/result.pptx" 和 file:///srv/tmp/poster.png',
        nested: [{ text: '`/srv/tmp/决策书.docx`' }],
      })
    ).toEqual(['/srv/tmp/result.pptx', '/srv/tmp/poster.png', '/srv/tmp/决策书.docx']);
  });
});
