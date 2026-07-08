import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startStaticServer, type StaticServerHandle } from '../../packages/web-host/src/static-server.js';
import type { ConcurrencyProfileName } from '../../packages/web-host/src/concurrency.js';

type LoadOptions = {
  profile: ConcurrencyProfileName;
  users: number;
  durationMs: number;
  runDelayMs: number;
  repeatClicks: number;
  pollMs: number;
  queueLimit?: number;
  reportPath?: string;
};

type RequestResult = {
  status: number;
  code?: string;
};

type SummaryInput = {
  expectedActiveRunLimit: number;
  expectedQueueLimit?: number;
  maxActiveRunUnits: number;
  maxQueuedRuns: number;
  results: RequestResult[];
};

type LoadSummary = {
  ok: boolean;
  failures: string[];
  totalRequests: number;
  statusCounts: Record<string, number>;
  codeCounts: Record<string, number>;
  maxActiveRunUnits: number;
  maxQueuedRuns: number;
};

const PROFILE_ACTIVE_RUN_LIMITS: Record<ConcurrencyProfileName, number> = {
  'team-32g': 4,
  'team-64g': 8,
};

export function parseLoadOptions(argv: string[]): LoadOptions {
  const options: LoadOptions = {
    profile: 'team-32g',
    users: 20,
    durationMs: 30_000,
    runDelayMs: 3_000,
    repeatClicks: 1,
    pollMs: 250,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--')) continue;
    if (value == null || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    i += 1;

    switch (key) {
      case '--profile':
        if (value !== 'team-32g' && value !== 'team-64g') throw new Error(`Unsupported profile: ${value}`);
        options.profile = value;
        break;
      case '--users':
        options.users = positiveInteger(key, value);
        break;
      case '--duration-ms':
        options.durationMs = positiveInteger(key, value);
        break;
      case '--run-delay-ms':
        options.runDelayMs = positiveInteger(key, value);
        break;
      case '--repeat-clicks':
        options.repeatClicks = positiveInteger(key, value);
        break;
      case '--poll-ms':
        options.pollMs = positiveInteger(key, value);
        break;
      case '--queue-limit':
        options.queueLimit = positiveInteger(key, value);
        break;
      case '--report':
        options.reportPath = value;
        break;
      default:
        throw new Error(`Unknown option: ${key}`);
    }
  }

  return options;
}

export function summarizeLoadResults(input: SummaryInput): LoadSummary {
  const statusCounts: Record<string, number> = {};
  const codeCounts: Record<string, number> = {};
  const failures: string[] = [];

  for (const result of input.results) {
    const status = String(result.status);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (result.code) codeCounts[result.code] = (codeCounts[result.code] ?? 0) + 1;
    if (result.status >= 500) failures.push(`unexpected_5xx_${result.status}`);
  }

  if (input.maxActiveRunUnits > input.expectedActiveRunLimit) failures.push('active_run_limit_exceeded');
  if (input.expectedQueueLimit != null && input.maxQueuedRuns > input.expectedQueueLimit) {
    failures.push('queue_limit_exceeded');
  }

  return {
    ok: failures.length === 0,
    failures: Array.from(new Set(failures)),
    totalRequests: input.results.length,
    statusCounts,
    codeCounts,
    maxActiveRunUnits: input.maxActiveRunUnits,
    maxQueuedRuns: input.maxQueuedRuns,
  };
}

export async function runLoadTest(options: LoadOptions): Promise<LoadSummary> {
  const staticDir = await makeRendererFixture();
  const backend = await startMockBackend(options.runDelayMs);
  let handle: StaticServerHandle | null = null;

  try {
    handle = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      concurrency: {
        profile: options.profile,
        overrides: options.queueLimit == null ? undefined : { queueLimit: options.queueLimit },
      },
    });

    let maxActiveRunUnits = 0;
    let maxQueuedRuns = 0;
    const pollState = { active: true };
    const poller = pollConcurrencyStatus(handle.localUrl, options.pollMs, pollState, (status) => {
      maxActiveRunUnits = Math.max(maxActiveRunUnits, status.activeRunUnits);
      maxQueuedRuns = Math.max(maxQueuedRuns, status.queues.total);
    });

    const deadline = Date.now() + options.durationMs;
    const results = await Promise.all(
      Array.from({ length: options.users }, (_, userIndex) =>
        runVirtualUser(handle!.localUrl, userIndex, options, deadline)
      )
    ).then((groups) => groups.flat());

    pollState.active = false;
    await poller;

    return summarizeLoadResults({
      expectedActiveRunLimit: PROFILE_ACTIVE_RUN_LIMITS[options.profile],
      expectedQueueLimit: options.queueLimit,
      maxActiveRunUnits,
      maxQueuedRuns,
      results,
    });
  } finally {
    await handle?.stop();
    await backend.close();
    await fs.rm(staticDir, { recursive: true, force: true });
  }

  async function pollConcurrencyStatus(
    baseUrl: string,
    pollMs: number,
    pollState: { active: boolean },
    onStatus: (status: { activeRunUnits: number; queues: { total: number } }) => void
  ): Promise<void> {
    while (pollState.active) {
      try {
        const response = await fetch(`${baseUrl}/api/system/concurrency-status`);
        const body = (await response.json()) as {
          data?: { activeRunUnits?: number; queues?: { total?: number } };
        };
        onStatus({
          activeRunUnits: body.data?.activeRunUnits ?? 0,
          queues: { total: body.data?.queues?.total ?? 0 },
        });
      } catch {
        // A transient poll failure should not hide request-level failures.
      }
      await delay(pollMs);
    }
  }
}

async function runVirtualUser(
  baseUrl: string,
  userIndex: number,
  options: LoadOptions,
  deadline: number
): Promise<RequestResult[]> {
  if (Date.now() >= deadline) return [];
  const conversationId = `load-user-${userIndex}-round-0`;
  return Promise.all(
    Array.from({ length: options.repeatClicks }, () => sendAgentRun(baseUrl, `user-${userIndex}`, conversationId))
  );
}

async function sendAgentRun(baseUrl: string, userId: string, conversationId: string): Promise<RequestResult> {
  const response = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
    },
    body: JSON.stringify({ content: 'load test message' }),
  });

  let code: string | undefined;
  try {
    const body = (await response.json()) as { code?: unknown };
    code = typeof body.code === 'string' ? body.code : undefined;
  } catch {
    // Non-JSON 2xx backend responses are acceptable for the mock backend.
  }
  return { status: response.status, code };
}

async function startMockBackend(runDelayMs: number): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && /^\/api\/conversations\/[^/]+\/messages$/.test(req.url ?? '')) {
      req.resume();
      await delay(runDelayMs);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, code: 'NOT_FOUND' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function makeRendererFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webhost-load-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>load</title>');
  return dir;
}

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const options = parseLoadOptions(process.argv.slice(2));
  const summary = await runLoadTest(options);
  const report = { options, summary, generatedAt: new Date().toISOString() };
  const output = JSON.stringify(report, null, 2);
  if (options.reportPath) await fs.writeFile(options.reportPath, `${output}\n`);
  console.log(output);
  if (!summary.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const currentPath = path.resolve(process.argv[1] ?? '');
if (invokedPath === currentPath && process.argv[1]?.endsWith('webhost-concurrency-load.ts')) {
  void main();
}
