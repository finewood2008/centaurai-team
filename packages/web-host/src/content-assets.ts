/**
 * Persistent AI generated asset registry.
 *
 * This is a managed manifest + blob store for generated artifacts. It is not a
 * second shared drive: publishing to the company space copies the asset into
 * the configured NAS under AI生成/... and records that NAS path on the asset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeFileResponseHeaders, safeInlineContentType } from './safe-preview.js';
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { nasMkdir, nasUploadFromPath } from './nas-drive.js';

export type ContentAssetKind = 'image' | 'document' | 'code' | 'other';
export type ContentAssetVisibility = 'private' | 'team' | 'public';
export type ContentAssetStorageProvider = 'workspace' | 'personal_content' | 'nas' | 'shared_drive' | 'knowledge';
export type ContentAssetStatusFlag =
  | 'draft'
  | 'saved'
  | 'shared'
  | 'stored_in_nas'
  | 'indexed'
  | 'archived'
  | 'missing';

export type ContentAsset = {
  id: string;
  title: string;
  kind: ContentAssetKind;
  ownerUserId: string;
  teamId?: string;
  visibility: ContentAssetVisibility;
  sourceConversationId?: string;
  sourceWorkspacePath: string;
  storageProvider: ContentAssetStorageProvider;
  storagePath: string;
  tags: string[];
  category?: string;
  statusFlags: ContentAssetStatusFlag[];
  createdAt: number;
  updatedAt: number;
  sharedDriveId?: string;
  nasStoragePath?: string;
};

export type ContentAssetSaveInput = {
  sourcePath: string;
  name: string;
  ownerUserId: string;
  sourceConversationId?: string;
  category?: string;
  kind?: ContentAssetKind;
  tags?: string[];
};

export type ContentAssetPublishInput = {
  userLabel?: string;
  conversationLabel?: string;
};

/**
 * Deliberately small projection used by the cross-user NAS "AI generated"
 * view. Private blob paths, workspace paths, conversation ids and owner ids
 * must never be exposed by that view.
 */
type PublishedContentAsset = Pick<
  ContentAsset,
  'id' | 'title' | 'kind' | 'visibility' | 'statusFlags' | 'updatedAt' | 'nasStoragePath'
