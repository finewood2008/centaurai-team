/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Codex handshake metadata may expose synthetic ids such as
 * `gpt-5.6-sol/xhigh` to represent model + reasoning effort. The Codex ACP
 * runtime accepts the base model id during session creation.
 */
export function normalizeAcpModelIdForCreate(backend: string, modelId?: string | null): string | undefined {
  if (typeof modelId !== 'string') {
    return undefined;
  }

  const trimmed = modelId.trim();
  if (!trimmed) {
    return undefined;
  }

  if (backend !== 'codex') {
    return trimmed;
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) {
    return trimmed;
  }

  return trimmed.slice(0, slashIndex);
}
