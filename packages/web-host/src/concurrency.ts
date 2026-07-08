import os from 'node:os';

export type ConcurrencyProfileName = 'team-32g' | 'team-64g';

export type RequestClass =
  | 'agent_run'
  | 'team_run'
  | 'team_agent_run'
  | 'file_upload'
  | 'nas_list'
  | 'vector_search'
  | 'vector_image';

export type ClassifiedRequest = {
  kind: RequestClass;
  units: number;
  conversationId?: string;
  queueable: boolean;
};

export type ConcurrencyLimits = {
  activeRunUnits: number;
  activeTeamRunUnits: number;
  queueLimit: number;
  perUserActiveRuns: number;
  perConversationActiveRuns: number;
  externalModelRequests: number;
  heavyToolCalls: number;
  fileUploads: number;
  vectorSearch: number;
  nasList: number;
  nasIndex: number;
  websocketConnections: number;
  maxTeamRunUnits: number;
  queuedRequestTimeoutMs: number;
};

export type ConcurrencyProfile = {
  name: ConcurrencyProfileName;
  limits: ConcurrencyLimits;
};

export type ConcurrencyOptions = {
  profile?: ConcurrencyProfileName;
  overrides?: Partial<ConcurrencyLimits>;
  memory?: MemoryGuardOptions | false;
};

export type MemoryPressureState = 'normal' | 'soft' | 'hard';

export type MemoryGuardOptions = {
  getUsedRatio?: () => number;
  softLimit?: number;
  hardLimit?: number;
  queueDrainIntervalMs?: number;
};

export type AdmissionRequest = {
  kind: RequestClass;
  units: number;
  userId: string;
  conversationId?: string;
  abortSignal?: AbortSignal;
};

export type AdmissionErrorCode =
  | 'DEVICE_BUSY'
  | 'QUEUE_FULL'
  | 'RUN_QUEUED'
  | 'RUN_CANCELLED'
  | 'RUN_TIMEOUT'
  | 'MEMORY_PRESSURE'
  | 'PER_USER_LIMIT'
  | 'PER_CONVERSATION_LIMIT'
  | 'EDITION_DISABLED';

export type AdmissionErrorDetails = {
  reason: string;
  profile: ConcurrencyProfileName;
  active: number;
  limit: number;
  queued: number;
  queue_limit: number;
};

export class AdmissionRejectedError extends Error {
  readonly code: AdmissionErrorCode;
  readonly status: number;
  readonly details: AdmissionErrorDetails;

  constructor(code: AdmissionErrorCode, status: number, message: string, details: AdmissionErrorDetails) {
    super(message);
    this.name = 'AdmissionRejectedError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type AdmissionTicket = {
  id: string;
  kind: RequestClass;
  units: number;
  queued: boolean;
  queueWaitMs: number;
  release: () => void;
};

type ActiveTicket = {
  id: string;
  kind: RequestClass;
  units: number;
  userId: string;
  conversationId?: string;
  startedAt: number;
};

type QueuedRequest = AdmissionRequest & {
  id: string;
  enqueuedAt: number;
  resolve: (ticket: AdmissionTicket) => void;
  reject: (err: AdmissionRejectedError) => void;
  timeout: ReturnType<typeof setTimeout>;
  cleanupAbort?: () => void;
};

const PROFILES: Record<ConcurrencyProfileName, ConcurrencyProfile> = {
  'team-32g': {
    name: 'team-32g',
    limits: {
      activeRunUnits: 4,
      activeTeamRunUnits: 1,
      queueLimit: 30,
      perUserActiveRuns: 1,
      perConversationActiveRuns: 1,
      externalModelRequests: 6,
      heavyToolCalls: 3,
      fileUploads: 2,
      vectorSearch: 6,
      nasList: 2,
      nasIndex: 1,
      websocketConnections: 100,
      maxTeamRunUnits: 3,
      queuedRequestTimeoutMs: 120_000,
    },
  },
  'team-64g': {
    name: 'team-64g',
    limits: {
      activeRunUnits: 8,
      activeTeamRunUnits: 2,
      queueLimit: 50,
      perUserActiveRuns: 1,
      perConversationActiveRuns: 1,
      externalModelRequests: 12,
      heavyToolCalls: 6,
      fileUploads: 4,
      vectorSearch: 8,
      nasList: 4,
      nasIndex: 1,
      websocketConnections: 150,
      maxTeamRunUnits: 4,
      queuedRequestTimeoutMs: 120_000,
    },
  },
};

export function getConcurrencyProfile(
  name: ConcurrencyProfileName = 'team-32g',
  overrides: Partial<ConcurrencyLimits> = {}
): ConcurrencyProfile {
  const profile = PROFILES[name];
  return { name: profile.name, limits: { ...profile.limits, ...overrides } };
}

export function classifyRequest(method: string, rawUrl: string): ClassifiedRequest | null {
  const path = safePath(rawUrl);
  const normalizedMethod = method.toUpperCase();

  const agentRun = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path);
  if (normalizedMethod === 'POST' && agentRun) {
    return {
      kind: 'agent_run',
      units: 1,
      conversationId: decodeURIComponent(agentRun[1] ?? ''),
      queueable: true,
    };
  }