>;

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_PUBLISH_BODY_BYTES = 64 * 1024;
const MAX_NAS_SEGMENT_BYTES = 180;
const MANIFEST_FILE = 'manifest.json';
const UNSAFE_NAME_CHARS = /[/\\:*?"<>|]/g;
const UNSAFE_SEGMENT_CHARS = /[/\\:*?"<>|]+/g;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function now(): number {
  return Date.now();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function manifestPath(dir: string): string {
  return path.join(dir, MANIFEST_FILE);
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function mimeOf(name: string): string {
  return MIME_BY_EXT[extOf(name)] || 'application/octet-stream';
}

function sanitizeName(name: string): string {
  const base = path.basename(name).replace(UNSAFE_NAME_CHARS, '_').replace(/^\.+/, '').trim();
  return base || 'asset';
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = '';
  let size = 0;
  for (const character of value) {
    const nextSize = size + Buffer.byteLength(character);
    if (nextSize > maxBytes) break;
    result += character;
    size = nextSize;
  }
  return result;
}

function safeSegment(value: string | undefined, fallback: string): string {
  const cleaned = (value || fallback).replace(UNSAFE_SEGMENT_CHARS, '_').replace(/^\.+/, '').trim();
  return truncateUtf8(cleaned || fallback, MAX_NAS_SEGMENT_BYTES) || fallback;
}

function safeKind(value: unknown, name: string): ContentAssetKind {
  if (value === 'image' || value === 'document' || value === 'code' || value === 'other') return value;
  const ext = extOf(name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
  if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'md', 'txt'].includes(ext)) return 'document';
  if (['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'py', 'go', 'rs', 'java', 'sh'].includes(ext)) return 'code';
  return 'other';
}

function normalizeAsset(value: unknown): ContentAsset | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const title = typeof raw.title === 'string' ? raw.title : '';
  const ownerUserId = typeof raw.ownerUserId === 'string' ? raw.ownerUserId : '';
  const storagePath = typeof raw.storagePath === 'string' ? raw.storagePath : '';
  const sourceWorkspacePath = typeof raw.sourceWorkspacePath === 'string' ? raw.sourceWorkspacePath : storagePath;
  if (!id || !title || !ownerUserId || !storagePath) return null;
  const statusFlags: ContentAssetStatusFlag[] = Array.isArray(raw.statusFlags)
    ? raw.statusFlags.filter((flag): flag is ContentAssetStatusFlag =>
        ['draft', 'saved', 'shared', 'stored_in_nas', 'indexed', 'archived', 'missing'].includes(String(flag))
      )
    : ['saved'];
  return {
    id,
    title,
    kind: safeKind(raw.kind, title),
    ownerUserId,
    teamId: typeof raw.teamId === 'string' ? raw.teamId : undefined,
    visibility:
      raw.visibility === 'team' || raw.visibility === 'public' || raw.visibility === 'private'
        ? raw.visibility
        : 'private',
    sourceConversationId: typeof raw.sourceConversationId === 'string' ? raw.sourceConversationId : undefined,
    sourceWorkspacePath,
    storageProvider:
      raw.storageProvider === 'workspace' ||
      raw.storageProvider === 'personal_content' ||
      raw.storageProvider === 'shared_drive' ||
      raw.storageProvider === 'nas' ||
      raw.storageProvider === 'knowledge'
        ? raw.storageProvider
        : 'personal_content',
    storagePath,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    category: typeof raw.category === 'string' ? raw.category : undefined,
    statusFlags: statusFlags.length ? [...new Set<ContentAssetStatusFlag>(statusFlags)] : ['saved'],
    createdAt: Number(raw.createdAt) || now(),
    updatedAt: Number(raw.updatedAt) || now(),
    sharedDriveId: typeof raw.sharedDriveId === 'string' ? raw.sharedDriveId : undefined,
    nasStoragePath: typeof raw.nasStoragePath === 'string' ? raw.nasStoragePath : undefined,
  };
}

async function readManifest(dir: string): Promise<ContentAsset[]> {
  try {
    const raw = await fs.promises.readFile(manifestPath(dir), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.map(normalizeAsset).filter((asset): asset is ContentAsset => asset !== null)
      : [];
  } catch {
    return [];
  }
}

async function writeManifest(dir: string, assets: ContentAsset[]): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.manifest.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  await fs.promises.writeFile(tmp, JSON.stringify(assets, null, 2), 'utf-8');
  await fs.promises.rename(tmp, manifestPath(dir));
}

const writeChains = new Map<string, Promise<unknown>>();

function withManifestLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(dir) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeChains.set(
    dir,
    next.catch(() => {})
  );
  return next;
}

async function upsertAsset(dir: string, asset: ContentAsset): Promise<ContentAsset> {
  return withManifestLock(dir, async () => {
    const assets = await readManifest(dir);
    const next = [asset, ...assets.filter((item) => item.id !== asset.id)].toSorted(
      (a, b) => b.updatedAt - a.updatedAt
    );
    await writeManifest(dir, next);
    return asset;
  });
}

function assetBlobPath(dir: string, ownerUserId: string, id: string, name: string): string {
  const safeOwner = safeSegment(ownerUserId, 'user');
  return path.join(dir, 'blobs', safeOwner, `${id}__${sanitizeName(name)}`);
}

function relativeToDir(dir: string, fullPath: string): string {
  return path.relative(dir, fullPath).replace(/\\/g, '/');
}

function withFlags(
  asset: ContentAsset,
  flags: ContentAssetStatusFlag[],
  patch: Partial<ContentAsset> = {}
): ContentAsset {
  return {
    ...asset,
    ...patch,
    statusFlags: [...new Set([...asset.statusFlags, ...flags])],
    updatedAt: now(),
  };
}

export async function contentAssetsList(dir: string | undefined, ownerUserId?: string): Promise<ContentAsset[]> {
  if (!dir) return [];
  const assets = await readManifest(dir);
  const filtered = ownerUserId ? assets.filter((asset) => asset.ownerUserId === ownerUserId) : assets;
  return filtered.toSorted((a, b) => b.updatedAt - a.updatedAt);
}

async function publishedContentAssetsList(dir: string | undefined): Promise<PublishedContentAsset[]> {
  if (!dir) return [];
  const assets = await readManifest(dir);
  return assets
    .filter(
      (asset) =>
        (asset.visibility === 'team' || asset.visibility === 'public') &&
        asset.statusFlags.includes('stored_in_nas') &&
        !asset.statusFlags.includes('archived') &&
        Boolean(asset.nasStoragePath)
    )
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .map((asset) => ({
      id: asset.id,
      title: asset.title,
      kind: asset.kind,
      visibility: asset.visibility,
      statusFlags: asset.statusFlags,
      updatedAt: asset.updatedAt,
      nasStoragePath: asset.nasStoragePath,
    }));
}

export async function contentAssetSaveFromPath(dir: string, input: ContentAssetSaveInput): Promise<ContentAsset> {
  const name = sanitizeName(input.name);
  const id = crypto.randomUUID();
  const full = assetBlobPath(dir, input.ownerUserId, id, name);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.copyFile(input.sourcePath, full);
  const at = now();
  const asset: ContentAsset = {
    id,
    title: name,
    kind: safeKind(input.kind, name),
    ownerUserId: input.ownerUserId,
    visibility: 'private',
    sourceConversationId: input.sourceConversationId,
    sourceWorkspacePath: input.sourcePath,
    storageProvider: 'personal_content',
    storagePath: full,
    tags: input.tags ?? [],
    category: input.category,
    statusFlags: ['saved'],
    createdAt: at,
    updatedAt: at,
  };
  return upsertAsset(dir, asset);
}

export async function contentAssetArchive(dir: string, id: string, ownerUserId?: string): Promise<ContentAsset | null> {
  return withManifestLock(dir, async () => {
    const assets = await readManifest(dir);
    const asset = assets.find((item) => item.id === id && (!ownerUserId || item.ownerUserId === ownerUserId));
    if (!asset) return null;
    const updated = withFlags(asset, ['archived']);
    await writeManifest(dir, [updated, ...assets.filter((item) => item.id !== id)]);
    return updated;
  });
}

export async function contentAssetPublishToNas(
  dir: string,
  nasRootDir: string,
  id: string,
  input: ContentAssetPublishInput = {},
  ownerUserId?: string
): Promise<ContentAsset | null> {
  return withManifestLock(dir, async () => {
    const assets = await readManifest(dir);
    const asset = assets.find((item) => item.id === id && (!ownerUserId || item.ownerUserId === ownerUserId));
    if (!asset) return null;
    const user = safeSegment(input.userLabel || asset.ownerUserId, 'user');
    const conversation = safeSegment(
      input.conversationLabel || asset.category || asset.sourceConversationId,
      '未命名会话'
    );
    let parentRel = '';
    for (const segment of ['AI生成', user, conversation]) {
      const created = await nasMkdir(nasRootDir, parentRel, segment);
      if (created == null) return null;
      parentRel = created;
    }
    const nasRel = await nasUploadFromPath(nasRootDir, parentRel, asset.storagePath, asset.title);
    if (!nasRel) return null;
    const updated = withFlags(asset, ['stored_in_nas', 'shared'], {
      visibility: 'team',
      nasStoragePath: nasRel,
    });
    await writeManifest(dir, [updated, ...assets.filter((item) => item.id !== id)]);
    return updated;
  });
}

async function findAsset(dir: string | undefined, id: string, ownerUserId: string): Promise<ContentAsset | null> {
  if (!dir) return null;
  return (await readManifest(dir)).find((asset) => asset.id === id && asset.ownerUserId === ownerUserId) ?? null;
}

async function streamAsset(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string,
  disposition: 'attachment' | 'inline'
): Promise<void> {
  if (!dir) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const id = url.searchParams.get('id') || '';
  const asset = id ? await findAsset(dir, id, ownerUserId) : null;
  if (!asset) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(asset.storagePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    sendJson(res, 404, { success: false, error: 'FILE_NOT_FOUND' });
    return;
  }
  res.writeHead(200, {
    'content-type': disposition === 'inline' ? safeInlineContentType(mimeOf(asset.title)) : 'application/octet-stream',
    'content-length': String(stat.size),
    'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(asset.title)}`,
    'cache-control': 'no-store',
    ...safeFileResponseHeaders(disposition === 'inline'),
  });
  const stream = fs.createReadStream(asset.storagePath);
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, { success: false, error: 'READ_ERROR' });
    else res.destroy();
  });
  stream.pipe(res);
}

