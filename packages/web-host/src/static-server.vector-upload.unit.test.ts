import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { StaticServerHandle } from './static-server.js';

vi.mock('officeparser', () => ({
  parseOfficeAsync: vi.fn(async () => '  LAN deck title  \n\nMarket slide\nRoadmap slide'),
}));

const { parseOfficeAsync } = await import('officeparser');
const { startStaticServer } = await import('./static-server.js');

async function mkRendererFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-vector-upload-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>root</title>');
  return dir;
}

async function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe('static-server vector upload proxy', () => {
  let staticDir = '';
  let handle: StaticServerHandle | null = null;
  let stopBackend: (() => Promise<void>) | null = null;
  let stopVector: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    staticDir = await mkRendererFixture();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (handle) {
      await handle.stop();
      handle = null;
    }
    if (stopBackend) {
      await stopBackend();
      stopBackend = null;
    }
    if (stopVector) {
      await stopVector();
      stopVector = null;
    }
    await fs.rm(staticDir, { recursive: true, force: true });
  });

  it('extracts LAN-uploaded pptx and forwards markdown to the vector DB', async () => {
    const backend = await startMockServer((_req, res) => res.end('backend'));
    stopBackend = backend.close;

    const bodies: string[] = [];
    const vector = await startMockServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/api/upload') {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ doc_id: 'pptx-doc' }));
      });
    });
    stopVector = vector.close;

    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const form = new FormData();
    form.append('file', new Blob(['fake pptx bytes']), 'lan-deck.pptx');

    const resp = await fetch(
      `${handle.localUrl}/api/vector-upload?endpoint=${encodeURIComponent(`http://127.0.0.1:${vector.port}`)}`,
      { method: 'POST', body: form }
    );

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ doc_id: 'pptx-doc' });
    expect(parseOfficeAsync).toHaveBeenCalledOnce();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('filename="lan-deck.pptx.md"');
    expect(bodies[0]).toContain('# lan-deck.pptx');
    expect(bodies[0]).toContain('Source: lan-deck.pptx');
    expect(bodies[0]).toContain('LAN deck title\nMarket slide\nRoadmap slide');
  });

  it('rejects vector upload endpoints that are not http(s)', async () => {
    const backend = await startMockServer((_req, res) => res.end('backend'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const form = new FormData();
    form.append('file', new Blob(['x']), 'x.txt');
    const resp = await fetch(`${handle.localUrl}/api/vector-upload?endpoint=file%3A%2F%2F%2Fetc%2Fpasswd`, {
      method: 'POST',
      body: form,
    });

    expect(resp.status).toBe(400);
  });
});