  if (normalizedMethod === 'POST' && /^\/api\/teams\/[^/]+\/messages$/.test(path)) {
    return { kind: 'team_run', units: 3, queueable: true };
  }

  if (normalizedMethod === 'POST' && /^\/api\/teams\/[^/]+\/agents\/[^/]+\/messages$/.test(path)) {
    return { kind: 'team_agent_run', units: 1, queueable: true };
  }

  if (
    normalizedMethod === 'POST' &&
    (path === '/api/fs/upload' || path === '/api/shared-drive/upload' || path === '/api/nas/upload')
  ) {
    return { kind: 'file_upload', units: 1, queueable: false };
  }

  if (normalizedMethod === 'GET' && path === '/api/nas/list') {
    return { kind: 'nas_list', units: 1, queueable: false };
  }

  if (normalizedMethod === 'POST' && path === '/api/vector-search') {
    return { kind: 'vector_search', units: 1, queueable: false };
  }

  if (normalizedMethod === 'GET' && path === '/api/vector-image') {
    return { kind: 'vector_image', units: 1, queueable: false };
  }

  return null;
}

export class AdmissionController {
  private readonly profile: ConcurrencyProfile;
  private readonly memoryGuard: Required<MemoryGuardOptions> | null;
  private readonly active = new Map<string, ActiveTicket>();
  private readonly queue: QueuedRequest[] = [];
  private queueDrainTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;

  constructor(options: ConcurrencyOptions = {}) {
    this.profile = getConcurrencyProfile(options.profile, options.overrides);
    this.memoryGuard =
      options.memory === undefined || options.memory === false
        ? null
        : {
            getUsedRatio: options.memory.getUsedRatio ?? defaultSystemMemoryUsedRatio,
            softLimit: options.memory.softLimit ?? 0.8,
            hardLimit: options.memory.hardLimit ?? 0.9,
            queueDrainIntervalMs: options.memory.queueDrainIntervalMs ?? 1_000,
          };
  }

  async acquire(request: AdmissionRequest): Promise<AdmissionTicket> {
    const immediateRejection = this.findRejection(request);
    if (!immediateRejection) return this.activate(request, false, Date.now());

    if (
      !isRunClass(request.kind) ||
      immediateRejection.code === 'MEMORY_PRESSURE' ||
      immediateRejection.code === 'PER_USER_LIMIT' ||
      immediateRejection.code === 'PER_CONVERSATION_LIMIT'
    ) {
      if (isRunClass(request.kind) && immediateRejection.details.reason === 'memory_pressure_soft') {
        this.assertRunQueueAdmissionAllowed(request);
        return this.enqueue(request);
      }
      throw immediateRejection;
    }
    if (!this.hasQueueCapacity()) {
      if (this.profile.limits.queueLimit > 0) throw this.reject('QUEUE_FULL', 'queue_full', request);
      throw immediateRejection;
    }
    if (this.hasQueuedForUser(request.userId)) throw this.reject('PER_USER_LIMIT', 'per_user_limit', request);
    if (request.conversationId && this.hasQueuedForConversation(request.conversationId)) {
      throw this.reject('PER_CONVERSATION_LIMIT', 'per_conversation_limit', request);
    }

    return this.enqueue(request);
  }

