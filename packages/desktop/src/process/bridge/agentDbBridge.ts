/**
 * Bridge that reads agent_metadata directly from SQLite to get ALL agents
 * including disabled ones (the backend API filters them out).
 */
import path from 'path';
import { ipcBridge } from '@/common';
import { BetterSqlite3Driver } from '../services/database/drivers/BetterSqlite3Driver';

function getDataPath(): string {
  const { app } = require('electron');
  return app.getPath('userData');
}

interface AgentRow {
  id: string;
  icon: string | null;
  name: string;
  name_i18n: string | null;
  description: string | null;
  description_i18n: string | null;
  backend: string | null;
  agent_type: string;
  agent_source: string;
  enabled: number;
  command: string | null;
  args: string | null;
  env: string | null;
  native_skills_dirs: string | null;
  sort_order: number;
}

type AgentType = 'acp' | 'remote' | 'aionrs' | 'openclaw-gateway' | 'nanobot';
type AgentSource = 'internal' | 'builtin' | 'extension' | 'custom';

const AGENT_TYPES = new Set<AgentType>(['acp', 'remote', 'aionrs', 'openclaw-gateway', 'nanobot']);
const AGENT_SOURCES = new Set<AgentSource>(['internal', 'builtin', 'extension', 'custom']);

function normalizeAgentType(value: string): AgentType {
  return AGENT_TYPES.has(value as AgentType) ? (value as AgentType) : 'acp';
}

function normalizeAgentSource(value: string): AgentSource {
  return AGENT_SOURCES.has(value as AgentSource) ? (value as AgentSource) : 'custom';
}

export function initAgentDbBridge(): void {
  ipcBridge.acpConversation.getAllAgentsFromDb.provider(async () => {
    const db = new BetterSqlite3Driver(path.join(getDataPath(), 'aionui-backend.db'));
    try {
      const rows = db
        .prepare(
          `SELECT id, icon, name, name_i18n, description, description_i18n,
                backend, agent_type, agent_source, enabled, command,
                args, env, native_skills_dirs, sort_order
         FROM agent_metadata
         WHERE deleted_at IS NULL
         ORDER BY sort_order`
        )
        .all() as AgentRow[];

      return rows.map((r) => ({
        id: r.id,
        icon: r.icon || undefined,
        name: r.name,
        name_i18n: r.name_i18n ? JSON.parse(r.name_i18n) : {},
        description: r.description || undefined,
        description_i18n: r.description_i18n ? JSON.parse(r.description_i18n) : {},
        backend: r.backend || undefined,
        agent_type: normalizeAgentType(r.agent_type),
        agent_source: normalizeAgentSource(r.agent_source),
        enabled: r.enabled !== 0,
        available: false, // unknown until backend checks PATH
        command: r.command || undefined,
        args: r.args ? JSON.parse(r.args) : [],
        env: r.env ? JSON.parse(r.env) : [],
        native_skills_dirs: r.native_skills_dirs ? JSON.parse(r.native_skills_dirs) : undefined,
        sort_order: r.sort_order,
      }));
    } finally {
      db.close();
    }
  });
}
