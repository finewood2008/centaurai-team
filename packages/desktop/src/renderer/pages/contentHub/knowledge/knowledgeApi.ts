/**
 * knowledgeApi — access to the local vector DB behind the Super Knowledge Base.
 *
 * Desktop runs co-located with the vector DB and reaches it directly. A WebUI
 * browser client cannot (the DB binds loopback on the server host), so it goes
 * through the WebUI server's proxy routes, which forward to the configured
 * endpoint. Mirrors the search recipe in pages/guid/hooks/useGuidSend.ts.
 */
import { ipcBridge } from '@/common';
import { normalizeVectorDbEndpoint } from '@/common/config/constants';
import { configService } from '@/common/config/configService';
import { getBaseUrl } from '@/common/adapter/httpBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { blobToDataUrl } from '../components/view/imageThumb';

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

async function vectorUploadBase(): Promise<string> {
  if (!isElectronDesktop()) return getBaseUrl();
  const status = await ipcBridge.webui.getStatus.invoke().catch((): null => null);
  if (status?.running && status.localUrl) return status.localUrl.replace(/\/$/, '');
  return getBaseUrl();
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
  const resp = isElectronDesktop()
    ? await fetch(`${endpoint}/api/documents?limit=${limit}&offset=${offset}`)
    : await fetch(`${getBaseUrl()}/api/vector-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, limit, offset }),
      });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const items: RawDoc[] = Array.isArray(data.items) ? data.items : [];
  return { total: num(data.total) || items.length, docs: items.map(normalize) };
}

export async function uploadKnowledgeFile(file: File): Promise<void> {
  const endpoint = vectorEndpoint();
  const form = new FormData();
  form.append('file', file, file.name);

  const base = await vectorUploadBase();
  const proxyResp = await fetch(`${base}/api/vector-upload?endpoint=${encodeURIComponent(endpoint)}`, {
    method: 'POST',
    body: form,
  });

  if (proxyResp.ok) return;

  if (isElectronDesktop() && proxyResp.status === 404) {
    const direct = new FormData();
    direct.append('file', file, file.name);
    const directResp = await fetch(`${endpoint}/api/upload`, {
      method: 'POST',
      headers: { 'X-Requested-By': 'centaur-vdb' },
      body: direct,
    });
    if (directResp.ok) return;
    throw new Error(`HTTP ${directResp.status}`);
  }

  throw new Error(`HTTP ${proxyResp.status}`);
}

export async function deleteKnowledgeDoc(docId: string): Promise<void> {
  const endpoint = vectorEndpoint();
  const resp = isElectronDesktop()
    ? await fetch(`${endpoint}/api/documents/${encodeURIComponent(docId)}`, {
        method: 'DELETE',
        headers: { 'X-Requested-By': 'centaur-vdb' },
      })
    : await fetch(`${getBaseUrl()}/api/vector-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, docId, action: 'delete' }),
      });
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
  const body = { query, n_results: nResults, mode };
  const resp = isElectronDesktop()
    ? await fetch(`${endpoint}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    : await fetch(`${getBaseUrl()}/api/vector-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, ...body }),
      });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const results: RawSearchHit[] = Array.isArray(data.results) ? data.results : [];
  return results.map(normalizeSearchHit);
}

export function knowledgeImageUrl(path: string): string {
  const endpoint = vectorEndpoint();
  return isElectronDesktop()
    ? `${endpoint}/api/image?path=${encodeURIComponent(path)}`
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
    if (isElectronDesktop()) {
      return await ipcBridge.fs.getImageBase64.invoke({ path });
    }
    const resp = await fetch(knowledgeImageUrl(path));
    if (!resp.ok) return null;
    return await blobToDataUrl(await resp.blob());
  } catch {
    return null;
  }
}
