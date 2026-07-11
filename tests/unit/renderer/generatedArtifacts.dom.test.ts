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
  extractGeneratedArtifactPathsFromToolPayload,
  loadStandaloneGeneratedArtifactFiles,
  registerGeneratedArtifacts,
  registerGeneratedArtifactsFromToolPayload,
} from '@/renderer/utils/file/generatedArtifacts';
import { draftFilesForReview } from '@/renderer/pages/contentHub/components/manage/contentAssets';

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

  it('does not copy generated artifacts into a home directory reported as a temporary workspace', async () => {
    mocks.conversationGet.mockResolvedValueOnce({
      id: 'conv-home',
      extra: {
        workspace: '/home/user',
        custom_workspace: false,
        is_temporary_workspace: true,
      },
    });

    const files = await registerGeneratedArtifacts({
      paths: ['/tmp/agent-output/home-leak.pdf'],
      workspace: '/home/user',
      conversationId: 'conv-home',
      source: 'conversation',
    });

    expect(mocks.copyFilesToWorkspace).not.toHaveBeenCalled();
    expect(files).toEqual(['/tmp/agent-output/home-leak.pdf']);
    expect(localStorage.getItem('centaurai.generated-artifacts.v1')).toContain('/tmp/agent-output/home-leak.pdf');
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
      expect.objectContaining({
        name: 'img-1.png',
        path: '/srv/centaur/temp/toolbox/img-1.png',
        size: 1200,
        mtime: 1_720_000_000,
        conversation: '工具箱',
        draftProvenance: 'registered-generated-artifact',
        canDiscardDraft: false,
      }),
    ]);
    expect(draftFilesForReview(files, [])).toEqual(files);
  });

  it('extracts generated documents and images from mixed payloads', () => {
    expect(
      extractGeneratedArtifactPaths({
        content: '已生成 "/srv/tmp/result.pptx" 和 file:///srv/tmp/poster.png',
        nested: [{ text: '`/srv/tmp/决策书.docx`' }],
      })
    ).toEqual(['/srv/tmp/result.pptx', '/srv/tmp/poster.png', '/srv/tmp/决策书.docx']);
  });

  it('extracts unquoted generated file paths that contain spaces', () => {
    expect(
      extractGeneratedArtifactPaths(
        '图片已经保存到 /home/user/图片/截图/截图 2026-07-10 02-28-02.png，可以在工作空间查看。'
      )
    ).toEqual(['/home/user/图片/截图/截图 2026-07-10 02-28-02.png']);
  });

  it('extracts generated office artifacts from completed ACP tool updates', () => {
    expect(
      extractGeneratedArtifactPathsFromToolPayload({
        update: {
          kind: 'execute',
          status: 'completed',
          title: 'word creator',
          locations: [{ path: '/srv/tmp/conv-lan/output/计划书.docx' }],
          content: [
            { type: 'content', content: { type: 'text', text: 'Saved to /srv/tmp/conv-lan/output/deck.pptx' } },
          ],
          rawInput: { output_path: '/srv/tmp/conv-lan/output/report.pdf' },
        },
      })
    ).toEqual([
      '/srv/tmp/conv-lan/output/计划书.docx',
      '/srv/tmp/conv-lan/output/deck.pptx',
      '/srv/tmp/conv-lan/output/report.pdf',
    ]);
  });

  it('extracts relative generated artifact paths from explicit tool path fields', () => {
    expect(
      extractGeneratedArtifactPathsFromToolPayload({
        update: {
          kind: 'execute',
          status: 'completed',
          locations: [{ path: 'outputs/summary.docx' }, { file: 'exports/deck.pptx' }],
        },
      })
    ).toEqual(['outputs/summary.docx', 'exports/deck.pptx']);
  });

  it('ignores readonly ACP tool updates when collecting generated artifacts', () => {
    expect(
      extractGeneratedArtifactPathsFromToolPayload({
        update: {
          kind: 'read',
          status: 'completed',
          locations: [{ path: '/srv/tmp/conv-lan/input/客户资料.pdf' }],
        },
      })
    ).toEqual([]);
  });

  it('archives generated files reported by regular tool output into the conversation workspace', async () => {
    mocks.copyFilesToWorkspace.mockResolvedValueOnce({
      copied_files: ['/srv/centaur/tmp/conv-lan/outputs/report.pdf'],
    });

    const files = await registerGeneratedArtifactsFromToolPayload(
      {
        name: 'office_export',
        status: 'completed',
        output: 'Exported PDF: /tmp/agent-output/archive-report.pdf',
      },
      {
        workspace: '/srv/centaur/tmp/conv-lan',
        conversationId: 'conv-lan',
        source: 'conversation',
      }
    );

    expect(mocks.copyFilesToWorkspace).toHaveBeenCalledWith({
      file_paths: ['/tmp/agent-output/archive-report.pdf'],
      workspace: '/srv/centaur/tmp/conv-lan',
    });
    expect(files).toEqual(['/srv/centaur/tmp/conv-lan/outputs/report.pdf']);
  });

  it('archives generated files from assistant text when the returned path contains spaces', async () => {
    mocks.copyFilesToWorkspace.mockResolvedValueOnce({
      copied_files: ['/srv/centaur/tmp/conv-lan/截图 2026-07-10 02-28-02.png'],
    });

    const files = await registerGeneratedArtifacts({
      paths: extractGeneratedArtifactPaths('已生成 /home/user/图片/截图/截图 2026-07-10 02-28-02.png，可直接使用。'),
      workspace: '/srv/centaur/tmp/conv-lan',
      conversationId: 'conv-lan',
      source: 'conversation',
    });

    expect(mocks.copyFilesToWorkspace).toHaveBeenCalledWith({
      file_paths: ['/home/user/图片/截图/截图 2026-07-10 02-28-02.png'],
      workspace: '/srv/centaur/tmp/conv-lan',
    });
    expect(files).toEqual(['/srv/centaur/tmp/conv-lan/截图 2026-07-10 02-28-02.png']);
  });

  it('copies relative artifacts from a source workspace into the target workspace', async () => {
    mocks.copyFilesToWorkspace.mockResolvedValueOnce({
      copied_files: ['/srv/centaur/tmp/team-leader/outputs/summary.docx'],
    });

    const files = await registerGeneratedArtifacts({
      paths: ['outputs/summary.docx'],
      sourceWorkspace: '/srv/centaur/tmp/hidden-agent',
      workspace: '/srv/centaur/tmp/team-leader',
      conversationId: 'team-leader-conv',
      source: 'meeting',
    });

    expect(mocks.copyFilesToWorkspace).toHaveBeenCalledWith({
      file_paths: ['/srv/centaur/tmp/hidden-agent/outputs/summary.docx'],
      workspace: '/srv/centaur/tmp/team-leader',
    });
    expect(files).toEqual(['/srv/centaur/tmp/team-leader/outputs/summary.docx']);
  });
});