  getStatus() {
    const activeByClass = emptyClassRecord();
    let activeRunUnits = 0;
    let activeTeamRunUnits = 0;
    for (const ticket of this.active.values()) {
      activeByClass[ticket.kind] += ticket.units;
      if (isRunClass(ticket.kind)) activeRunUnits += ticket.units;
      if (ticket.kind === 'team_run') activeTeamRunUnits += ticket.units;
    }

    return {
      profile: this.profile.name,
      limits: this.profile.limits,
      memoryPressure: this.getMemoryPressure(),
      active: activeByClass,
      activeRunUnits,
      activeTeamRunUnits,
      queues: {
        agent_run: this.queue.filter((q) => q.kind === 'agent_run').map(summarizeQueuedRequest),
        team_run: this.queue.filter((q) => q.kind === 'team_run').map(summarizeQueuedRequest),
        team_agent_run: this.queue.filter((q) => q.kind === 'team_agent_run').map(summarizeQueuedRequest),
        total: this.queue.length,
        oldestWaitMs: this.queue.length > 0 ? Date.now() - Math.min(...this.queue.map((q) => q.enqueuedAt)) : 0,
      },
    };
  }

  private activate(request: AdmissionRequest, queued: boolean, enqueuedAt: number): AdmissionTicket {
    const id = this.allocateId();
    const active: ActiveTicket = {
      id,
      kind: request.kind,
      units: request.units,
      userId: request.userId,
      conversationId: request.conversationId,
      startedAt: Date.now(),
    };
    this.active.set(id, active);

    let released = false;
    return {
      id,
      kind: request.kind,
      units: request.units,
      queued,
      queueWaitMs: queued ? Date.now() - enqueuedAt : 0,
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(id);
        this.drainQueue();
      },
    };
  }

  private drainQueue(): void {
    if (this.queueDrainTimer) {
      clearTimeout(this.queueDrainTimer);
      this.queueDrainTimer = null;
    }
    for (let i = 0; i < this.queue.length; i++) {
      const queued = this.queue[i];
      if (!queued || this.findRejection(queued)) continue;
      this.queue.splice(i, 1);
      clearTimeout(queued.timeout);
      queued.cleanupAbort?.();
      queued.resolve(this.activate(queued, true, queued.enqueuedAt));
      i--;
    }
    this.scheduleQueueDrain();
  }

  private findRejection(request: AdmissionRequest): AdmissionRejectedError | null {
    const memoryPressure = this.getMemoryPressure();
    if (memoryPressure.state === 'hard') return this.reject('MEMORY_PRESSURE', 'memory_pressure_hard', request);
    if (memoryPressure.state === 'soft' && isRunClass(request.kind)) {
      return this.reject('MEMORY_PRESSURE', 'memory_pressure_soft', request);
    }

    if (isRunClass(request.kind)) {
      if (this.activeRunUnits() + request.units > this.profile.limits.activeRunUnits) {
        return this.reject('DEVICE_BUSY', 'active_run_limit', request);
      }
      if (
        request.kind === 'team_run' &&
        this.activeTeamRunUnits() + request.units > this.profile.limits.activeTeamRunUnits
      ) {
        return this.reject('DEVICE_BUSY', 'active_team_run_limit', request);
      }
      if (this.activeRunsForUser(request.userId) >= this.profile.limits.perUserActiveRuns) {
        return this.reject('PER_USER_LIMIT', 'per_user_limit', request);
      }
      if (
        request.conversationId &&
        this.activeRunsForConversation(request.conversationId) >= this.profile.limits.perConversationActiveRuns
      ) {
        return this.reject('PER_CONVERSATION_LIMIT', 'per_conversation_limit', request);
      }
      return null;
    }

    const active = this.activeUnitsForClass(request.kind);
    const limit = this.classLimit(request.kind);
    if (active + request.units > limit) return this.reject('DEVICE_BUSY', 'class_limit', request);
    return null;
  }

  private reject(code: AdmissionErrorCode, reason: string, request: AdmissionRequest): AdmissionRejectedError {
    const limit = isRunClass(request.kind) ? this.profile.limits.activeRunUnits : this.classLimit(request.kind);
    const active = isRunClass(request.kind) ? this.activeRunUnits() : this.activeUnitsForClass(request.kind);
    return new AdmissionRejectedError(
      code,
      code === 'RUN_TIMEOUT' || code === 'RUN_CANCELLED' ? 499 : 429,
      messageFor(code),
      {
        reason,
        profile: this.profile.name,
        active,
        limit,
        queued: this.queue.length,
        queue_limit: this.profile.limits.queueLimit,
      }
    );
  }

  private enqueue(request: AdmissionRequest): Promise<AdmissionTicket> {
    return new Promise<AdmissionTicket>((resolve, reject) => {
      const queued: QueuedRequest = {
        ...request,
        id: this.allocateId(),
        enqueuedAt: Date.now(),
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.removeQueued(queued.id);
          reject(this.reject('RUN_TIMEOUT', 'queue_timeout', request));
        }, this.profile.limits.queuedRequestTimeoutMs),
      };
      queued.timeout.unref?.();
      if (request.abortSignal) {
        const onAbort = (): void => {
          this.removeQueued(queued.id);
          reject(this.reject('RUN_CANCELLED', 'client_abort', request));
        };
        request.abortSignal.addEventListener('abort', onAbort, { once: true });
        queued.cleanupAbort = () => request.abortSignal?.removeEventListener('abort', onAbort);
      }
      this.queue.push(queued);
      this.scheduleQueueDrain();
    });
  }

  private scheduleQueueDrain(): void {
    if (!this.memoryGuard || this.queue.length === 0 || this.queueDrainTimer) return;
    this.queueDrainTimer = setTimeout(() => {
      this.queueDrainTimer = null;
      this.drainQueue();
    }, this.memoryGuard.queueDrainIntervalMs);
    this.queueDrainTimer.unref?.();
  }

  private getMemoryPressure(): {
    enabled: boolean;
    state: MemoryPressureState;
    usedRatio: number;
    softLimit: number;
    hardLimit: number;
  } {
    if (!this.memoryGuard) {
      return { enabled: false, state: 'normal', usedRatio: 0, softLimit: 0, hardLimit: 0 };
    }
    const usedRatio = clampRatio(this.memoryGuard.getUsedRatio());
    const state =
      usedRatio >= this.memoryGuard.hardLimit ? 'hard' : usedRatio >= this.memoryGuard.softLimit ? 'soft' : 'normal';
    return {
      enabled: true,
      state,
      usedRatio,
      softLimit: this.memoryGuard.softLimit,
      hardLimit: this.memoryGuard.hardLimit,
    };
  }

  private hasQueueCapacity(): boolean {
    return this.queue.length < this.profile.limits.queueLimit;
  }

  private assertRunQueueAdmissionAllowed(request: AdmissionRequest): void {
    if (!this.hasQueueCapacity()) throw this.reject('QUEUE_FULL', 'queue_full', request);
    if (this.activeRunsForUser(request.userId) >= this.profile.limits.perUserActiveRuns) {
      throw this.reject('PER_USER_LIMIT', 'per_user_limit', request);
    }
    if (
      request.conversationId &&
      this.activeRunsForConversation(request.conversationId) >= this.profile.limits.perConversationActiveRuns
    ) {
      throw this.reject('PER_CONVERSATION_LIMIT', 'per_conversation_limit', request);
    }
    if (this.hasQueuedForUser(request.userId)) throw this.reject('PER_USER_LIMIT', 'per_user_limit', request);
    if (request.conversationId && this.hasQueuedForConversation(request.conversationId)) {
      throw this.reject('PER_CONVERSATION_LIMIT', 'per_conversation_limit', request);
    }
  }

  private activeRunUnits(): number {
    let total = 0;
    for (const ticket of this.active.values()) if (isRunClass(ticket.kind)) total += ticket.units;
    return total;
  }

  private activeTeamRunUnits(): number {
    let total = 0;
    for (const ticket of this.active.values()) if (ticket.kind === 'team_run') total += ticket.units;
    return total;
  }

  private activeUnitsForClass(kind: RequestClass): number {
    let total = 0;
    for (const ticket of this.active.values()) if (ticket.kind === kind) total += ticket.units;
    return total;
  }

  private activeRunsForUser(userId: string): number {
    let total = 0;
    for (const ticket of this.active.values()) {
      if (isRunClass(ticket.kind) && ticket.userId === userId) total += 1;
    }
    return total;
  }

  private activeRunsForConversation(conversationId: string): number {
    let total = 0;
    for (const ticket of this.active.values()) {
      if (isRunClass(ticket.kind) && ticket.conversationId === conversationId) total += 1;
    }
    return total;
  }

  private hasQueuedForUser(userId: string): boolean {
    return this.queue.some((q) => q.userId === userId);
  }

  private hasQueuedForConversation(conversationId: string): boolean {
    return this.queue.some((q) => q.conversationId === conversationId);
  }

  private removeQueued(id: string): void {
    const index = this.queue.findIndex((q) => q.id === id);
    if (index < 0) return;
    const [queued] = this.queue.splice(index, 1);
    if (!queued) return;
    clearTimeout(queued.timeout);
    queued.cleanupAbort?.();
    if (this.queue.length === 0 && this.queueDrainTimer) {
      clearTimeout(this.queueDrainTimer);
      this.queueDrainTimer = null;
    }
  }

  private classLimit(kind: RequestClass): number {
    switch (kind) {
      case 'file_upload':
        return this.profile.limits.fileUploads;
      case 'nas_list':
        return this.profile.limits.nasList;
      case 'vector_search':
      case 'vector_image':
        return this.profile.limits.vectorSearch;
      case 'agent_run':
      case 'team_run':
      case 'team_agent_run':
        return this.profile.limits.activeRunUnits;
    }
  }

  private allocateId(): string {
    const id = `adm-${this.nextId}`;
    this.nextId += 1;
    return id;
  }
}

