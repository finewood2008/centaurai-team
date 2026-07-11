import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

vi.mock('officeparser', () => ({
  parseOfficeAsync: vi.fn(async () => '  Slide title  \n\nBullet one\nBullet two'),
}));

const { parseOfficeAsync } = await import('officeparser');
const { indexNasFolder } = await import('./nas-drive.js');

const roots: string[] = [];
const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(servers.splice(0).map((close) => close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-pptx-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'deck.pptx'), 'fake pptx body');
  return root;
}

async function startUploadServer(
  responseForUpload: (uploadNumber: number) => Record<string, unknown> = (uploadNumber) => ({
    doc_id: `doc-${uploadNumber}`,
  })
): Promise<{ endpoint: string; bodies: string[]; requests: string[]; deletedIds: string[] }> {
  const bodies: string[] = [];
  const requests: string[] = [];
  const deletedIds: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'DELETE' && req.url?.startsWith('/api/documents/')) {
      deletedIds.push(decodeURIComponent(req.url.slice('/api/documents/'.length)));
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST' || req.url !== '/api/upload') {
      res.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(responseForUpload(bodies.length)));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  servers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { endpoint: `http://127.0.0.1:${port}`, bodies, requests, deletedIds };
}

describe('indexNasFolder PPTX uploads', () => {
  it('extracts pptx text and uploads it as markdown for the vector DB', async () => {
    const root = await makeRoot();
    const server = await startUploadServer();

    const result = await indexNasFolder(root, '', { endpoint: server.endpoint });

    expect(result).toMatchObject({ phase: 'done', total: 1, done: 1, failed: 0, skipped: 0 });
    expect(parseOfficeAsync).toHaveBeenCalledWith(
      path.join(root, 'deck.pptx'),
      expect.objectContaining({ newlineDelimiter: '\n', ignoreNotes: false })
    );
    expect(server.bodies).toHaveLength(1);
    expect(server.bodies[0]).toContain('filename="deck.pptx.md"');
    expect(server.bodies[0]).toContain('# deck.pptx');
    expect(server.bodies[0]).toContain('Source: deck.pptx');
    expect(server.bodies[0]).toContain('Slide title\nBullet one\nBullet two');
  });

  it('re-indexes unchanged files after the vector endpoint changes', async () => {
    const root = await makeRoot();
    const firstServer = await startUploadServer();
    const secondServer = await startUploadServer();

    await indexNasFolder(root, '', { endpoint: firstServer.endpoint });
    const migrated = await indexNasFolder(root, '', { endpoint: secondServer.endpoint });
    const unchanged = await indexNasFolder(root, '', { endpoint: secondServer.endpoint });

    expect(firstServer.bodies).toHaveLength(1);
    expect(secondServer.bodies).toHaveLength(1);
    expect(migrated).toMatchObject({ done: 1, failed: 0, skipped: 0 });
    expect(unchanged).toMatchObject({ done: 0, failed: 0, skipped: 1 });

    const manifest = await fs.readFile(path.join(root, '.nas-index', 'manifest.json'), 'utf8');
    expect(manifest).not.toContain(firstServer.endpoint);
    expect(manifest).not.toContain(secondServer.endpoint);
  });

  it('keeps endpoint-specific delete work and cleans it when that endpoint becomes active again', async () => {
    const root = await makeRoot();
    const firstServer = await startUploadServer();
    const secondServer = await startUploadServer();

    await indexNasFolder(root, '', { endpoint: firstServer.endpoint });
    await indexNasFolder(root, '', { endpoint: secondServer.endpoint });
    const switchedBack = await indexNasFolder(root, '', { endpoint: firstServer.endpoint });
    const unchanged = await indexNasFolder(root, '', { endpoint: firstServer.endpoint });

    expect(firstServer.deletedIds).toEqual(['doc-1']);
    expect(firstServer.bodies).toHaveLength(2);
    expect(secondServer.bodies).toHaveLength(1);
    expect(switchedBack).toMatchObject({ done: 1, failed: 0, skipped: 0 });
    expect(unchanged).toMatchObject({ done: 0, failed: 0, skipped: 1 });
  });

  it('ignores a forged legacy manifest when app-private manifest storage is configured', async () => {
    const root = await makeRoot();
    const privateState = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-private-state-'));
    roots.push(privateState);
    await fs.mkdir(path.join(root, '.nas-index'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.nas-index', 'manifest.json'),
      JSON.stringify({
        version: 2,
        files: {},
        pendingDeletes: [{ endpointKey: 'attacker-controlled', docId: 'victim-doc' }],
      })
    );
    const server = await startUploadServer();

    const result = await indexNasFolder(root, '', { endpoint: server.endpoint, manifestDir: privateState });

    expect(result).toMatchObject({ done: 1, failed: 0 });
    expect(server.deletedIds).toEqual([]);
    expect(server.requests.some((request) => request.includes('victim-doc'))).toBe(false);
    expect(await fs.readdir(privateState)).toHaveLength(1);
  });

  it('re-indexes unsigned legacy entries without granting their ids delete authority', async () => {
    const root = await makeRoot();
    const privateState = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-private-migrate-'));
    roots.push(privateState);
    const server = await startUploadServer();

    await indexNasFolder(root, '', { endpoint: server.endpoint });
    const migrated = await indexNasFolder(root, '', { endpoint: server.endpoint, manifestDir: privateState });

    expect(server.bodies).toHaveLength(2);
    expect(server.deletedIds).toEqual([]);
    expect(migrated).toMatchObject({ done: 1, failed: 0, skipped: 0 });
    const privateManifestPath = path.join(privateState, (await fs.readdir(privateState))[0]);
    const manifest = JSON.parse(await fs.readFile(privateManifestPath, 'utf8')) as {
      files: Record<string, { deleteTrusted?: boolean }>;
    };
    expect(manifest.files['deck.pptx']?.deleteTrusted).toBe(true);
  });

  it('serializes concurrent syncs that share the same private manifest', async () => {
    const root = await makeRoot();
    const privateState = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-private-lock-'));
    roots.push(privateState);
    const server = await startUploadServer();

    const results = await Promise.all([
      indexNasFolder(root, '', { endpoint: server.endpoint, manifestDir: privateState }),
      indexNasFolder(root, '', { endpoint: server.endpoint, manifestDir: privateState }),
    ]);

    expect(server.bodies).toHaveLength(1);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ done: 1, skipped: 0 }),
        expect.objectContaining({ done: 0, skipped: 1 }),
      ])
    );
  });

  it('does not commit a queued upload when cancellation arrives while polling', async () => {
    const root = await makeRoot();
    const server = await startUploadServer(() => ({ doc_id: 'queued-doc', queued: true }));
    let cancellationChecks = 0;

    const result = await indexNasFolder(root, '', {
      endpoint: server.endpoint,
      isCancelled: () => ++cancellationChecks >= 2,
    });

    expect(result).toMatchObject({ done: 0, failed: 0, skipped: 1 });
    expect(server.deletedIds).toEqual(['queued-doc']);
    const manifest = JSON.parse(await fs.readFile(path.join(root, '.nas-index', 'manifest.json'), 'utf8')) as {
      files: Record<string, unknown>;
    };
    expect(manifest.files).toEqual({});
  });

  it('does not record a successful upload that omitted its document id', async () => {
    const root = await makeRoot();
    const server = await startUploadServer(() => ({}));

    const first = await indexNasFolder(root, '', { endpoint: server.endpoint });
    const retried = await indexNasFolder(root, '', { endpoint: server.endpoint });

    expect(first).toMatchObject({ done: 0, failed: 1, skipped: 0 });
    expect(retried).toMatchObject({ done: 0, failed: 1, skipped: 0 });
    expect(server.bodies).toHaveLength(2);
  });
});
