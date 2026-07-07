/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { emitter } from '@/renderer/utils/emitter';
import type { FileEntry } from '@/renderer/pages/guid/components/RecentFiles';

const STANDALONE_ARTIFACTS_KEY = 'centaurai.generated-artifacts.v1';
const MAX_STANDALONE_ARTIFACTS = 300;

const GENERATED_ARTIFACT_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'potx',
  'xls',
  'xlsx',
  'csv',
  'md',
  'markdown',
  'html',
  'htm',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'avif',
  'svg',
] as const;

const GENERATED_ARTIFACT_EXT_RE = new RegExp(`\\.(${GENERATED_ARTIFACT_EXTENSIONS.join('|')})\\b`, 'i');
const GENERATED_ARTIFACT_PATH_RE = new RegExp(
  [
    String.raw`file:\/\/[^\s<>"'\`]+\.(?:${GENERATED_ARTIFACT_EXTENSIONS.join('|')})\b`,
    String.raw`["'\`]([^"'\`]+?\.(?:${GENERATED_ARTIFACT_EXTENSIONS.join('|')}))["'\`]`,
    String.raw`(?:~|\/|\.{1,2}[\\/]|[A-Za-z]:[\\/])[^<>"'\`\s]*?\.(?:${GENERATED_ARTIFACT_EXTENSIONS.join('|')})\b`,
  ].join('|'),
  'gi'
);

type ArtifactSource = 'conversation' | 'toolbox' | 'meeting';

type StoredGeneratedArtifact = {
  path: string;
  name: string;
  conversation: string;
  source: ArtifactSource;
  addedAt: number;
};

export type RegisterGeneratedArtifactsOptions = {
  paths: Array<string | null | undefined>;
  workspace?: string | null;
  conversationId?: string;
  source?: ArtifactSource;
  standaloneLabel?: string;
};

const copiedExternalArtifactPaths = new Map<string, string>();

function stripTrailingSlash(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^file:\/\//i.test(path) || /^[A-Za-z]:[\\/]/.test(path);
}

function cleanPathToken(raw: string): string {
  return raw
    .trim()
    .replace(/^file:\/\//i, '')
    .replace(/^[<([{]+/, '')
    .replace(/[>\])}.,，。；;:：]+$/, '');
}

function nameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function joinWorkspacePath(workspace: string, path: string): string {
  if (isAbsolutePath(path)) return path;
  return `${stripTrailingSlash(workspace)}/${path.replace(/^\.?[\\/]+/, '')}`;
}

function isInsideWorkspace(path: string, workspace: string): boolean {
  const resolvedPath = stripTrailingSlash(normalizeSlashes(path));
  const resolvedWorkspace = stripTrailingSlash(normalizeSlashes(workspace));
  return resolvedPath === resolvedWorkspace || resolvedPath.startsWith(`${resolvedWorkspace}/`);
}

function dedupePaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawPath of paths) {
    if (typeof rawPath !== 'string') continue;
    const path = cleanPathToken(rawPath);
    if (!path || /^https?:\/\//i.test(path) || !GENERATED_ARTIFACT_EXT_RE.test(path)) continue;
    const key = normalizeSlashes(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readStoredArtifacts(): StoredGeneratedArtifact[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STANDALONE_ARTIFACTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredGeneratedArtifact[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item?.path === 'string' && item.path.length > 0);
  } catch {
    return [];
  }
}

function writeStoredArtifacts(items: StoredGeneratedArtifact[]): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(STANDALONE_ARTIFACTS_KEY, JSON.stringify(items.slice(0, MAX_STANDALONE_ARTIFACTS)));
  } catch {
    // Ignore quota/security errors; generated files still exist on disk.
  }
}

function rememberStandaloneArtifacts(paths: string[], label: string, source: ArtifactSource): void {
  if (paths.length === 0) return;
  const now = Date.now();
  const existing = readStoredArtifacts();
  const byPath = new Map(existing.map((item) => [normalizeSlashes(item.path), item]));
  for (const path of paths) {
    byPath.set(normalizeSlashes(path), {
      path,
      name: nameFromPath(path),
      conversation: label,
      source,
      addedAt: now,
    });
  }
  writeStoredArtifacts([...byPath.values()].toSorted((a, b) => b.addedAt - a.addedAt));
}

function toEpochSeconds(timestamp: number): number {
  if (!timestamp) return Math.floor(Date.now() / 1000);
  return timestamp >= 1e12 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
}

export function extractGeneratedArtifactPaths(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string') {
    const matches: string[] = [];
    for (const match of value.matchAll(GENERATED_ARTIFACT_PATH_RE)) {
      matches.push(cleanPathToken(match[1] || match[0]));
    }
    return dedupePaths(matches);
  }
  if (Array.isArray(value)) {
    return dedupePaths(value.flatMap((item) => extractGeneratedArtifactPaths(item, depth + 1)));
  }
  if (typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const paths: string[] = [];
  for (const [key, nested] of Object.entries(record)) {
    if (key === 'file_diff' || key === 'diff') continue;
    paths.push(...extractGeneratedArtifactPaths(nested, depth + 1));
  }
  return dedupePaths(paths);
}