export function serializeAdmissionError(error: AdmissionRejectedError): { status: number; body: unknown } {
  return {
    status: error.status,
    body: {
      success: false,
      code: error.code,
      error: error.message,
      details: error.details,
    },
  };
}

function safePath(rawUrl: string): string {
  try {
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return rawUrl.split('?')[0] || '/';
  }
}

function isRunClass(kind: RequestClass): boolean {
  return kind === 'agent_run' || kind === 'team_run' || kind === 'team_agent_run';
}

function emptyClassRecord(): Record<RequestClass, number> {
  return {
    agent_run: 0,
    team_run: 0,
    team_agent_run: 0,
    file_upload: 0,
    nas_list: 0,
    vector_search: 0,
    vector_image: 0,
  };
}

function messageFor(code: AdmissionErrorCode): string {
  switch (code) {
    case 'QUEUE_FULL':
      return 'Device queue is full. Please wait or try again later.';
    case 'RUN_TIMEOUT':
      return 'Queued request timed out. Please try again later.';
    case 'RUN_CANCELLED':
      return 'Queued request was cancelled.';
    case 'PER_USER_LIMIT':
      return 'You already have an active or queued run.';
    case 'PER_CONVERSATION_LIMIT':
      return 'This conversation already has an active or queued run.';
    case 'MEMORY_PRESSURE':
      return 'Device memory pressure is high. Please wait or try again later.';
    case 'EDITION_DISABLED':
      return 'This feature is not available in this edition.';
    case 'RUN_QUEUED':
      return 'Run has been queued.';
    case 'DEVICE_BUSY':
    default:
      return 'Device is busy. Please wait or try again later.';
  }
}

function defaultSystemMemoryUsedRatio(): number {
  const total = os.totalmem();
  if (total <= 0) return 0;
  return (total - os.freemem()) / total;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function summarizeQueuedRequest(request: QueuedRequest): {
  id: string;
  kind: RequestClass;
  units: number;
  userId: string;
  conversationId?: string;
  waitMs: number;
} {
  return {
    id: request.id,
    kind: request.kind,
    units: request.units,
    userId: request.userId,
    conversationId: request.conversationId,
    waitMs: Date.now() - request.enqueuedAt,
  };
}
