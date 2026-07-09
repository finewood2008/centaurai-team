/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { TChatConversation } from '@/common/config/storage';
import { isConversationVisibleForCurrentUser } from '@/common/utils/frontendUserScope';
import { buildConversationVisibilityScope } from '@/renderer/utils/user/conversationVisibility';
import { mutate } from 'swr';

type ConversationWorkspaceExtra = NonNullable<TChatConversation['extra']> & {
  is_temporary_workspace?: boolean;
};

export async function getConversationOrNull(conversation_id: string): Promise<TChatConversation | null> {
  try {
    const conversation = await ipcBridge.conversation.get.invoke({ id: conversation_id });
    if (!conversation) return null;
    const visibilityScope = await buildConversationVisibilityScope();
    return isConversationVisibleForCurrentUser(conversation, visibilityScope) ? conversation : null;
  } catch (error) {
    if (isBackendHttpError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

export function mergeConversationWorkspace<T extends TChatConversation | null | undefined>(
  conversation: T,
  workspace: string
): T {
  const resolvedWorkspace = workspace.trim();
  if (!conversation || !resolvedWorkspace) return conversation;

  const extra = conversation.extra ?? {};
  const workspaceExtra = extra as ConversationWorkspaceExtra;
  const inferredTemporary =
    workspaceExtra.is_temporary_workspace ?? (workspaceExtra.custom_workspace === false ? true : undefined);
  const nextExtra = {
    ...extra,
    workspace: resolvedWorkspace,
    ...(inferredTemporary === undefined ? {} : { is_temporary_workspace: inferredTemporary }),
  };

  if (
    workspaceExtra.workspace === resolvedWorkspace &&
    workspaceExtra.is_temporary_workspace === nextExtra.is_temporary_workspace
  ) {
    return conversation;
  }

  return {
    ...conversation,
    extra: nextExtra,
  } as T;
}

export async function refreshConversationCache(conversation_id: string): Promise<void> {
  const conversation = await getConversationOrNull(conversation_id);
  if (!conversation) return;

  await mutate<TChatConversation>(`conversation/${conversation_id}`, conversation, false);
}
