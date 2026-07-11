import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithWebuiAuth: vi.fn(),
  isRemoteClient: vi.fn(() => true),
  isDesktop: vi.fn(() => true),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    webui: { getStatus: { invoke: vi.fn() } },
    fs: { getImageBase64: { invoke: vi.fn() } },
  },
}));

vi.mock('@/common/config/configService', () => ({
  configService: { get: () => 'http://127.0.0.1:8619' },
}));

vi.mock('@/common/config/constants', () => ({
  LOCAL_VECTOR_DB_PROXY_BASE: 'centaur-vector://local',
  normalizeVectorDbEndpoint: () => 'http://127.0.0.1:8619',
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  fetchWithWebuiAuth: mocks.fetchWithWebuiAuth,
  getBaseUrl: () => 'http://192.168.1.25:25808',
  isRemoteClientBridgeMode: mocks.isRemoteClient,
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: mocks.isDesktop,
}));

vi.mock('@/renderer/pages/contentHub/components/view/imageThumb', () => ({
  blobToDataUrl: vi.fn(),
}));

import { fetchKnowledgeDocs, searchKnowledge } from '@/renderer/pages/contentHub/knowledge/knowledgeApi';

describe('knowledgeApi distributed client transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDesktop.mockReturnValue(true);
    mocks.isRemoteClient.mockReturnValue(true);
  });

  it('never treats distributed Electron as a co-located vector DB client', async () => {
    mocks.fetchWithWebuiAuth.mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const directFetch = vi.spyOn(globalThis, 'fetch');

    await fetchKnowledgeDocs(9_999, -5);

    expect(directFetch).not.toHaveBeenCalled();
    expect(mocks.fetchWithWebuiAuth.mock.calls[0][0]).toBe('http://192.168.1.25:25808/api/vector-documents');
    const payload = JSON.parse(String(mocks.fetchWithWebuiAuth.mock.calls[0][1]?.body));
    expect(payload).toMatchObject({ endpoint: 'http://127.0.0.1:8619', limit: 300, offset: 0 });
  });

  it('clamps remote knowledge searches before sending them through WebHost', async () => {
    mocks.fetchWithWebuiAuth.mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await searchKnowledge('q'.repeat(5_000), 500, 'hybrid');

    const payload = JSON.parse(String(mocks.fetchWithWebuiAuth.mock.calls[0][1]?.body));
    expect(payload.query).toHaveLength(4_000);
    expect(payload.n_results).toBe(20);
  });

  it('uses the isolated Electron protocol for a co-located desktop', async () => {
    mocks.isRemoteClient.mockReturnValue(false);
    const directFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await fetchKnowledgeDocs();

    expect(directFetch.mock.calls[0][0]).toBe('centaur-vector://local/api/documents?limit=300&offset=0');
    expect(mocks.fetchWithWebuiAuth).not.toHaveBeenCalled();
  });
});
