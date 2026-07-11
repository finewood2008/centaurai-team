/**
 * Content asset registry and lifecycle actions for the Content Hub.
 *
 * Workspace scans are treated as draft candidates. A draft becomes formal
 * personal content only after saveDraftToContent copies the bytes to a stable
 * personal-content folder and records a ContentAsset.
 */
import { ipcBridge } from '@/common';
import { getCurrentFrontendUserId } from '@/common/utils/frontendUserScope';
import { fetchWithWebuiAuth, getBaseUrl, isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { isUnsafeTemporaryWorkspacePath } from '@/renderer/utils/workspace/workspace';
import { classifyHubFile } from './hubState';
import type { ContentAsset, ContentAssetStatusFlag, FileEntry } from '../../types';

const CONTENT_ASSETS_KEY = 'centaurai.content-assets.v1';
const CONTENT_ASSETS_MIGRATED_KEY = 'centaurai.content-assets.backend-migrated.v1';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function now(): number {
  return Date.now();
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
}

function isAbsoluteFilesystemPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
}

function hasUnsafePathSegment(path: string): boolean {
  return (
    path.includes('\0') ||
    normalizePath(path)
      .split('/')
      .some((segment) => segment === '..')
  );
}

function comparablePath(path: string): string {
  const normalized = normalizePath(path.trim());
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function pathsEqual(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

/** Strict containment for a file below (never equal to) a managed root. */
function isPathInsideRoot(path: string, root: string): boolean {
  if (!path.trim() || !root.trim() || hasUnsafePathSegment(path) || hasUnsafePathSegment(root)) return false;
  const normalizedPath = comparablePath(path);
  const normalizedRoot = comparablePath(root);
  if (!isAbsoluteFilesystemPath(normalizedPath) || !isAbsoluteFilesystemPath(normalizedRoot)) return false;
  return normalizedPath !== normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function uniqueAssetId(seed: string, at = now()): string {
  return `asset:${at.toString(36)}:${stableHash(seed)}`;
}

export function draftAssetIdForPath(path: string): string {
  return `draft:${stableHash(normalizePath(path))}`;
}

function hasFlag(asset: ContentAsset, flag: ContentAssetStatusFlag): boolean {
  return asset.statusFlags.includes(flag);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStatusFlag(value: unknown): value is ContentAssetStatusFlag {
  return (
    value === 'draft' ||
    value === 'saved' ||
    value === 'shared' ||
    value === 'stored_in_nas' ||
    value === 'indexed' ||
    value === 'archived' ||
    value === 'missing'
  );
}

function normalizeAsset(value: unknown): ContentAsset | null {
  if (!isRecord(value)) return null;
  const statusFlags = Array.isArray(value.statusFlags) ? value.statusFlags.filter(isStatusFlag) : [];
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.ownerUserId !== 'string' ||
    typeof value.sourceWorkspacePath !== 'string' ||
    typeof value.storagePath !== 'string' ||
    statusFlags.length === 0
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    kind:
      value.kind === 'image' || value.kind === 'document' || value.kind === 'code' || value.kind === 'other'
        ? value.kind
        : classifyHubFile(value.title),
    ownerUserId: value.ownerUserId,
    teamId: typeof value.teamId === 'string' ? value.teamId : undefined,
    visibility:
      value.visibility === 'team' || value.visibility === 'public' || value.visibility === 'private'
        ? value.visibility
        : 'private',
    sourceConversationId: typeof value.sourceConversationId === 'string' ? value.sourceConversationId : undefined,
    sourceWorkspacePath: value.sourceWorkspacePath,
    storageProvider:
      value.storageProvider === 'workspace' ||
      value.storageProvider === 'personal_content' ||
      value.storageProvider === 'shared_drive' ||
      value.storageProvider === 'nas' ||
      value.storageProvider === 'knowledge'
        ? value.storageProvider
        : 'personal_content',
    storagePath: value.storagePath,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    category: typeof value.category === 'string' ? value.category : undefined,
    statusFlags,
    createdAt: Number(value.createdAt) || now(),
    updatedAt: Number(value.updatedAt) || now(),
    sharedDriveId: typeof value.sharedDriveId === 'string' ? value.sharedDriveId : undefined,
    nasStoragePath: typeof value.nasStoragePath === 'string' ? value.nasStoragePath : undefined,
  };
}

function readAllContentAssets(): ContentAsset[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(CONTENT_ASSETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeAsset).filter((asset): asset is ContentAsset => asset !== null);
  } catch {
    return [];
  }
}

export function readContentAssets(ownerUserId = getCurrentFrontendUserId()): ContentAsset[] {
  return readAllContentAssets().filter((asset) => asset.ownerUserId === ownerUserId);
}

function writeContentAssets(assets: ContentAsset[]): void {
  const store = storage();
  if (!store) throw new Error('REGISTRY_UNAVAILABLE');
  try {
    store.setItem(CONTENT_ASSETS_KEY, JSON.stringify(assets));
  } catch {
    throw new Error('REGISTRY_WRITE_FAILED');
  }
}

export function upsertContentAsset(asset: ContentAsset): ContentAsset {
  const all = readAllContentAssets();
  const next = [asset, ...all.filter((item) => item.id !== asset.id)].toSorted((a, b) => b.updatedAt - a.updatedAt);
  writeContentAssets(next);
  return asset;
}

export function filterSavedContentAssets(assets: readonly ContentAsset[]): ContentAsset[] {
  return assets.filter((asset) => hasFlag(asset, 'saved') && !hasFlag(asset, 'archived'));
}

export function filterArchivedContentAssets(assets: readonly ContentAsset[]): ContentAsset[] {
  return assets.filter((asset) => hasFlag(asset, 'archived'));
}

export function draftAssetFromFile(file: FileEntry, ownerUserId = getCurrentFrontendUserId()): ContentAsset {
  if (!isDraftFileEligibleForReview(file)) throw new Error('UNTRUSTED_DRAFT_SOURCE');
  const at = file.mtime > 0 ? file.mtime * 1000 : now();
  return {
    id: draftAssetIdForPath(file.path),
    title: file.name,
    kind: classifyHubFile(file.name),
    ownerUserId,
    visibility: 'private',
    sourceConversationId: file.sourceConversationId,
    sourceWorkspacePath: file.path,
    storageProvider: 'workspace',
    storagePath: file.path,
    tags: [],
    category: file.conversation,
    statusFlags: ['draft'],
    createdAt: at,
    updatedAt: at,
  };
}

/** Draft visibility requires positive provenance. A bare FileEntry obtained by
 * scanning an arbitrary user-selected folder is never a draft candidate. */
export function isDraftFileEligibleForReview(file: FileEntry): boolean {
  if (file.draftProvenance === 'registered-generated-artifact') {
    // Standalone explicit artifacts remain useful for save/publish, but their
    // renderer registry is not strong enough to authorize deletion.
    return file.canDiscardDraft === false && !!file.path.trim();
  }
  if (file.draftProvenance !== 'managed-temporary-workspace') return false;
  if (!file.sourceConversationId || !file.workspaceRoot || file.canDiscardDraft !== true) return false;
  if (isUnsafeTemporaryWorkspacePath(file.workspaceRoot)) return false;
  return isPathInsideRoot(file.path, file.workspaceRoot);
}

export function canDiscardDraftFile(file: FileEntry): boolean {
  // WebUI and distributed clients must never turn this UX action into a
  // server-filesystem delete. They can still save/publish drafts and archive
  // durable ContentAsset records through their owner-scoped APIs.
  return (
    isElectronDesktop() &&
    !isRemoteClientBridgeMode() &&
    file.draftProvenance === 'managed-temporary-workspace' &&
    isDraftFileEligibleForReview(file)
  );
}

export function draftFilesForReview(files: readonly FileEntry[], assets: readonly ContentAsset[]): FileEntry[] {
  const savedSourcePaths = new Set(
    assets.filter((asset) => hasFlag(asset, 'saved')).map((asset) => normalizePath(asset.sourceWorkspacePath))
  );
  return files.filter((file) => isDraftFileEligibleForReview(file) && !savedSourcePaths.has(normalizePath(file.path)));
}

/**
 * Permanently remove a draft only after re-reading the owning conversation and
 * file metadata from the backend. This prevents stale UI state (or a crafted
 * FileEntry) from turning a custom workspace path into a deletion request.
 */
export async function discardDraftFile(file: FileEntry): Promise<void> {
  if (!canDiscardDraftFile(file)) throw new Error('DRAFT_DISCARD_NOT_ALLOWED');

  const conversation = await ipcBridge.conversation.get.invoke({ id: file.sourceConversationId! });
  const extra = conversation?.extra as
    | { workspace?: string; custom_workspace?: boolean; is_temporary_workspace?: boolean }
    | undefined;
  const authoritativeRoot = extra?.workspace?.trim() || '';
  if (
    !authoritativeRoot ||
    extra?.is_temporary_workspace !== true ||
    extra.custom_workspace === true ||
    isUnsafeTemporaryWorkspacePath(authoritativeRoot) ||
    !pathsEqual(authoritativeRoot, file.workspaceRoot!) ||
    !isPathInsideRoot(file.path, authoritativeRoot)
  ) {
    throw new Error('DRAFT_WORKSPACE_CHANGED');
  }

  const metadata = await ipcBridge.fs.getFileMetadata.invoke({
    path: file.path,
    workspace: authoritativeRoot,
  });
  const verifiedPath = metadata?.path?.trim() || '';
  if (
    !verifiedPath ||
    metadata.isDirectory === true ||
    !pathsEqual(verifiedPath, file.path) ||
    !isPathInsideRoot(verifiedPath, authoritativeRoot)
  ) {
    throw new Error('DRAFT_FILE_CHANGED');
  }

  await ipcBridge.fs.removeEntry.invoke({ path: verifiedPath });
}

export function createSavedContentAsset(
  file: FileEntry,
  storagePath: string,
  ownerUserId = getCurrentFrontendUserId(),
  at = now()
): ContentAsset {
  return {
    id: uniqueAssetId(`${ownerUserId}:${file.path}:${storagePath}`, at),
    title: file.name,
    kind: classifyHubFile(file.name),
    ownerUserId,
    visibility: 'private',
    sourceConversationId: file.sourceConversationId,
    sourceWorkspacePath: file.path,
    storageProvider: 'personal_content',
    storagePath,
    tags: [],
    category: file.conversation,
    statusFlags: ['saved'],
    createdAt: at,
    updatedAt: at,
  };
}

export function fileEntryFromAsset(asset: ContentAsset): FileEntry {
  return {
    name: asset.title,
    path: asset.storagePath,
    size: 0,
    mtime: Math.floor(asset.updatedAt / 1000),
    conversation: asset.category || asset.sourceConversationId || '',
    sourceConversationId: asset.sourceConversationId,
  };
}

async function readFileAsBase64(path: string): Promise<string> {
  const base64 = await ipcBridge.fs.readFileBuffer.invoke({ path });
  if (!base64) throw new Error('READ_FAILED');
  return base64;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

type Win = Window & { __backendPort?: number; __backendHost?: string };

function isBrowserMode(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && !(window as Win).__backendPort;
}

function backendHost(): string {
  return (typeof window !== 'undefined' && (window as Win).__backendHost) || '127.0.0.1';
}

function isAdminElectron(): boolean {
  if (!isElectronDesktop() || isBrowserMode()) return false;
  const host = backendHost();
  return host === '127.0.0.1' || host === 'localhost';
}

async function resolveBase(): Promise<string> {
  if (isBrowserMode()) return '';
  if (!isAdminElectron()) return getBaseUrl();
  const status = await ipcBridge.webui.getStatus.invoke();
  if (!status.running || !status.localUrl) throw new Error('WEBUI_UNAVAILABLE');
  return status.localUrl.replace(/\/$/, '');
}

function contentAssetUrl(pathAndQuery: string): Promise<string> {
  return resolveBase().then((base) => `${base}${pathAndQuery}`);
}

async function postJson<T>(pathAndQuery: string, body?: unknown): Promise<T> {
  const url = await contentAssetUrl(pathAndQuery);
  const resp = await fetchWithWebuiAuth(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`content-assets failed: ${resp.status}`);
  const json = (await resp.json()) as { success?: boolean; data?: T };
  if (json.success === false) throw new Error('CONTENT_ASSETS_FAILED');
  return json.data as T;
}

async function getJson<T>(pathAndQuery: string): Promise<T> {
  const url = await contentAssetUrl(pathAndQuery);
  const resp = await fetchWithWebuiAuth(url);
  if (!resp.ok) throw new Error(`content-assets failed: ${resp.status}`);
  const json = (await resp.json()) as { success?: boolean; data?: T };
  if (json.success === false) throw new Error('CONTENT_ASSETS_FAILED');
  return (json.data ?? ([] as unknown)) as T;
}

function assetKindFromFile(file: FileEntry) {
  return classifyHubFile(file.name);
}

export async function listContentAssets(ownerUserId?: string): Promise<ContentAsset[]> {
  if (isAdminElectron()) return ipcBridge.contentAssetsLocal.list.invoke({ ownerUserId });
  const q = ownerUserId ? `?owner=${encodeURIComponent(ownerUserId)}` : '';
  return getJson<ContentAsset[]>(`/api/content-assets/list${q}`);
}

async function uploadAssetBytes(file: FileEntry, ownerUserId: string): Promise<ContentAsset> {
  const base64 = await readFileAsBase64(file.path);
  const params = new URLSearchParams({
    owner: ownerUserId,
    name: file.name,
    source_path: file.path,
    kind: assetKindFromFile(file),
  });
  if (file.sourceConversationId) params.set('conversation_id', file.sourceConversationId);
  if (file.conversation) params.set('category', file.conversation);
  const url = await contentAssetUrl(`/api/content-assets/upload?${params.toString()}`);
  const resp = await fetchWithWebuiAuth(url, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Blob([base64ToBytes(base64)]),
  });
  if (!resp.ok) throw new Error(`content-assets upload failed: ${resp.status}`);
  const json = (await resp.json()) as { success?: boolean; data?: ContentAsset };
  if (!json.success || !json.data) throw new Error('CONTENT_ASSETS_UPLOAD_FAILED');
  return json.data;
}

export async function saveDraftToContent(file: FileEntry): Promise<ContentAsset> {
  const ownerUserId = getCurrentFrontendUserId();
  const existing = (await listContentAssets(ownerUserId)).find(
    (asset) => hasFlag(asset, 'saved') && normalizePath(asset.sourceWorkspacePath) === normalizePath(file.path)
  );
  if (existing) return existing;

  if (isAdminElectron()) {
    return ipcBridge.contentAssetsLocal.saveFromPath.invoke({
      sourcePath: file.path,
      name: file.name,
      ownerUserId,
      sourceConversationId: file.sourceConversationId,
      category: file.conversation,
      kind: assetKindFromFile(file),
    });
  }
  return uploadAssetBytes(file, ownerUserId);
}

export async function publishAssetToNas(asset: ContentAsset): Promise<ContentAsset> {
  const ownerUserId = getCurrentFrontendUserId();
  if (isAdminElectron()) {
    const updated = await ipcBridge.contentAssetsLocal.publishToNas.invoke({
      id: asset.id,
      ownerUserId,
      userLabel: ownerUserId,
      conversationLabel: asset.category || asset.sourceConversationId || '未命名会话',
    });
    if (!updated) throw new Error('PUBLISH_FAILED');
    return updated;
  }
  return postJson<ContentAsset>(
    `/api/content-assets/publish-to-nas?id=${encodeURIComponent(asset.id)}&owner=${encodeURIComponent(ownerUserId)}`,
    {
      userLabel: ownerUserId,
      conversationLabel: asset.category || asset.sourceConversationId || '未命名会话',
    }
  );
}

export async function saveAssetToNas(asset: ContentAsset): Promise<ContentAsset> {
  return publishAssetToNas(asset);
}

export async function shareAssetToTeam(asset: ContentAsset): Promise<ContentAsset> {
  return publishAssetToNas(asset);
}

export async function markAssetArchived(asset: ContentAsset): Promise<ContentAsset> {
  const ownerUserId = getCurrentFrontendUserId();
  if (isAdminElectron()) {
    const updated = await ipcBridge.contentAssetsLocal.archive.invoke({ id: asset.id, ownerUserId });
    if (!updated) throw new Error('ARCHIVE_FAILED');
    return updated;
  }
  return postJson<ContentAsset>(
    `/api/content-assets/archive?id=${encodeURIComponent(asset.id)}&owner=${encodeURIComponent(ownerUserId)}`
  );
}

export function contentAssetPreviewUrl(asset: ContentAsset): Promise<string> {
  return contentAssetUrl(`/api/content-assets/preview?id=${encodeURIComponent(asset.id)}`);
}

export async function migrateLegacyContentAssets(): Promise<void> {
  const store = storage();
  if (!store || store.getItem(CONTENT_ASSETS_MIGRATED_KEY)) return;
  const ownerUserId = getCurrentFrontendUserId();
  const legacy = readContentAssets(ownerUserId).filter(
    (asset) => hasFlag(asset, 'saved') && !hasFlag(asset, 'archived')
  );
  if (legacy.length === 0) {
    store.setItem(CONTENT_ASSETS_MIGRATED_KEY, '1');
    return;
  }
  const existing = await listContentAssets(ownerUserId).catch((): ContentAsset[] => []);
  const existingSources = new Set(
    existing.flatMap((asset): string[] => [normalizePath(asset.sourceWorkspacePath), normalizePath(asset.storagePath)])
  );
  for (const asset of legacy) {
    if (
      existingSources.has(normalizePath(asset.sourceWorkspacePath)) ||
      existingSources.has(normalizePath(asset.storagePath))
    ) {
      continue;
    }
    try {
      await saveDraftToContent({
        name: asset.title,
        path: asset.storagePath,
        size: 0,
        mtime: Math.floor(asset.updatedAt / 1000),
        conversation: asset.category || asset.sourceConversationId || '',
        sourceConversationId: asset.sourceConversationId,
      });
    } catch {
      // Keep migration best-effort. Broken local files should not block the hub.
    }
  }
  store.setItem(CONTENT_ASSETS_MIGRATED_KEY, '1');
}
