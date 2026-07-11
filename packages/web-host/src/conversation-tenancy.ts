/**
 * Server-side tenant boundary for LAN/WebUI conversations.
 *
 * aioncore deliberately runs in local/trusted-process mode for the desktop
 * application.  Its conversation APIs therefore cannot use the authenticated
 * WebUI seat as an authorization boundary.  This module provides that boundary
 * in WebHost: it owns a private conversation -> user index, stamps ownership on
 * creates, guards every conversation sub-route, and filters collection/search
 * responses before they reach a LAN browser.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AuthGateIdentity } from './webui-auth-gate.js';

export const CONVERSATION_OWNER_EXTRA_KEY = 'frontend_owner_user_id';
export const ADMIN_CONVERSATION_USER_ID = 'system_default_user';

const OWNER_STORE_VERSION = 1;
const OWNER_STORE_FILE = 'webui-conversation-owners.json';
const MAX_OWNER_CHARS = 256;
const MAX_CONVERSATION_ID_CHARS = 256;
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = 32 * 1024 * 1024;
const BACKEND_TIMEOUT_MS = 10_000;
const MAX_COLLECTION_ROWS = 10_000;
const SEARCH_BACKEND_PAGE_SIZE = 500;
const MAX_SEARCH_PAGES = 20;
const LAN_CONVERSATION_TYPES = new Set(['aionrs', 'acp']);
const ADMIN_ONLY_ASSISTANT_IDS = new Set(['centaurai-butler']);
const LAN_CONVERSATION_WS_EVENTS = new Set([
  'message.stream',
  'message.userCreated',
  'conversation.artifact',
  'turn.completed',
  'conversation.listChanged',
  'confirmation.add',
  'confirmation.update',
  'confirmation.remove',
  'runtime.statusChanged',
]);

type JsonRecord = Record<string, unknown>;

type ConversationRecord = JsonRecord & {
  id: string;
  extra?: JsonRecord;
};

type BackendJsonResponse = {
  status: number;
  headers: Headers;
  body: Buffer;
  json: unknown;
};

type OwnerStoreFile = {
  version: 1;
  owners: Record<string, string>;
};

type TrustedCreateCatalog = {
  providers: JsonRecord[];
  agents: JsonRecord[];
  assistants: JsonRecord[];
};

export type ConversationTenantBoundary = {
  /** True when this module owns the route and has completed the response. */
  handleHttpRequest: (req: IncomingMessage, res: ServerResponse, identity: AuthGateIdentity) => Promise<boolean>;
  /** Resolve access for one conversation id (also used by the WS gateway). */
  ownsConversation: (identity: AuthGateIdentity, conversationId: string) => Promise<boolean>;
  /** Fail-closed event filter for backend WebSocket payloads. */
  shouldForwardWebSocketPayload: (identity: AuthGateIdentity, payload: unknown) => Promise<boolean>;
};

type ConversationTenantBoundaryOptions = {
  backendPort: number;
  /** Server-owned data directory. Omit only for tests/ephemeral hosts. */
  dataDir?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validOwner(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_OWNER_CHARS || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function validConversationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CONVERSATION_ID_CHARS || /[\u0000-\u001f\u007f/\\]/.test(normalized)) {
    return null;
  }
  return normalized;
}

function extractEnvelopeData(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
}

function extractConversation(value: unknown): ConversationRecord | null {
  const candidate = extractEnvelopeData(value);
  if (!isRecord(candidate)) return null;
  const id = validConversationId(candidate.id);
  if (!id) return null;
  return { ...candidate, id };
}

function extractConversationOwner(conversation: unknown): string | null {
  if (!isRecord(conversation) || !isRecord(conversation.extra)) return null;
  return validOwner(conversation.extra[CONVERSATION_OWNER_EXTRA_KEY]);
}

function collectionItems(value: unknown): unknown[] | null {
  const data = extractEnvelopeData(value);
  if (Array.isArray(data)) return data;
  if (isRecord(data) && Array.isArray(data.items)) return data.items;
  return null;
}

function replaceCollection(value: unknown, items: unknown[], total: number, hasMore: boolean): unknown {
  if (Array.isArray(value)) return items;
  if (!isRecord(value)) return { success: true, data: { items, total, has_more: hasMore } };
  const data = extractEnvelopeData(value);
  if (Array.isArray(data)) return { ...value, data: items };
  if (isRecord(data)) {
    return {
      ...value,
      data: {
        ...data,
        items,
        total,
        has_more: hasMore,
      },
    };
  }
  return { success: true, data: { items, total, has_more: hasMore } };
}

function replaceEnvelopeData(value: unknown, data: unknown): unknown {
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'data')) return { ...value, data };
  return data;
}

function safeString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= max && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : undefined;
}

