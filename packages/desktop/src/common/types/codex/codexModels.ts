/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Default Codex model list maintained by AionUi.
 * These are known models that Codex CLI supports.
 * Validation is done by Codex CLI itself — AionUi only passes the model name.
 *
 * The first entry is used as the default when the user hasn't made a selection.
 */
export const DEFAULT_CODEX_MODELS: Array<{ id: string; label: string; description: string }> = [
  { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol', description: 'Latest frontier agentic coding model' },
  { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Frontier model for complex coding and research' },
  { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Strong model for everyday coding' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', description: 'Small, fast, and cost-efficient coding model' },
  { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', description: 'Coding-optimized model' },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark', description: 'Ultra-fast coding model' },
  {
    id: 'gpt-5.2',
    label: 'gpt-5.2',
    description: 'Optimized for professional work and long-running agents',
  },
];
