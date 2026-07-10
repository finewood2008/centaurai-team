import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

const mocks = vi.hoisted(() => ({
  getFilesByDir: vi.fn(),
  teamList: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getFilesByDir: { invoke: mocks.getFilesByDir },
    },
    team: {
      list: { invoke: mocks.teamList },
    },
  },
}));

vi.mock('@/common/utils/frontendUserScope', () => ({
  getCurrentFrontendUserId: () => 'lan-user',
}));

import { fetchRecentFiles } from '@/renderer/pages/guid/components/RecentFiles';

describe('RecentFiles generated artifact enumeration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.teamList.mockResolvedValue([]);
  });

  it('collects generated files from temporary conversation workspace for Content Hub views', async () => {
    mocks.getFilesByDir.mockResolvedValueOnce([
      {
        name: 'poster.png',
        fullPath: '/srv/centaur/tmp/conv-lan/poster.png',
        relativePath: 'poster.png',
        isFile: true,
        isDir: false,
      },
      {
        name: 'uploads',
        fullPath: '/srv/centaur/tmp/conv-lan/uploads',
        relativePath: 'uploads',
        isFile: false,
        isDir: true,
        children: [
          {
            name: '决策书.docx',
            fullPath: '/srv/centaur/tmp/conv-lan/uploads/决策书.docx',
            relativePath: 'uploads/决策书.docx',
            isFile: true,
            isDir: false,
          },
        ],
      },
      {
        name: 'node_modules',
        fullPath: '/srv/centaur/tmp/conv-lan/node_modules',
        relativePath: 'node_modules',
        isFile: false,
        isDir: true,
        children: [
          {
            name: 'noise.js',
            fullPath: '/srv/centaur/tmp/conv-lan/node_modules/noise.js',
            relativePath: 'node_modules/noise.js',
            isFile: true,
            isDir: false,
          },
        ],
      },
    ]);

    const files = await fetchRecentFiles([
      {
        id: 'conv-lan',
        name: 'LAN 待整理生成物',
        type: 'aionrs',
        extra: {
          workspace: '/srv/centaur/tmp/conv-lan',
          is_temporary_workspace: true,
        },
        created_at: 1_720_000_000_000,
        modified_at: 1_720_000_100_000,
      } as TChatConversation,
    ]);

    expect(files).toEqual([
      {
        name: 'poster.png',
        path: '/srv/centaur/tmp/conv-lan/poster.png',
        size: 0,
        mtime: 1_720_000_100,
        conversation: 'LAN 待整理生成物',
        sourceConversationId: 'conv-lan',
      },
      {
        name: '决策书.docx',
        path: '/srv/centaur/tmp/conv-lan/uploads/决策书.docx',
        size: 0,
        mtime: 1_720_000_100,
        conversation: 'LAN 待整理生成物',
        sourceConversationId: 'conv-lan',
      },
    ]);
    expect(files.some((file) => file.path.includes('node_modules'))).toBe(false);
  });
});
