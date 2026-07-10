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

async function startUploadServer(): Promise<{ endpoint: string; bodies: string[] }> {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/upload') {
      res.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ doc_id: `doc-${bodies.length}` }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  servers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { endpoint: `http://127.0.0.1:${port}`, bodies };
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
});
