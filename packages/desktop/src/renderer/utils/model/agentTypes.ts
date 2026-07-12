/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';

/** SWR key for agent metadata rows adapted from `/api/agents/management`. */
export const DETECTED_AGENTS_SWR_KEY = 'agents.detected';
/** SWR key for the complete management catalog, including unavailable rows. */
export const MANAGED_AGENTS_SWR_KEY = 'agents.managed';

/** Type of an agent. */
export type AgentType = 'acp' | 'remote' | 'aionrs' | 'openclaw-gateway' | 'nanobot';

/** Source tier of an agent row, mirroring backend `agent_source` enum. */
export type AgentSource = 'internal' | 'builtin' | 'extension' | 'custom';

/** Source-specific bookkeeping (how to probe, how to upgrade). */
export type AgentSourceInfo = {
  binary_name?: string;
  bridge_binary?: string;
  hub_package_id?: string;
  version?: string;
};

/** Environment variable entry passed to a spawned agent process. */
export type AgentEnvEntry = {
  name: string;
  value: string;
  description?: string;
};

/**
 * Adapter-side behaviour switches. New flags are added here by extending
 * the struct on the backend — the frontend should read them defensively
 * because older rows may not have every field populated.
 *
 * Whether the agent supports session/load is NOT in this bag — read
 * `handshake.agent_capabilities.load_session` instead, since the CLI
 * advertises that during init.
 */
export type BehaviorPolicy = {
  supports_side_question?: boolean;
  /** Authoritative team-mode capability — true only when the backend can be
   *  injected with the team-coordination MCP tools. Prefer this over the
   *  top-level `team_capable`, which is uniformly true and non-discriminating. */
  supports_team?: boolean;
};

/**
 * Handshake-derived fields captured from the ACP init/session-response.
 * Each field is opaque JSON the backend passes through verbatim; typing
 * happens in whatever call site actually consumes it.
 */
export type AgentHandshake = {
  agent_capabilities?: unknown;
  auth_methods?: unknown;
  config_options?: unknown;
  available_modes?: unknown;
  available_models?: unknown;
  available_commands?: unknown;
};

/**
 * Unified agent metadata adapted from Core's `/api/agents/management` response.
 *
 * Replaces the old split of `DetectedAgent` / `AvailableAgent` — the
 * backend now stores the same shape in the `agent_metadata` table,
 * caches it in-process, and serves it directly over HTTP.
 */
export type AgentMetadata = {
  id: string;
  icon?: string;
  name: string;
  name_i18n?: Record<string, string>;
  description?: string;
  description_i18n?: Record<string, string>;

  /** Vendor label (e.g. "claude"). Absent for agents without vendor grouping. */
  backend?: string;
  /** Top-level runtime discriminant: "acp" | "remote" | "nanobot" | "aionrs" | … */
  agent_type: AgentType;
  agent_source: AgentSource;
  agent_source_info?: AgentSourceInfo;

  enabled: boolean;
  /** True iff the backend resolved the spawn command on `$PATH` at hydrate time. */
  available: boolean;
  /** Diagnostics-first state from Core's management catalog. */
  management_status?: 'online' | 'unchecked' | 'missing' | 'offline';
  /** Whether the CLI binary was found on PATH (from backend). */
  installed?: boolean;
  /** Last health check status. */
  last_check_status?: 'online' | 'offline';
  /** Last health check error code. */
  last_check_error_code?: string;
  /** Last health check error message (user-facing). */
  last_check_error_message?: string;
  /** Last health check guidance (actionable fix hint). */
  last_check_guidance?: string;
  /** Last health check latency in ms. */
  last_check_latency_ms?: number;
  /** Timestamp of last health check. */
  last_check_at?: number;
  /** True when the agent supports team mode (MCP stdio capable). Computed by backend. */
  team_capable?: boolean;

  /** Pre-resolution spawn command as stored in the catalog (e.g. "bun"). */
  command?: string;
  args?: string[];
  env?: AgentEnvEntry[];
  native_skills_dirs?: string[];

  behavior_policy?: BehaviorPolicy;

  /** Native mode id that AionUi's legacy `yolo` / `yoloNoSandbox`
   *  aliases resolve to before calling `session/set_mode`. Absent
   *  when the backend has no yolo equivalent. */
  yolo_id?: string;

  handshake?: AgentHandshake;
};

export function getAgentDisplayName(
  agent: { agent_type?: string; backend?: string; name?: string } | undefined
): string {
  if (!agent) return '';
  const key = (agent.backend || agent.agent_type || '').toLowerCase();
  if (key === 'aionrs' || key === 'aion-cli') return 'CentaurAI';
  if (/^aion\s*cli$/i.test(agent.name || '') || /^aioncli$/i.test(agent.name || '')) return 'CentaurAI';
  return agent.name || agent.backend || agent.agent_type || '';
}

/** Shared fetcher for DETECTED_AGENTS_SWR_KEY — single source of truth. */
export async function fetchDetectedAgents(): Promise<AgentMetadata[]> {
  try {
    const agents = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    if (Array.isArray(agents)) {
      return agents as AgentMetadata[];
    }
  } catch {
    // fallback to empty
  }
  return [];
}

/** Shared fetcher for the settings management surface. */
export async function fetchManagedAgents(): Promise<AgentMetadata[]> {
  try {
    const agents = await ipcBridge.acpConversation.getManagedAgents.invoke();
    if (Array.isArray(agents)) return agents as AgentMetadata[];
  } catch {
    // The settings surface renders its empty state while Core is unavailable.
  }
  return [];
}

/**
 * Extract the list of MCP transport types an agent supports.
 *
 * Reads `handshake.agent_capabilities.mcp_capabilities.{stdio,http,sse}`
 * (populated by the ACP init response). Returns `undefined` when the
 * agent has not completed a handshake — callers should treat that as
 * "unknown" rather than "nothing supported".
 */
export function getSupportedMcpTransports(agent: AgentMetadata): string[] | undefined {
  const caps = (agent.handshake?.agent_capabilities as { mcp_capabilities?: unknown } | undefined)?.mcp_capabilities;
  if (!caps || typeof caps !== 'object') {
    return undefined;
  }
  const flags = caps as { stdio?: unknown; http?: unknown; sse?: unknown };
  const transports: string[] = [];
  if (flags.stdio === true) transports.push('stdio');
  if (flags.http === true) transports.push('http');
  if (flags.sse === true) transports.push('sse');
  return transports;
}
