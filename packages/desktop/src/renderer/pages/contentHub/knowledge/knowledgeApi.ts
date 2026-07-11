/**
 * knowledgeApi — access to the local vector DB behind the Super Knowledge Base.
 *
 * Desktop runs co-located with the vector DB and reaches it directly. A WebUI
 * browser client cannot (the DB binds loopback on the server host), so it goes
 * through the WebUI server's proxy routes, which forward to the configured
 * endpoint. Mirrors the search recipe in pages/guid/hooks/useGuidSend.ts.
 */
import { ipcBridge } from '@/common';
import { LOCAL_VECTOR_DB_PROXY_BASE, normalizeVectorDbEndpoint } from '@/common/config/constants';
import { configService } from '@/common/config/configService';
import { fetchWithWebuiAuth, getBaseUrl, isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { blobToDataUrl } from '../components/view/imageThumb';

const VECTOR_REQUEST_TIMEOUT_MS = 15_000;
const VECTOR_UPLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_SEARCH_RESULTS = 20;

const shouldUseDirectVectorDb = (): boolean => isElectronDesktop() && !isRemoteClientBridgeMode();

async function requestVector(
  url: string,
  init: RequestInit = {},
  throughWebHost = false,
  timeoutMs = VECTOR_REQUEST_TIMEOUT_MS
): Promise<Response> {
  // AbortSignal.timeout stays attached while callers consume json/blob bodies;
  // clearing a manual timer as soon as headers arrive would leave a slow body
  // able to hang the renderer indefinitely.
  const requestInit = { ...init, signal: AbortSignal.timeout(timeoutMs) };
  return throughWebHost ? await fetchWithWebuiAuth(url, requestInit) : await fetch(url, requestInit);
}

export type KnowledgeDoc = {
  id: string;
  name: string;
  path: string;
  fileType: string;
  size: number;
  mtime: number;
  chunkCount: number;
};

export type KnowledgeSearchResult = {
  id: string;
  sourcePath: string;
  fileName: string;
  fileType: string;
  text: string;
  score: number;
};

export function vectorEndpoint(): string {
  return normalizeVectorDbEndpoint(configService.get('vectorDB.endpoint'));
}

type RawDoc = { id: string; chunk_count?: number; metadata?: Record<string, unknown> };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function normalize(raw: RawDoc): KnowledgeDoc {
  const m = raw.metadata ?? {};
  return {
    id: raw.id,
    name: String(m.file_name ?? raw.id.split(/[\\/]/).pop() ?? raw.id),
    path: String(m.source_path ?? m.file_path ?? raw.id),
    fileType: String(m.file_type ?? ''),
    size: num(m.file_size),
    mtime: Math.floor(num(m.modified_time)),
    chunkCount: num(raw.chunk_count ?? m.chunk_count),
  };
}

export async function fetchKnowledgeDocs(limit = 300, offset = 0): Promise<{ total: number; docs: KnowledgeDoc[] }> {
  const endpoint = vectorEndpoint();
  const safeLimit = Math.max(1, Math.min(300, Math.trunc(Number(limit) || 300)));
  const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const direct = shouldUseDirectVectorDb();
  const resp = direct
    ? await requestVector(`${LOCAL_VECTOR_DB_PROXY_BASE}/api/documents?limit=${safeLimit}&offset=${safeOffset}`)
    : await requestVector(
        `${getBaseUrl()}/api/vector-documents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, limit: safeLimit, offset: safeOffset }),
        },
        true
      );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const items: RawDoc[] = Array.isArray(data.items) ? data.items : [];
  return { total: num(data.total) || items.length, docs: items.map(normalize) };
}

export async function uploadKnowledgeFile(file: File): Promise<void> {
  const endpoint = vectorEndpoint();
  const form = new FormData();
  form.append('file', file, file.name);
  const direct = shouldUseDirectVectorDb();
  const resp = await requestVector(
    direct
      ? `${LOCAL_VECTOR_DB_PROXY_BASE}/api/upload`
      : `${getBaseUrl()}/api/vector-upload?endpoint=${encodeURIComponent(endpoint)}`,
    {
      method: 'POST',
      body: form,
    },
    !direct,
    VECTOR_UPLOAD_TIMEOUT_MS
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export async function deleteKnowledgeDoc(docId: string): Promise<void> {
  const endpoint = vectorEndpoint();
  const direct = shouldUseDirectVectorDb();
  const resp = direct
    ? await requestVector(`${LOCAL_VECTOR_DB_PROXY_BASE}/api/documents/${encodeURIComponent(docId)}`, {
        method: 'DELETE',
      })
    : await requestVector(
        `${getBaseUrl()}/api/vector-documents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, docId, action: 'delete' }),
        },
        true
      );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

type RawSearchHit = {
  id?: string;
  source_path?: string;
  text?: string;
  score?: number;
  rerank_score?: number;
  vector_score?: number;
  metadata?: Record<string, unknown>;
};

function normalizeSearchHit(raw: RawSearchHit): KnowledgeSearchResult {
  const metadata = raw.metadata ?? {};
  const sourcePath = String(raw.source_path ?? metadata.source_path ?? metadata.file_path ?? raw.id ?? '');
  return {
    id: String(raw.id ?? sourcePath),
    sourcePath,
    fileName: String(metadata.file_name ?? sourcePath.split(/[\\/]/).pop() ?? raw.id ?? 'knowledge'),
    fileType: String(metadata.file_type ?? ''),
    text: String(raw.text ?? ''),
    score: num(raw.score ?? raw.rerank_score ?? raw.vector_score),
  };
}

export async function searchKnowledge(
  query: string,
  nResults = 8,
  mode: 'text' | 'visual' | 'hybrid' = 'text'
): Promise<KnowledgeSearchResult[]> {
  const endpoint = vectorEndpoint();
  const safeResultCount = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.trunc(Number(nResults) || 8)));
  const body = { query: String(query).slice(0, 4_000), n_results: safeResultCount, mode };
  const direct = shouldUseDirectVectorDb();
  const resp = direct
    ? await requestVector(`${LOCAL_VECTOR_DB_PROXY_BASE}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    : await requestVector(
        `${getBaseUrl()}/api/vector-search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, ...body }),
        },
        true
      );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const results: RawSearchHit[] = Array.isArray(data.results) ? data.results : [];
  return results.map(normalizeSearchHit);
}

export function knowledgeImageUrl(path: string): string {
  const endpoint = vectorEndpoint();
  return shouldUseDirectVectorDb()
    ? `${LOCAL_VECTOR_DB_PROXY_BASE}/api/image?path=${encodeURIComponent(path)}`
    : `${getBaseUrl()}/api/vector-image?endpoint=${encodeURIComponent(endpoint)}&path=${encodeURIComponent(path)}`;
}

/**
 * Resolve a knowledge-base image to a `data:` URL — the same format the rest of
 * the hub uses for thumbnails, which avoids any img-src / blob: / cross-origin
 * surprises. Desktop reads the local file directly (the doc path is local to the
 * DB host); WebUI fetches through the server proxy and inlines the bytes.
 */
export async function loadKnowledgeImage(path: string): Promise<string | null> {
  try {
    if (shouldUseDirectVectorDb()) {
      return await ipcBridge.fs.getImageBase64.invoke({ path });
    }
    const resp = await requestVector(knowledgeImageUrl(path), {}, true);
    if (!resp.ok) return null;
    return await blobToDataUrl(await resp.blob());
  } catch {
    return null;
  }
}
