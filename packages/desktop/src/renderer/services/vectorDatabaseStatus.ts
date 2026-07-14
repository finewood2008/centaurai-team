import { fetchWithWebuiAuth, getBaseUrl, isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';
import { LOCAL_VECTOR_DB_PROXY_BASE, normalizeVectorDbEndpoint } from '@/common/config/constants';
import { isElectronDesktop } from '@/renderer/utils/platform';

export type VectorDatabaseCapabilities = {
  text_model?: string;
  reranker?: boolean;
  visual?: boolean;
  ocr?: boolean;
  hybrid_bm25?: boolean;
};

export type VectorDatabaseStats = {
  total_documents?: number;
  total_chunks?: number;
  visual_indexed_images?: number;
  image_documents?: number;
};

export type VectorDatabaseStatus = {
  status?: string;
  capabilities?: VectorDatabaseCapabilities;
  stats: VectorDatabaseStats;
};

type RemoteVectorDatabaseStatus = {
  health?: Omit<VectorDatabaseStatus, 'stats'>;
  stats?: VectorDatabaseStats;
};

const VECTOR_STATUS_TIMEOUT_MS = 15_000;

function shouldUseDesktopProxy(): boolean {
  return isElectronDesktop() && !isRemoteClientBridgeMode();
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`向量数据库返回 HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function fetchVectorDatabaseStatus(endpoint: string): Promise<VectorDatabaseStatus> {
  const normalizedEndpoint = normalizeVectorDbEndpoint(endpoint);
  const signal = AbortSignal.timeout(VECTOR_STATUS_TIMEOUT_MS);

  if (shouldUseDesktopProxy()) {
    const health = await readJson(await fetch(`${LOCAL_VECTOR_DB_PROXY_BASE}/api/health`, { signal }));
    const stats = await readJson(await fetch(`${LOCAL_VECTOR_DB_PROXY_BASE}/api/stats`, { signal }));
    return {
      status: typeof health.status === 'string' ? health.status : undefined,
      capabilities: health.capabilities as VectorDatabaseCapabilities | undefined,
      stats: stats as VectorDatabaseStats,
    };
  }

  const response = await fetchWithWebuiAuth(
    `${getBaseUrl()}/api/vector-status?endpoint=${encodeURIComponent(normalizedEndpoint)}`,
    { signal }
  );
  const payload = (await readJson(response)) as RemoteVectorDatabaseStatus;
  return {
    status: typeof payload.health?.status === 'string' ? payload.health.status : undefined,
    capabilities: payload.health?.capabilities,
    stats: payload.stats ?? {},
  };
}