export async function handleContentAssetsList(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const requestedOwner = url.searchParams.get('owner')?.trim();
  if (requestedOwner && requestedOwner !== ownerUserId) {
    sendJson(res, 403, { success: false, error: 'FORBIDDEN' });
    return;
  }

  // Existing NAS clients omit owner. Preserve that use case without turning
  // omission into an "all private assets" capability: only return already
  // published NAS records, and only the fields the NAS list actually needs.
  const data = requestedOwner ? await contentAssetsList(dir, ownerUserId) : await publishedContentAssetsList(dir);
  sendJson(res, 200, { success: true, data });
}

export async function handleContentAssetUpload(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  if (!dir) {
    sendJson(res, 503, { success: false, error: 'CONTENT_ASSETS_DISABLED' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const requestedOwner = url.searchParams.get('owner')?.trim() || '';
  const rawName = url.searchParams.get('name') || '';
  if (!requestedOwner || !rawName) {
    sendJson(res, 400, { success: false, error: 'MISSING_METADATA' });
    return;
  }
  if (requestedOwner !== ownerUserId) {
    sendJson(res, 403, { success: false, error: 'FORBIDDEN' });
    return;
  }
  const name = sanitizeName(rawName);
  const id = crypto.randomUUID();
  const full = assetBlobPath(dir, ownerUserId, id, name);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  let size = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(full);
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        out.destroy();
        fs.promises.rm(full, { force: true }).finally(() => reject(err));
      };
      out.on('error', fail);
      req.on('error', fail);
      req.on('aborted', () => fail(new Error('ABORTED')));
      req.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) {
          fail(new Error('TOO_LARGE'));
          return;
        }
        if (!out.write(chunk)) {
          req.pause();
          out.once('drain', () => req.resume());
        }
      });
      req.on('end', () => {
        if (settled) return;
        out.end(() => {
          settled = true;
          resolve();
        });
      });
    });
  } catch (err) {
    await fs.promises.rm(full, { force: true }).catch(() => {});
    const tooLarge = err instanceof Error && err.message === 'TOO_LARGE';
    sendJson(res, tooLarge ? 413 : 500, { success: false, error: tooLarge ? 'TOO_LARGE' : 'WRITE_ERROR' });
    return;
  }

  const at = now();
  const asset: ContentAsset = {
    id,
    title: name,
    kind: safeKind(url.searchParams.get('kind'), name),
    ownerUserId,
    visibility: 'private',
    sourceConversationId: url.searchParams.get('conversation_id') || undefined,
    sourceWorkspacePath: url.searchParams.get('source_path') || full,
    storageProvider: 'personal_content',
    storagePath: full,
    tags: [],
    category: url.searchParams.get('category') || undefined,
    statusFlags: ['saved'],
    createdAt: at,
    updatedAt: at,
  };
  sendJson(res, 200, { success: true, data: await upsertAsset(dir, asset), relPath: relativeToDir(dir, full) });
}