export function notifyGeneratedArtifactsChanged(): void {
  emitter.emit('acp.workspace.refresh');
  emitter.emit('codex.workspace.refresh');
  emitter.emit('aionrs.workspace.refresh');
  emitter.emit('openclaw-gateway.workspace.refresh');
  emitter.emit('nanobot.workspace.refresh');
  emitter.emit('remote.workspace.refresh');
  emitter.emit('generated-files.changed');
}

export async function registerGeneratedArtifacts({
  paths,
  workspace,
  conversationId,
  source = 'conversation',
  standaloneLabel,
}: RegisterGeneratedArtifactsOptions): Promise<string[]> {
  const candidates = dedupePaths(paths);
  if (candidates.length === 0) return [];

  const registered: string[] = [];
  let workspacePath = typeof workspace === 'string' && workspace.trim() ? workspace.trim() : '';

  if (!workspacePath && conversationId) {
    try {
      const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
      const conversationWorkspace = (conversation?.extra as { workspace?: string } | undefined)?.workspace;
      if (typeof conversationWorkspace === 'string' && conversationWorkspace.trim()) {
        workspacePath = conversationWorkspace.trim();
      }
    } catch {
      // Keep the standalone fallback below when the conversation is no longer readable.
    }
  }

  if (workspacePath) {
    const externalPaths: string[] = [];
    for (const path of candidates) {
      const resolvedPath = joinWorkspacePath(workspacePath, path);
      if (!isAbsolutePath(path) || isInsideWorkspace(resolvedPath, workspacePath)) {
        registered.push(resolvedPath);
        continue;
      }

      const copyKey = `${normalizeSlashes(workspacePath)}\n${normalizeSlashes(path)}`;
      const previousCopy = copiedExternalArtifactPaths.get(copyKey);
      if (previousCopy) {
        registered.push(previousCopy);
        continue;
      }
      externalPaths.push(path);
    }

    if (externalPaths.length > 0) {
      try {
        const result = await ipcBridge.fs.copyFilesToWorkspace.invoke({
          file_paths: externalPaths,
          workspace: workspacePath,
        });
        const copied = result?.copied_files ?? [];
        for (let index = 0; index < copied.length; index++) {
          const sourcePath = externalPaths[index];
          const copiedPath = copied[index];
          if (!sourcePath || !copiedPath) continue;
          copiedExternalArtifactPaths.set(
            `${normalizeSlashes(workspacePath)}\n${normalizeSlashes(sourcePath)}`,
            copiedPath
          );
          registered.push(copiedPath);
        }
      } catch (error) {
        console.warn('[GeneratedArtifacts] Failed to copy generated files into workspace:', error);
      }
    }
  } else {
    registered.push(...candidates);
    rememberStandaloneArtifacts(candidates, standaloneLabel || '工具箱', source);
  }

  const uniqueRegistered = dedupePaths(registered);
  if (uniqueRegistered.length > 0) notifyGeneratedArtifactsChanged();
  return uniqueRegistered;
}

export async function registerGeneratedArtifactsFromPayload(
  payload: unknown,
  options: Omit<RegisterGeneratedArtifactsOptions, 'paths'>
): Promise<string[]> {
  return registerGeneratedArtifacts({ ...options, paths: extractGeneratedArtifactPaths(payload) });
}

export async function loadStandaloneGeneratedArtifactFiles(): Promise<FileEntry[]> {
  const stored = readStoredArtifacts();
  if (stored.length === 0) return [];

  const resolved = await Promise.all(
    stored.map(async (item) => {
      try {
        const metadata = await ipcBridge.fs.getFileMetadata.invoke({ path: item.path });
        if (!metadata || metadata.isDirectory) return null;
        return {
          item,
          file: {
            name: metadata.name || item.name || nameFromPath(item.path),
            path: metadata.path || item.path,
            size: metadata.size || 0,
            mtime: toEpochSeconds(metadata.lastModified || item.addedAt),
            conversation: item.conversation || '工具箱',
          } satisfies FileEntry,
        };
      } catch {
        // File no longer exists or is no longer readable; prune it from the manifest.
        return null;
      }
    })
  );

  const live = resolved.filter((entry): entry is { item: StoredGeneratedArtifact; file: FileEntry } => entry !== null);
  if (live.length !== stored.length) writeStoredArtifacts(live.map((entry) => entry.item));

  return live.map((entry) => entry.file).toSorted((a, b) => b.mtime - a.mtime);
}