function publicModel(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const output: JsonRecord = {};
  for (const key of ['provider_id', 'model', 'use_model']) {
    const item = safeString(value[key], 256);
    if (item) output[key] = item;
  }
  if (Array.isArray(value.capabilities)) {
    output.capabilities = value.capabilities.filter((item): item is string => typeof item === 'string').slice(0, 50);
  }
  if (typeof value.context_limit === 'number' && Number.isFinite(value.context_limit)) {
    output.context_limit = Math.max(0, Math.trunc(value.context_limit));
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

/** Minimal conversation DTO safe for an authenticated LAN browser. */
function projectConversationForLan(value: unknown): ConversationRecord | null {
  const conversation = extractConversation(value);
  if (!conversation) return null;
  const output: JsonRecord = { id: conversation.id };
  for (const key of ['name', 'type', 'status', 'source']) {
    const item = safeString(conversation[key], key === 'name' ? 1000 : 128);
    if (item) output[key] = item;
  }
  for (const key of ['created_at', 'modified_at', 'updated_at']) {
    if (typeof conversation[key] === 'number' && Number.isFinite(conversation[key] as number)) {
      output[key] = conversation[key];
    }
  }
  if (typeof conversation.pinned === 'boolean') output.pinned = conversation.pinned;

  if (isRecord(conversation.runtime)) {
    const runtime: JsonRecord = {};
    for (const key of ['state', 'task_status']) {
      const item = safeString(conversation.runtime[key], 64);
      if (item) runtime[key] = item;
    }
    for (const key of ['can_send_message', 'has_task', 'is_processing']) {
      if (typeof conversation.runtime[key] === 'boolean') runtime[key] = conversation.runtime[key];
    }
    if (
      typeof conversation.runtime.pending_confirmations === 'number' &&
      Number.isFinite(conversation.runtime.pending_confirmations)
    ) {
      runtime.pending_confirmations = Math.max(0, Math.trunc(conversation.runtime.pending_confirmations));
    }
    output.runtime = runtime;
  }

  const rawExtra = isRecord(conversation.extra) ? conversation.extra : {};
  const extra: JsonRecord = {
    // A browser receives an opaque/no-path workspace. It can still use the
    // scoped `/workspace?path=<relative>` route without learning host paths.
    workspace: '',
    custom_workspace: false,
    is_temporary_workspace: rawExtra.is_temporary_workspace === true,
    default_files: [],
  };
  for (const key of [
    CONVERSATION_OWNER_EXTRA_KEY,
    'backend',
    'agent_id',
    'agent_name',
    'current_model_id',
    'session_mode',
    'preset_assistant_id',
    'team_id',
    'teamId',
  ]) {
    const item = safeString(rawExtra[key], 512);
    if (item) extra[key] = item;
  }
  for (const key of ['pinned', 'is_health_check']) {
    if (typeof rawExtra[key] === 'boolean') extra[key] = rawExtra[key];
  }
  for (const key of ['pinned_at', 'sortOrder']) {
    if (typeof rawExtra[key] === 'number' && Number.isFinite(rawExtra[key] as number)) extra[key] = rawExtra[key];
  }
  if (Array.isArray(rawExtra.skills)) {
    extra.skills = rawExtra.skills.filter((item): item is string => Boolean(safeString(item, 256))).slice(0, 100);
  }
  output.extra = extra;
  const model = publicModel(conversation.model);
  if (model) output.model = model;
  return output as ConversationRecord;
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf-8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendBackendJson(res: ServerResponse, response: BackendJsonResponse, override?: unknown): void {
  const body = override === undefined ? response.body : Buffer.from(JSON.stringify(override), 'utf-8');
  res.writeHead(response.status, {
    // Never reflect backend CORS, Set-Cookie or attacker-influenced content
    // types through this local-mode trust boundary.
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readIncomingBody(req: IncomingMessage): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_REQUEST_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readResponseBody(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.length;
      if (total > MAX_JSON_RESPONSE_BYTES) throw new Error('BACKEND_RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function safeForwardHeaders(req: IncomingMessage, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-encoding': 'identity',
  };
  if (hasBody) headers['content-type'] = 'application/json';
  return headers;
}

async function fetchBackendJson(
  backendPort: number,
  requestPath: string,
  init?: { method?: string; headers?: Record<string, string>; body?: Buffer }
): Promise<BackendJsonResponse> {
  const response = await fetch(`http://127.0.0.1:${backendPort}${requestPath}`, {
    method: init?.method,
    headers: init?.headers,
    body: init?.body ? new Uint8Array(init.body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
  let body = await readResponseBody(response);
  const contentType = response.headers.get('content-type') ?? '';
  if (body.length === 0) body = Buffer.from('null', 'utf-8');
  else if (!/(?:^|\s|;)application\/(?:[a-z0-9.+-]+\+)?json(?:\s|;|$)/i.test(contentType)) {
    throw new Error('INVALID_BACKEND_CONTENT_TYPE');
  }
  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf-8')) as unknown;
  } catch {
    throw new Error('INVALID_BACKEND_RESPONSE');
  }
  return { status: response.status, headers: response.headers, body, json };
}

class ConversationOwnerStore {
  readonly #filePath: string | null;
  #owners = new Map<string, string>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(filePath: string | null) {
    this.#filePath = filePath;
  }

  static async open(dataDir?: string): Promise<ConversationOwnerStore> {
    const filePath = dataDir ? path.join(dataDir, OWNER_STORE_FILE) : null;
    const store = new ConversationOwnerStore(filePath);
    if (!filePath) return store;

    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return store;
      throw new Error(`Cannot read WebUI conversation ownership store: ${(error as Error).message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('WebUI conversation ownership store is corrupt');
    }
    if (!isRecord(parsed) || parsed.version !== OWNER_STORE_VERSION || !isRecord(parsed.owners)) {
      throw new Error('WebUI conversation ownership store has an unsupported format');
    }
    for (const [rawId, rawOwner] of Object.entries(parsed.owners)) {
      const id = validConversationId(rawId);
      const owner = validOwner(rawOwner);
      if (!id || !owner) throw new Error('WebUI conversation ownership store contains invalid entries');
      store.#owners.set(id, owner);
    }
    return store;
  }

  get(conversationId: string): string | undefined {
    return this.#owners.get(conversationId);
  }

  async set(conversationId: string, ownerId: string): Promise<void> {
    await this.setMany([[conversationId, ownerId]]);
  }

  async setMany(entries: Array<[string, string]>): Promise<void> {
    const operation = this.#writeChain
      .catch(() => {})
      .then(async () => {
        const nextOwners = new Map(this.#owners);
        let changed = false;
        for (const [rawId, rawOwner] of entries) {
          const id = validConversationId(rawId);
          const owner = validOwner(rawOwner);
          if (!id || !owner) throw new Error('Invalid conversation ownership entry');
          const current = nextOwners.get(id);
          // Ownership is immutable. This makes a stale/forged backend marker
          // unable to reassign a conversation after WebHost recorded it.
          if (current && current !== owner) continue;
          if (current === owner) continue;
          nextOwners.set(id, owner);
          changed = true;
        }
        if (!changed) return;
        if (this.#filePath) await this.#persist(nextOwners);
        // Commit in-memory authorization only after durable persistence succeeds.
        this.#owners = nextOwners;
      });
    this.#writeChain = operation;
    await operation;
  }

  async #persist(nextOwners: Map<string, string>): Promise<void> {
    if (!this.#filePath) return;
    const owners: Record<string, string> = {};
    for (const [id, owner] of [...nextOwners.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      owners[id] = owner;
    }
    const value: OwnerStoreFile = { version: OWNER_STORE_VERSION, owners };
    const tmp = `${this.#filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    try {
      await fs.rename(tmp, this.#filePath);
    } catch (error) {
      await fs.unlink(tmp).catch(() => {});
      throw error;
    }
  }
}

function requestPathname(rawUrl: string): string | null {
  try {
    const pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function tenantRoute(
  rawUrl: string
):
  | { kind: 'list-or-create' }
  | { kind: 'clone' }
  | { kind: 'active-count' }
  | { kind: 'conversation'; conversationId: string; suffix: string }
  | { kind: 'message-search' }
  | null {
  const pathname = requestPathname(rawUrl);
  if (!pathname) return null;
  if (pathname === '/api/conversations') return { kind: 'list-or-create' };
  if (pathname === '/api/conversations/clone') return { kind: 'clone' };
  if (pathname === '/api/conversations/active-count') return { kind: 'active-count' };
  if (pathname === '/api/messages/search') return { kind: 'message-search' };
  const match = /^\/api\/conversations\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const conversationId = validConversationId(match[1]);
  if (!conversationId) return { kind: 'conversation', conversationId: '', suffix: match[2] ?? '' };
  return { kind: 'conversation', conversationId, suffix: match[2] ?? '' };
}

/** Fast route predicate so StaticServer need not resolve identity for assets. */
export function isConversationTenantHttpRequest(rawUrl: string): boolean {
  return tenantRoute(rawUrl) !== null;
}

function getRequestedLimit(url: URL, fallback: number): number {
  const value = Number(url.searchParams.get('limit'));
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), MAX_COLLECTION_ROWS) : fallback;
}

function paginateConversations(items: unknown[], url: URL): { items: unknown[]; hasMore: boolean } {
  const limit = getRequestedLimit(url, 100);
  const cursor = url.searchParams.get('cursor');
  let start = 0;
  if (cursor) {
    const byId = items.findIndex((item) => isRecord(item) && item.id === cursor);
    if (byId >= 0) start = byId + 1;
    else if (/^\d+$/.test(cursor)) start = Math.min(Number(cursor), items.length);
    else start = items.length;
  }
  const page = items.slice(start, start + limit);
  return { items: page, hasMore: start + page.length < items.length };
}

function paginateSearch(items: unknown[], url: URL): { items: unknown[]; hasMore: boolean } {
  const rawPageSize = Number(url.searchParams.get('page_size'));
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(Math.max(Math.trunc(rawPageSize), 1), 500) : 50;
  const rawPage = Number(url.searchParams.get('page'));
  // aioncore treats both page=0 and page=1 as the first page; preserve that
  // behavior so existing browser pagination remains compatible.
  const page = Number.isFinite(rawPage) ? Math.max(Math.trunc(rawPage), 1) : 1;
  const start = (page - 1) * pageSize;
  const result = items.slice(start, start + pageSize);
  return { items: result, hasMore: start + result.length < items.length };
}

function conversationFromSearchItem(value: unknown): ConversationRecord | null {
  if (!isRecord(value)) return null;
  return extractConversation(value.conversation);
}

function workspacePathIsSafe(rawUrl: string): boolean {
  try {
    const requested = new URL(rawUrl, 'http://127.0.0.1').searchParams.get('path') ?? '';
    if (requested.length > 4096 || requested.includes('\0')) return false;
    const normalized = requested.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
    return !normalized.split('/').some((segment) => segment === '..');
  } catch {
    return false;
  }
}

function isJsonRequest(req: IncomingMessage, body: Buffer): boolean {
  if (body.length === 0) return true;
  const raw = Array.isArray(req.headers['content-type']) ? req.headers['content-type'][0] : req.headers['content-type'];
  if (!raw || !/(?:^|\s|;)application\/(?:[a-z0-9.+-]+\+)?json(?:\s|;|$)/i.test(raw)) return false;
  try {
    JSON.parse(body.toString('utf-8'));
    return true;
  } catch {
    return false;
  }
}

function isAllowedConversationChildRoute(method: string, suffix: string): boolean {
  if (method === 'DELETE' && suffix === '') return true;
  if (method === 'POST' && ['/reset', '/runtime/ensure', '/cancel', '/side-question'].includes(suffix)) return true;
  if (method === 'PUT' && /^\/config-options\/(?:mode|model)$/.test(suffix)) return true;
  if (
    method === 'GET' &&
    ['/messages', '/slash-commands', '/confirmations', '/artifacts', '/workspace'].includes(suffix)
  ) {
    return true;
  }
  // `/openclaw/runtime` is intentionally absent: its DTO includes session_key,
  // cli_path, workspace and identity hashes and is not used by the WebUI.
  if (method === 'GET' && suffix === '/approvals/check') return true;
  if (method === 'GET' && /^\/messages\/[^/]+$/.test(suffix)) return true;
  if (method === 'POST' && /^\/confirmations\/[^/]+\/confirm$/.test(suffix)) return true;
  if (method === 'PATCH' && /^\/artifacts\/[^/]+$/.test(suffix)) return true;
  return false;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) return null;
  return value;
}

function sanitizeChildMutationBody(method: string, suffix: string, value: unknown): JsonRecord | null {
  if (method === 'POST' && (suffix === '/runtime/ensure' || suffix === '/reset')) return {};
  if (!isRecord(value)) return null;
  if (method === 'POST' && suffix === '/cancel') {
    const turnId = boundedText(value.turn_id, 256);
    return turnId ? { turn_id: turnId } : null;
  }
  if (method === 'PUT' && /^\/config-options\/(?:mode|model)$/.test(suffix)) {
    const optionValue = boundedText(value.value, 4_096);
    return optionValue ? { value: optionValue } : null;
  }
  if (method === 'POST' && suffix === '/side-question') {
    const question = boundedText(value.question, 16_000);
    return question ? { question } : null;
  }
  if (method === 'POST' && /^\/confirmations\/[^/]+\/confirm$/.test(suffix)) {
    const messageId = safeString(value.msg_id, 256);
    if (!messageId) return null;
    return { msg_id: messageId, data: value.data, always_allow: false };
  }
  if (method === 'PATCH' && /^\/artifacts\/[^/]+$/.test(suffix)) {
    return ['active', 'pending', 'dismissed', 'saved'].includes(String(value.status)) ? { status: value.status } : null;
  }
  return null;
}

function trustedProviderModel(rawModel: unknown, providers: JsonRecord[]): JsonRecord | null {
  if (!isRecord(rawModel)) return null;
  const requestedProviderId = safeString(rawModel.provider_id, 256) ?? safeString(rawModel.id, 256);
  const provider = providers.find((row) => requestedProviderId && safeString(row.id, 256) === requestedProviderId);
  if (!provider || provider.enabled === false) return null;

  const modelRows = Array.isArray(provider.models) ? provider.models : [];
  const allowedModels = new Set<string>();
  for (const row of modelRows) {
    if (typeof row === 'string') {
      const id = safeString(row, 256);
      if (id) allowedModels.add(id);
    } else if (isRecord(row)) {
      for (const candidate of [row.id, row.name, row.model]) {
        const id = safeString(candidate, 256);
        if (id) allowedModels.add(id);
      }
    }
  }
  const useModel = safeString(rawModel.model, 256) ?? safeString(rawModel.use_model, 256);
  if (!requestedProviderId || !useModel || !allowedModels.has(useModel)) return null;

  // Canonical aioncore wire shape. Provider endpoint/key resolution stays in
  // aioncore; WebHost never copies catalog credentials into a conversation.
  return { provider_id: requestedProviderId, model: useModel };
}

function isLanConversationType(value: unknown): value is string {
  return typeof value === 'string' && LAN_CONVERSATION_TYPES.has(value);
}

function usableCatalogAgent(agent: JsonRecord, type: string): boolean {
  if (safeString(agent.agent_type, 64) !== type || agent.enabled !== true || agent.installed === false) return false;
  const status = safeString(agent.status, 64);
  return !status || status === 'online' || status === 'unchecked';
}

function catalogAgentById(agents: JsonRecord[], agentId: unknown, type: string): JsonRecord | null {
  const id = safeString(agentId, 256);
  if (!id) return null;
  return agents.find((agent) => safeString(agent.id, 256) === id && usableCatalogAgent(agent, type)) ?? null;
}

function catalogAssistantById(assistants: JsonRecord[], assistantId: unknown): JsonRecord | null {
  const id = safeString(assistantId, 256);
  if (!id || ADMIN_ONLY_ASSISTANT_IDS.has(id)) return null;
  return assistants.find((assistant) => safeString(assistant.id, 256) === id && assistant.enabled !== false) ?? null;
}

function assistantAgent(assistant: JsonRecord, agents: JsonRecord[], expectedType: string): JsonRecord | null {
  const agent = catalogAgentById(agents, assistant.agent_id, expectedType);
  if (!agent) return null;
  const embedded = isRecord(assistant.agent) ? safeString(assistant.agent.type, 64) : undefined;
  return embedded && embedded !== expectedType ? null : agent;
}

function catalogOptionValues(agent: JsonRecord, category: 'mode' | 'model'): Set<string> {
  const values = new Set<string>();
  const wrapped = isRecord(agent.config_options) ? agent.config_options.config_options : undefined;
  if (Array.isArray(wrapped)) {
    for (const option of wrapped) {
      if (!isRecord(option) || safeString(option.category, 64) !== category || !Array.isArray(option.options)) continue;
      for (const item of option.options) {
        if (!isRecord(item)) continue;
        const value = safeString(item.value, 512);
        if (value) values.add(value);
      }
    }
  }
  const availability = isRecord(agent[category === 'mode' ? 'available_modes' : 'available_models'])
    ? agent[category === 'mode' ? 'available_modes' : 'available_models']
    : undefined;
  if (isRecord(availability)) {
    const rows = availability[category === 'mode' ? 'available_modes' : 'available_models'];
    if (Array.isArray(rows)) {
      for (const item of rows) {
        if (!isRecord(item)) continue;
        const id = safeString(item.id, 512);
        if (id) values.add(id);
      }
    }
  }
  return values;
}

function trustedAcpAgentFromExtra(extra: JsonRecord, catalog: TrustedCreateCatalog): JsonRecord | null {
  return catalogAgentById(catalog.agents, extra.agent_id, 'acp');
}

function sanitizeCreatePayload(
  value: unknown,
  identity: AuthGateIdentity,
  clone: boolean,
  catalog: TrustedCreateCatalog
): JsonRecord | null {
  if (!isRecord(value)) return null;
  const target = clone ? value.conversation : value;
  if (!isRecord(target)) return null;
  const originalExtra = isRecord(target.extra) ? target.extra : {};
  const type = safeString(target.type, 64);
  const requestedId = target.id === undefined ? undefined : validConversationId(target.id);
  if (target.id !== undefined && !requestedId) return null;
  const name = safeString(target.name, 1000);
  const cleanTarget: JsonRecord = {
    ...(requestedId ? { id: requestedId } : {}),
    ...(name ? { name } : {}),
  };
  const safeBaseExtra: JsonRecord = {
    [CONVERSATION_OWNER_EXTRA_KEY]: identity.userId,
    workspace: '',
    custom_workspace: false,
    is_temporary_workspace: true,
    default_files: [],
  };

  if (type === 'aionrs') {
    const model = trustedProviderModel(target.model, catalog.providers);
    if (!model) return null;
    const presetId = safeString(originalExtra.preset_assistant_id, 256);
    if (presetId) {
      const assistant = catalogAssistantById(catalog.assistants, presetId);
      if (!assistant || !assistantAgent(assistant, catalog.agents, 'aionrs')) return null;
      safeBaseExtra.preset_assistant_id = presetId;
    }
    cleanTarget.type = 'aionrs';
    cleanTarget.model = model;
    cleanTarget.extra = safeBaseExtra;
  } else if (type === 'acp') {
    const presetId = safeString(originalExtra.preset_assistant_id, 256);
    const assistant = presetId ? catalogAssistantById(catalog.assistants, presetId) : null;
    if (presetId && !assistant) return null;
    const agent = assistant
      ? assistantAgent(assistant, catalog.agents, 'acp')
      : catalogAgentById(catalog.agents, originalExtra.agent_id, 'acp');
    if (!agent) return null;
    const agentId = safeString(agent.id, 256);
    const backend = safeString(agent.backend, 256);
    if (!agentId || !backend) return null;
    const requestedBackend = safeString(originalExtra.backend, 256);
    if (requestedBackend && requestedBackend !== backend) return null;
    const agentName = safeString(agent.name, 512);
    cleanTarget.type = 'acp';
    cleanTarget.extra = {
      ...safeBaseExtra,
      agent_id: agentId,
      backend,
      ...(agentName ? { agent_name: agentName } : {}),
      ...(presetId ? { preset_assistant_id: presetId } : {}),
    };
    const requestedMode = safeString(originalExtra.session_mode, 512);
    if (requestedMode && catalogOptionValues(agent, 'mode').has(requestedMode)) {
      (cleanTarget.extra as JsonRecord).session_mode = requestedMode;
    }
    const requestedModel = safeString(originalExtra.current_model_id, 512);
    if (requestedModel && catalogOptionValues(agent, 'model').has(requestedModel)) {
      (cleanTarget.extra as JsonRecord).current_model_id = requestedModel;
    }
  } else {
    // Legacy gateway, remote and nanobot runtimes do not have a server-owned
    // catalog contract suitable for authenticated LAN creation.
    return null;
  }

  return clone ? { conversation: cleanTarget } : cleanTarget;
}

function sanitizePatchPayload(
  value: unknown,
  current: ConversationRecord,
  ownerId: string | null,
  trustedModel?: JsonRecord | null
): JsonRecord | null {
  if (!isRecord(value)) return null;
  const output: JsonRecord = {};
  const name = value.name === undefined ? undefined : safeString(value.name, 1000);
  if (value.name !== undefined && !name) return null;
  if (name) output.name = name;

  if (value.model !== undefined) {
    if (current.type !== 'aionrs' || !trustedModel) return null;
    output.model = trustedModel;
  }

  if (isRecord(value.extra)) {
    const extra: JsonRecord = {};
    if (typeof value.extra.pinned === 'boolean') extra.pinned = value.extra.pinned;
    if (typeof value.extra.pinned_at === 'number' && Number.isFinite(value.extra.pinned_at)) {
      extra.pinned_at = value.extra.pinned_at;
    }
    if (typeof value.extra.sortOrder === 'number' && Number.isFinite(value.extra.sortOrder)) {
      extra.sortOrder = value.extra.sortOrder;
    }
    if (Object.keys(extra).length > 0) {
      if (ownerId) extra[CONVERSATION_OWNER_EXTRA_KEY] = ownerId;
      output.extra = extra;
      output.merge_extra = true;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

function sanitizeMessagePayload(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null;
  const content = boundedText(value.content, 1_000_000);
  if (!content) return null;
  const output: JsonRecord = { content, files: [] };
  const loadingId = safeString(value.loading_id, 256);
  if (loadingId) output.loading_id = loadingId;
  return output;
}

function parseJsonBody(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf-8')) as unknown;
  } catch {
    return null;
  }
}

function jsonBody(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf-8');
}

function eventConversationIds(payload: unknown): string[] {
  if (!isRecord(payload)) return [];
  const eventName =
    typeof payload.name === 'string' ? payload.name : typeof payload.event === 'string' ? payload.event : '';
  const data = payload.data ?? payload.payload;
  if (!isRecord(data)) return [];
  const candidates: unknown[] = [
    data.conversation_id,
    data.conversationId,
    data.session_id,
    data.sessionId,
    data.sender_conversation_id,
    data.senderConversationId,
    isRecord(data.message) ? data.message.conversation_id : undefined,
    isRecord(data.conversation) ? data.conversation.id : undefined,
  ];
  if (isRecord(data.scope) && (data.scope.kind === 'conversation' || data.scope.kind === 'session')) {
    candidates.push(data.scope.id);
  }
  if (eventName.startsWith('conversation.') && eventName !== 'conversation.artifact') candidates.push(data.id);
  const ids = candidates.map(validConversationId).filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

export async function createConversationTenantBoundary(
  opts: ConversationTenantBoundaryOptions
): Promise<ConversationTenantBoundary> {
  const store = await ConversationOwnerStore.open(opts.dataDir);
  const idLocks = new Map<string, Promise<void>>();
  const conversationTypes = new Map<string, string>();

  const withIdLock = async <T>(id: string | null, fn: () => Promise<T>): Promise<T> => {
    if (!id) return fn();
    const previous = idLocks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    idLocks.set(id, queued);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (idLocks.get(id) === queued) idLocks.delete(id);
    }
  };

  const fetchConversation = async (conversationId: string): Promise<ConversationRecord | null> => {
    const response = await fetchBackendJson(
      opts.backendPort,
      `/api/conversations/${encodeURIComponent(conversationId)}`,
      { headers: { accept: 'application/json', 'accept-encoding': 'identity' } }
    );
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) throw new Error('BACKEND_LOOKUP_FAILED');
    const conversation = extractConversation(response.json);
    const type = conversation ? safeString(conversation.type, 64) : undefined;
    if (conversation && type) conversationTypes.set(conversation.id, type);
    return conversation;
  };

  const fetchCatalogRows = async (requestPath: string): Promise<JsonRecord[]> => {
    const response = await fetchBackendJson(opts.backendPort, requestPath, {
      headers: { accept: 'application/json', 'accept-encoding': 'identity' },
    });
    if (response.status < 200 || response.status >= 300) throw new Error('BACKEND_CATALOG_UNAVAILABLE');
    const rows = collectionItems(response.json);
    if (!rows) throw new Error('INVALID_BACKEND_RESPONSE');
    return rows.filter(isRecord);
  };

  const loadTrustedCreateCatalog = async (): Promise<TrustedCreateCatalog> => {
    const [providers, agents, assistants] = await Promise.all([
      fetchCatalogRows('/api/providers'),
      fetchCatalogRows('/api/agents/management'),
      fetchCatalogRows('/api/assistants'),
    ]);
    return { providers, agents, assistants };
  };

  const hasTrustedRuntime = async (conversation: ConversationRecord): Promise<boolean> => {
    const type = safeString(conversation.type, 64);
    const catalog = await loadTrustedCreateCatalog();
    if (type === 'aionrs') return trustedProviderModel(conversation.model, catalog.providers) !== null;
    if (type === 'acp' && isRecord(conversation.extra)) {
      const agent = trustedAcpAgentFromExtra(conversation.extra, catalog);
      const backend = agent ? safeString(agent.backend, 256) : undefined;
      return Boolean(agent && backend && backend === safeString(conversation.extra.backend, 256));
    }
    return false;
  };

  const resolveOwner = async (conversation: ConversationRecord, allowLegacyAdoption = true): Promise<string | null> => {
    const recorded = store.get(conversation.id);
    if (recorded) return recorded;
    const marker = extractConversationOwner(conversation);
    if (marker && allowLegacyAdoption) {
      await store.set(conversation.id, marker);
      return store.get(conversation.id) ?? marker;
    }
    return null;
  };

  const ownsRecord = async (identity: AuthGateIdentity, conversation: ConversationRecord): Promise<boolean> => {
    if (identity.userId === ADMIN_CONVERSATION_USER_ID) return true;
    if (!isLanConversationType(conversation.type)) return false;
    return (await resolveOwner(conversation)) === identity.userId;
  };

  const ownsConversation = async (identity: AuthGateIdentity, conversationId: string): Promise<boolean> => {
    const id = validConversationId(conversationId);
    if (!id) return false;
    const recorded = store.get(id);
    if (identity.userId === ADMIN_CONVERSATION_USER_ID && recorded) return true;
    const cachedType = conversationTypes.get(id);
    if (recorded && cachedType) return recorded === identity.userId && isLanConversationType(cachedType);
    const conversation = await fetchConversation(id);
    if (!conversation) return false;
    return ownsRecord(identity, conversation);
  };

  const filterConversations = async (identity: AuthGateIdentity, items: unknown[]): Promise<unknown[]> => {
    const rows = items.map(extractConversation).filter((item): item is ConversationRecord => item !== null);
    const adoptions: Array<[string, string]> = [];
    for (const row of rows) {
      const type = safeString(row.type, 64);
      if (type) conversationTypes.set(row.id, type);
      if (!store.get(row.id)) {
        const marker = extractConversationOwner(row);
        if (marker) adoptions.push([row.id, marker]);
      }
    }
    await store.setMany(adoptions);
    const visible =
      identity.userId === ADMIN_CONVERSATION_USER_ID
        ? rows
        : rows.filter((row) => isLanConversationType(row.type) && store.get(row.id) === identity.userId);
    return visible.map((row) => {
      const authoritativeOwner = store.get(row.id);
      const withOwner = !authoritativeOwner
        ? row
        : {
            ...row,
            extra: {
              ...(isRecord(row.extra) ? row.extra : {}),
              [CONVERSATION_OWNER_EXTRA_KEY]: authoritativeOwner,
            },
          };
      return projectConversationForLan(withOwner) ?? { id: row.id, extra: {} };
    });
  };

  const handleConversationList = async (
    req: IncomingMessage,
    res: ServerResponse,
    identity: AuthGateIdentity
  ): Promise<void> => {
    const clientUrl = new URL(req.url || '/api/conversations', 'http://127.0.0.1');
    const upstreamUrl = new URL('/api/conversations', 'http://127.0.0.1');
    upstreamUrl.searchParams.set('limit', String(MAX_COLLECTION_ROWS));
    const response = await fetchBackendJson(opts.backendPort, `${upstreamUrl.pathname}${upstreamUrl.search}`, {
      headers: safeForwardHeaders(req, false),
    });
    if (response.status < 200 || response.status >= 300) {
      sendBackendJson(res, response);
      return;
    }
    const rawItems = collectionItems(response.json);
    if (!rawItems) throw new Error('INVALID_BACKEND_RESPONSE');
    const owned = await filterConversations(identity, rawItems);
    const paginated = paginateConversations(owned, clientUrl);
    sendBackendJson(res, response, replaceCollection(response.json, paginated.items, owned.length, paginated.hasMore));
  };

  const handleMessageSearch = async (
    req: IncomingMessage,
    res: ServerResponse,
    identity: AuthGateIdentity
  ): Promise<void> => {
    const clientUrl = new URL(req.url || '/api/messages/search', 'http://127.0.0.1');
    const keyword = clientUrl.searchParams.get('keyword') ?? '';
    if (!keyword.trim() || keyword.length > 4096) {
      sendJson(res, 400, { success: false, error: 'INVALID_SEARCH' });
      return;
    }

    const allItems: unknown[] = [];
    const seen = new Set<string>();
    let template: BackendJsonResponse | null = null;
    for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
      const upstreamUrl = new URL('/api/messages/search', 'http://127.0.0.1');
      upstreamUrl.searchParams.set('keyword', keyword);
      upstreamUrl.searchParams.set('page', String(page));
      upstreamUrl.searchParams.set('page_size', String(SEARCH_BACKEND_PAGE_SIZE));
      const response = await fetchBackendJson(opts.backendPort, `${upstreamUrl.pathname}${upstreamUrl.search}`, {
        headers: safeForwardHeaders(req, false),
      });
      template ??= response;
      if (response.status < 200 || response.status >= 300) {
        sendBackendJson(res, response);
        return;
      }
      const rows = collectionItems(response.json);
      if (!rows) throw new Error('INVALID_BACKEND_RESPONSE');
      let added = 0;
      for (const row of rows) {
        const key = isRecord(row) && typeof row.message_id === 'string' ? row.message_id : JSON.stringify(row);
        if (seen.has(key)) continue;
        seen.add(key);
        allItems.push(row);
        added += 1;
      }
      const data = extractEnvelopeData(response.json);
      const hasMore = isRecord(data) && data.has_more === true;
      if (!hasMore || rows.length === 0 || added === 0 || allItems.length >= MAX_COLLECTION_ROWS) break;
    }
    if (!template) throw new Error('INVALID_BACKEND_RESPONSE');

    const conversations = allItems
      .map(conversationFromSearchItem)
      .filter((item): item is ConversationRecord => item !== null);
    await filterConversations(identity, conversations);
    const owned =
      identity.userId === ADMIN_CONVERSATION_USER_ID
        ? allItems
        : allItems.filter((item) => {
            const conversation = conversationFromSearchItem(item);
            return Boolean(
              conversation && conversation.type === 'aionrs' && store.get(conversation.id) === identity.userId
            );
          });
    const projected = owned.map((item) => {
      if (!isRecord(item)) return item;
      const conversation = conversationFromSearchItem(item);
      if (!conversation) return item;
      const authoritativeOwner = store.get(conversation.id);
      if (!authoritativeOwner) return item;
      const projectedConversation = projectConversationForLan({
        ...conversation,
        extra: {
          ...(isRecord(conversation.extra) ? conversation.extra : {}),
          [CONVERSATION_OWNER_EXTRA_KEY]: authoritativeOwner,
        },
      });
      return {
        ...item,
        conversation: projectedConversation ?? { id: conversation.id, extra: {} },
      };
    });
    const paginated = paginateSearch(projected, clientUrl);
    sendBackendJson(
      res,
      template,
      replaceCollection(template.json, paginated.items, projected.length, paginated.hasMore)
    );
  };

  const handleCreate = async (
    req: IncomingMessage,
    res: ServerResponse,
    identity: AuthGateIdentity,
    clone: boolean
  ): Promise<void> => {
    const body = await readIncomingBody(req);
    if (!isJsonRequest(req, body)) {
      sendJson(res, 415, { success: false, error: 'JSON_REQUIRED' });
      return;
    }
    const catalog = await loadTrustedCreateCatalog();
    const sanitized = sanitizeCreatePayload(parseJsonBody(body), identity, clone, catalog);
    if (!sanitized) {
      sendJson(res, 400, { success: false, error: 'INVALID_CONVERSATION' });
      return;
    }
    const target = clone && isRecord(sanitized.conversation) ? sanitized.conversation : sanitized;
    const requestedId = validConversationId(target.id);
    if (target.id !== undefined && !requestedId) {
      sendJson(res, 400, { success: false, error: 'INVALID_CONVERSATION_ID' });
      return;
    }

    await withIdLock(requestedId, async () => {
      if (requestedId) {
        const recorded = store.get(requestedId);
        const existing = await fetchConversation(requestedId);
        if (recorded || existing) {
          sendJson(res, 409, { success: false, error: 'CONVERSATION_ID_EXISTS' });
          return;
        }
      }
      const endpoint = clone ? '/api/conversations/clone' : '/api/conversations';
      const rewritten = jsonBody(sanitized);
      const response = await fetchBackendJson(opts.backendPort, endpoint, {
        method: 'POST',
        headers: safeForwardHeaders(req, true),
        body: rewritten,
      });
      if (response.status < 200 || response.status >= 300) {
        sendBackendJson(res, response);
        return;
      }
      const created = extractConversation(response.json);
      if (!created || extractConversationOwner(created) !== identity.userId) {
        if (created) {
          await fetch(`http://127.0.0.1:${opts.backendPort}/api/conversations/${encodeURIComponent(created.id)}`, {
            method: 'DELETE',
            redirect: 'error',
            signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
          }).catch(() => {});
        }
        sendJson(res, 502, { success: false, error: 'OWNERSHIP_PERSISTENCE_FAILED' });
        return;
      }
      try {
        await store.set(created.id, identity.userId);
        const createdType = safeString(created.type, 64);
        if (createdType) conversationTypes.set(created.id, createdType);
      } catch {
        // Do not leave an unindexed conversation behind. Without a durable
        // owner it would become ambiguous after restart and could later be
        // adopted from mutable backend metadata.
        await fetch(`http://127.0.0.1:${opts.backendPort}/api/conversations/${encodeURIComponent(created.id)}`, {
          method: 'DELETE',
          redirect: 'error',
          signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
        }).catch(() => {});
        sendJson(res, 502, { success: false, error: 'OWNERSHIP_PERSISTENCE_FAILED' });
        return;
      }
      sendBackendJson(res, response, replaceEnvelopeData(response.json, projectConversationForLan(created)));
    });
  };

  const handleActiveCount = async (
    req: IncomingMessage,
    res: ServerResponse,
    identity: AuthGateIdentity
  ): Promise<void> => {
    const response = await fetchBackendJson(opts.backendPort, `/api/conversations?limit=${MAX_COLLECTION_ROWS}`, {
      headers: safeForwardHeaders(req, false),
    });
    if (response.status < 200 || response.status >= 300) {
      sendBackendJson(res, response);
      return;
    }
    const rows = collectionItems(response.json);
    if (!rows) throw new Error('INVALID_BACKEND_RESPONSE');
    const owned = await filterConversations(identity, rows);
    const count = owned.filter((row) => {
      if (!isRecord(row)) return false;
      if (row.status === 'running' || row.status === 'pending') return true;
      return isRecord(row.runtime) && row.runtime.is_processing === true;
    }).length;
    sendJson(res, 200, { success: true, data: { count } });
  };

  const handleGuardedConversation = async (
    req: IncomingMessage,
    res: ServerResponse,
    identity: AuthGateIdentity,
    conversationId: string,
    suffix: string
  ): Promise<void> => {
    if (!conversationId) {
      sendJson(res, 400, { success: false, error: 'INVALID_CONVERSATION_ID' });
      return;
    }
    const current = await fetchConversation(conversationId);
    if (!current || !(await ownsRecord(identity, current))) {
      // Deliberately use 404 for cross-tenant rows to avoid confirming ids.
      sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
      return;
    }
    const owner = await resolveOwner(current);

    if (suffix === '/workspace' && !workspacePathIsSafe(req.url || '')) {
      sendJson(res, 400, { success: false, error: 'INVALID_WORKSPACE_PATH' });
      return;
    }

    if (req.method === 'GET' && suffix === '') {
      // The authorization lookup already fetched the exact resource.
      const projected = owner
        ? {
            ...current,
            extra: {
              ...(isRecord(current.extra) ? current.extra : {}),
              [CONVERSATION_OWNER_EXTRA_KEY]: owner,
            },
          }
        : current;
      sendJson(res, 200, { success: true, data: projectConversationForLan(projected) });
      return;
    }

    if (req.method === 'GET' && suffix === '/associated') {
      const response = await fetchBackendJson(opts.backendPort, req.url || '', {
        headers: safeForwardHeaders(req, false),
      });
      if (response.status < 200 || response.status >= 300) {
        sendBackendJson(res, response);
        return;
      }
      const rows = collectionItems(response.json);
      if (!rows) throw new Error('INVALID_BACKEND_RESPONSE');
      const owned = await filterConversations(identity, rows);
      sendBackendJson(res, response, replaceCollection(response.json, owned, owned.length, false));
      return;
    }

    if (req.method === 'PATCH' && suffix === '') {
      const body = await readIncomingBody(req);
      if (!isJsonRequest(req, body)) {
        sendJson(res, 415, { success: false, error: 'JSON_REQUIRED' });
        return;
      }
      const parsed = parseJsonBody(body);
      let trustedModel: JsonRecord | null | undefined;
      if (isRecord(parsed) && parsed.model !== undefined) {
        const catalog = await loadTrustedCreateCatalog();
        trustedModel = trustedProviderModel(parsed.model, catalog.providers);
      }
      const sanitized = sanitizePatchPayload(parsed, current, owner, trustedModel);
      if (!sanitized) {
        sendJson(res, 400, { success: false, error: 'INVALID_REQUEST' });
        return;
      }
      const rewritten = jsonBody(sanitized);
      const response = await fetchBackendJson(opts.backendPort, req.url || '', {
        method: 'PATCH',
        headers: safeForwardHeaders(req, true),
        body: rewritten,
      });
      sendBackendJson(res, response);
      return;
    }

    if (req.method === 'POST' && suffix === '/messages') {
      if (!(await hasTrustedRuntime(current))) {
        sendJson(res, 403, { success: false, error: 'UNSAFE_RUNTIME' });
        return;
      }
      const body = await readIncomingBody(req);
      if (!isJsonRequest(req, body)) {
        sendJson(res, 415, { success: false, error: 'JSON_REQUIRED' });
        return;
      }
      const sanitized = sanitizeMessagePayload(parseJsonBody(body));
      if (!sanitized) {
        sendJson(res, 400, { success: false, error: 'INVALID_REQUEST' });
        return;
      }
      const rewritten = jsonBody(sanitized);
      const response = await fetchBackendJson(opts.backendPort, req.url || '', {
        method: 'POST',
        headers: safeForwardHeaders(req, true),
        body: rewritten,
      });
      sendBackendJson(res, response);
      return;
    }

    if (!isAllowedConversationChildRoute(req.method || '', suffix)) {
      sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
      return;
    }

    const needsTrustedRuntime =
      (req.method === 'POST' &&
        (suffix === '/runtime/ensure' ||
          suffix === '/side-question' ||
          /^\/confirmations\/[^/]+\/confirm$/.test(suffix))) ||
      (req.method === 'PUT' && /^\/config-options\/(?:mode|model)$/.test(suffix));
    if (needsTrustedRuntime && !(await hasTrustedRuntime(current))) {
      sendJson(res, 403, { success: false, error: 'UNSAFE_RUNTIME' });
      return;
    }

    const isMutation = req.method !== 'GET' && req.method !== 'DELETE';
    const body = isMutation ? await readIncomingBody(req) : Buffer.alloc(0);
    if (isMutation && !isJsonRequest(req, body)) {
      sendJson(res, 415, { success: false, error: 'JSON_REQUIRED' });
      return;
    }
    const outgoing = isMutation ? sanitizeChildMutationBody(req.method || '', suffix, parseJsonBody(body)) : undefined;
    if (isMutation && !outgoing) {
      sendJson(res, 400, { success: false, error: 'INVALID_REQUEST' });
      return;
    }
    if (req.method === 'PUT' && /^\/config-options\/(?:mode|model)$/.test(suffix) && current.type === 'acp') {
      const catalog = await loadTrustedCreateCatalog();
      const agent = isRecord(current.extra) ? trustedAcpAgentFromExtra(current.extra, catalog) : null;
      const category = suffix.endsWith('/mode') ? 'mode' : 'model';
      if (!agent || !catalogOptionValues(agent, category).has(safeString(outgoing?.value, 512) ?? '')) {
        sendJson(res, 400, { success: false, error: 'INVALID_CONFIG_OPTION' });
        return;
      }
    }
    const outgoingBody = outgoing ? jsonBody(outgoing) : undefined;
    const response = await fetchBackendJson(opts.backendPort, req.url || '', {
      method: req.method,
      headers: safeForwardHeaders(req, Boolean(outgoingBody)),
      body: outgoingBody,
    });
    sendBackendJson(res, response);
  };

  return {
    ownsConversation,

    async shouldForwardWebSocketPayload(identity, payload): Promise<boolean> {
      if (!isRecord(payload)) return false;
      const eventName = typeof payload.name === 'string' ? payload.name : payload.event;
      if (eventName === 'ping' || eventName === 'pong') return false;
      if (typeof eventName !== 'string' || !LAN_CONVERSATION_WS_EVENTS.has(eventName)) return false;
      const ids = eventConversationIds(payload);
      // Global/backend events are not tenant scoped and may contain host paths,
      // settings or other users' activity. They are therefore denied in LAN mode.
      if (ids.length === 0) return false;
      const decisions = await Promise.all(ids.map((id) => ownsConversation(identity, id)));
      return decisions.every(Boolean);
    },

    async handleHttpRequest(req, res, identity): Promise<boolean> {
      const route = tenantRoute(req.url || '');
      if (!route) return false;
      try {
        if (route.kind === 'list-or-create') {
          if (req.method === 'GET') await handleConversationList(req, res, identity);
          else if (req.method === 'POST') await handleCreate(req, res, identity, false);
          else sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
          return true;
        }
        if (route.kind === 'clone') {
          if (req.method === 'POST') await handleCreate(req, res, identity, true);
          else sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
          return true;
        }
        if (route.kind === 'active-count') {
          if (req.method === 'GET') await handleActiveCount(req, res, identity);
          else sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
          return true;
        }
        if (route.kind === 'message-search') {
          if (req.method === 'GET') await handleMessageSearch(req, res, identity);
          else sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
          return true;
        }
        await handleGuardedConversation(req, res, identity, route.conversationId, route.suffix);
        return true;
      } catch (error) {
        if (res.headersSent) {
          res.destroy();
          return true;
        }
        const message = error instanceof Error ? error.message : '';
        if (message === 'REQUEST_TOO_LARGE') {
          sendJson(res, 413, { success: false, error: 'REQUEST_TOO_LARGE' });
        } else if (message === 'BACKEND_RESPONSE_TOO_LARGE') {
          sendJson(res, 502, { success: false, error: 'BACKEND_RESPONSE_TOO_LARGE' });
        } else if (message === 'INVALID_BACKEND_RESPONSE' || message === 'INVALID_BACKEND_CONTENT_TYPE') {
          sendJson(res, 502, { success: false, error: 'INVALID_BACKEND_RESPONSE' });
        } else {
          sendJson(res, 502, { success: false, error: 'BACKEND_UNREACHABLE' });
        }
        return true;
      }
    },
  };
}