export async function handleContentAssetArchive(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  if (!dir) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const requestedOwner = url.searchParams.get('owner')?.trim() || '';
  if (!requestedOwner) {
    sendJson(res, 400, { success: false, error: 'MISSING_METADATA' });
    return;
  }
  if (requestedOwner !== ownerUserId) {
    sendJson(res, 403, { success: false, error: 'FORBIDDEN' });
    return;
  }
  const asset = await contentAssetArchive(dir, url.searchParams.get('id') || '', ownerUserId);
  if (!asset) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  sendJson(res, 200, { success: true, data: asset });
}

export async function handleContentAssetPublishToNas(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  nasRootDir: string | undefined,
  ownerUserId: string
): Promise<void> {
  if (!dir || !nasRootDir) {
    sendJson(res, 503, { success: false, error: 'NAS_DISABLED' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const requestedOwner = url.searchParams.get('owner')?.trim() || '';
  if (!requestedOwner) {
    sendJson(res, 400, { success: false, error: 'MISSING_METADATA' });
    return;
  }
  if (requestedOwner !== ownerUserId) {
    sendJson(res, 403, { success: false, error: 'FORBIDDEN' });
    return;
  }
  let body: Record<string, unknown> = {};
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_PUBLISH_BODY_BYTES) {
        sendJson(res, 413, { success: false, error: 'BODY_TOO_LARGE' });
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    sendJson(res, 400, { success: false, error: 'INVALID_JSON' });
    return;
  }
  const asset = await contentAssetPublishToNas(
    dir,
    nasRootDir,
    url.searchParams.get('id') || '',
    {
      // The authenticated seat, not a caller-controlled label, owns the NAS
      // folder. conversationLabel remains cosmetic and is sanitized below.
      userLabel: ownerUserId,
      conversationLabel: typeof body.conversationLabel === 'string' ? body.conversationLabel : undefined,
    },
    ownerUserId
  );
  if (!asset) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  sendJson(res, 200, { success: true, data: asset });
}

export function handleContentAssetDownload(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  return streamAsset(req, res, dir, ownerUserId, 'attachment');
}

export function handleContentAssetPreview(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  return streamAsset(req, res, dir, ownerUserId, 'inline');
}
