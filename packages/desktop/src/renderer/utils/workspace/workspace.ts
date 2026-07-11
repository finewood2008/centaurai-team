/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workspace utility functions
 * 工作空间工具函数
 */

const splitPathSegments = (targetPath: string): string[] => targetPath.split(/[\\/]+/).filter(Boolean);

const normalizeWorkspacePathForSafety = (workspacePath: string): string =>
  workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * Runtime "temporary workspace" events must never point at broad user roots.
 * If a backend accidentally reports its process cwd (for example `/home/user`)
 * as the temp workspace, the sidebar would enumerate the whole home directory.
 * User-picked custom workspaces are handled by callers and are not blocked by
 * this helper by themselves.
 */
export const isUnsafeTemporaryWorkspacePath = (workspacePath: string): boolean => {
  const path = normalizeWorkspacePathForSafety(workspacePath);
  if (!path || path === '/' || path === '~') return true;
  if (path === '/home' || path === '/Users') return true;
  if (/^\/(?:home|Users)\/[^/]+$/i.test(path)) return true;
  if (/^[A-Za-z]:\/?$/.test(path) || /^[A-Za-z]:\/Users\/[^/]+$/i.test(path)) return true;
  return false;
};

/**
 * Get the display name for a workspace path.
 *
 * When `isTemporaryWorkspace` is true, returns the localized "Temporary
 * Session" label. Otherwise returns the last directory name of the
 * workspace path.
 *
 * The caller must supply `isTemporaryWorkspace` — this function never
 * inspects the path shape to guess. The authoritative signal comes
 * from `conversation.extra.is_temporary_workspace` on the API response.
 */
export const getWorkspaceDisplayName = (
  workspacePath: string,
  isTemporaryWorkspace: boolean,
  t?: (key: string) => string
): string => {
  if (isTemporaryWorkspace) {
    return t ? t('conversation.workspace.temporarySpace') : 'Generated Drafts';
  }
  const parts = splitPathSegments(workspacePath);
  return parts[parts.length - 1] || workspacePath;
};

/**
 * Get the last directory name from a path
 * 从路径中获取最后一级目录名
 */
export const getLastDirectoryName = (path: string): string => {
  const parts = splitPathSegments(path);
  return parts[parts.length - 1] || path;
};
