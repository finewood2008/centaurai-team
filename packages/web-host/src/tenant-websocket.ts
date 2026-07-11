/**
 * Fail-closed WebSocket gateway for LAN/WebUI seats.
 *
 * The previous WebHost implementation spliced `/ws` directly to a local-mode
 * backend. Authentication protected the upgrade, but every connected seat then
 * received every backend event. This gateway keeps the raw-TCP compatibility
 * needed by Bun while terminating WebSocket frames itself: server events are
 * parsed as JSON and passed through the conversation tenant boundary, and
 * browser-to-backend application controls are denied (only heartbeat pong and
 * close frames are accepted).
 */
import { createHash, randomBytes } from 'node:crypto';
import net, { type Socket } from 'node:net';
import type { AuthGateIdentity } from './webui-auth-gate.js';
import type { ConversationTenantBoundary } from './conversation-tenancy.js';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_HANDSHAKE_BYTES = 16 * 1024;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_MESSAGES = 64;
const MAX_PENDING_BYTES = 16 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const AUTH_RECHECK_MS = 30_000;

type WebSocketFrame = {
  fin: boolean;
  opcode: number;
  payload: Buffer;
};

type ParsedClientHandshake = {
  requestHead: Buffer;
  remainder: Buffer;
  key: string;
  protocols: Set<string>;
};

export function isAllowedTenantWebSocketOrigin(
  origin: string | undefined,
  host: string,
  allowCrossOriginWithBearer: boolean
): boolean {
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const sameHttpOrigin = ['http:', 'https:'].includes(parsedOrigin.protocol) && parsedOrigin.host === host;
    return (
      sameHttpOrigin || (allowCrossOriginWithBearer && ['file:', 'http:', 'https:'].includes(parsedOrigin.protocol))
    );
  } catch {
    // Chromium serializes opaque/file origins as `null` on some platforms.
    return allowCrossOriginWithBearer && origin === 'null';
  }
}

export type TenantWebSocketOptions = {
  backendPort: number;
  initialBytes: Buffer;
  identity: AuthGateIdentity;
  boundary: ConversationTenantBoundary;
  /** Revalidates the exact gate session so logout/password reset closes WS. */
  isStillAuthorized: () => boolean;
  /** Native distributed clients authenticate with a bearer and use a file:// origin. */
  allowCrossOriginWithBearer?: boolean;
};

class FrameDecoder {
  #buffer = Buffer.alloc(0);
  readonly #expectMasked: boolean;

  constructor(expectMasked: boolean) {
    this.#expectMasked = expectMasked;
  }

  push(chunk: Buffer): WebSocketFrame[] {
    if (chunk.length > 0) this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (this.#buffer.length > MAX_FRAME_BYTES + 14) throw new Error('FRAME_TOO_LARGE');
    const frames: WebSocketFrame[] = [];
    for (;;) {
      if (this.#buffer.length < 2) break;
      const first = this.#buffer[0] ?? 0;
      const second = this.#buffer[1] ?? 0;
      const fin = (first & 0x80) !== 0;
      const rsv = first & 0x70;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      if (rsv !== 0 || masked !== this.#expectMasked) throw new Error('INVALID_FRAME');

      let offset = 2;
      let length = second & 0x7f;
      if (length === 126) {
        if (this.#buffer.length < offset + 2) break;
        length = this.#buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.#buffer.length < offset + 8) break;
        const large = this.#buffer.readBigUInt64BE(offset);
        if (large > BigInt(MAX_FRAME_BYTES)) throw new Error('FRAME_TOO_LARGE');
        length = Number(large);
        offset += 8;
      }
      if (length > MAX_FRAME_BYTES) throw new Error('FRAME_TOO_LARGE');
      if (opcode >= 0x8 && (!fin || length > 125)) throw new Error('INVALID_CONTROL_FRAME');
      const maskOffset = masked ? 4 : 0;
      if (this.#buffer.length < offset + maskOffset + length) break;
      const mask = masked ? this.#buffer.subarray(offset, offset + 4) : null;
      offset += maskOffset;
      const payload = Buffer.from(this.#buffer.subarray(offset, offset + length));
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
        }
      }
      this.#buffer = this.#buffer.subarray(offset + length);
      frames.push({ fin, opcode, payload });
    }
    return frames;
  }
}

function encodeFrame(opcode: number, payload: Buffer, masked: boolean): Buffer {
  if (payload.length > MAX_FRAME_BYTES) throw new Error('FRAME_TOO_LARGE');
  let headerLength = 2;
  if (payload.length >= 126 && payload.length <= 0xffff) headerLength += 2;
  else if (payload.length > 0xffff) headerLength += 8;
  if (masked) headerLength += 4;
  const output = Buffer.allocUnsafe(headerLength + payload.length);
  output[0] = 0x80 | (opcode & 0x0f);
  let offset = 2;
  if (payload.length < 126) {
    output[1] = (masked ? 0x80 : 0) | payload.length;
  } else if (payload.length <= 0xffff) {
    output[1] = (masked ? 0x80 : 0) | 126;
    output.writeUInt16BE(payload.length, offset);
    offset += 2;
  } else {
    output[1] = (masked ? 0x80 : 0) | 127;
    output.writeBigUInt64BE(BigInt(payload.length), offset);
    offset += 8;
  }
  if (masked) {
    const mask = randomBytes(4);
    mask.copy(output, offset);
    offset += 4;
    for (let index = 0; index < payload.length; index += 1) {
      output[offset + index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
    }
  } else {
    payload.copy(output, offset);
  }
  return output;
}

function closePayload(code: number, reason: string): Buffer {
  const reasonBytes = Buffer.from(reason, 'utf-8').subarray(0, 123);
  const payload = Buffer.allocUnsafe(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return payload;
}

function parseClientHandshake(
  initialBytes: Buffer,
  backendPort: number,
  allowCrossOriginWithBearer: boolean
): ParsedClientHandshake | null {
  const headerEnd = initialBytes.indexOf('\r\n\r\n');
  if (headerEnd < 0 || headerEnd + 4 > MAX_HANDSHAKE_BYTES) return null;
  const text = initialBytes.subarray(0, headerEnd).toString('latin1');
  const lines = text.split('\r\n');
  const requestLine = lines.shift() ?? '';
  const requestMatch = /^GET\s+(\/ws(?:\?[^\s]*)?)\s+HTTP\/1\.[01]$/.exec(requestLine);
  if (!requestMatch) return null;

  const headers = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) return null;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (headers.has(name)) headers.set(name, `${headers.get(name)}, ${value}`);
    else headers.set(name, value);
  }
  const key = headers.get('sec-websocket-key') ?? '';
  let decodedKey: Buffer;
  try {
    decodedKey = Buffer.from(key, 'base64');
  } catch {
    return null;
  }
  if (
    decodedKey.length !== 16 ||
    headers.get('sec-websocket-version') !== '13' ||
    !/\bwebsocket\b/i.test(headers.get('upgrade') ?? '') ||
    !/\bupgrade\b/i.test(headers.get('connection') ?? '')
  ) {
    return null;
  }

  const host = headers.get('host') ?? '';
  const origin = headers.get('origin');
  if (!isAllowedTenantWebSocketOrigin(origin, host, allowCrossOriginWithBearer)) return null;

  const protocols = new Set<string>();
  const rawProtocols = headers.get('sec-websocket-protocol');
  if (rawProtocols) {
    for (const rawProtocol of rawProtocols.split(',')) {
      const protocol = rawProtocol.trim();
      if (!protocol || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(protocol)) return null;
      protocols.add(protocol);
    }
  }

  const rawPath = requestMatch[1] ?? '/ws';
  const upstreamUrl = new URL(rawPath, 'http://127.0.0.1');
  upstreamUrl.searchParams.delete('gate');
  const upstreamPath = `${upstreamUrl.pathname}${upstreamUrl.search}`;
  const forwarded: string[] = [
    `GET ${upstreamPath} HTTP/1.1`,
    `Host: 127.0.0.1:${backendPort}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Version: 13`,
    `Sec-WebSocket-Key: ${key}`,
  ];
  if (origin) forwarded.push(`Origin: ${origin}`);
  if (rawProtocols) forwarded.push(`Sec-WebSocket-Protocol: ${rawProtocols}`);
  const userAgent = headers.get('user-agent');
  if (userAgent && userAgent.length <= 512 && !/[\r\n]/.test(userAgent)) forwarded.push(`User-Agent: ${userAgent}`);
  return {
    requestHead: Buffer.from(`${forwarded.join('\r\n')}\r\n\r\n`, 'latin1'),
    remainder: initialBytes.subarray(headerEnd + 4),
    key,
    protocols,
  };
}

function sanitizeUpstreamHandshake(head: Buffer, key: string, offeredProtocols: Set<string>): Buffer | null {
  const text = head.toString('latin1');
  const lines = text.split('\r\n');
  if (!/^HTTP\/1\.[01]\s+101(?:\s|$)/.test(lines.shift() ?? '')) return null;
  const headers = new Map<string, string>();
  for (const line of lines) {
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) return null;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  const expected = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
  if (
    headers.get('sec-websocket-accept') !== expected ||
    headers.has('sec-websocket-extensions') ||
    !/\bwebsocket\b/i.test(headers.get('upgrade') ?? '') ||
    !/\bupgrade\b/i.test(headers.get('connection') ?? '')
  ) {
    return null;
  }
  const selectedProtocol = headers.get('sec-websocket-protocol');
  if (selectedProtocol && !offeredProtocols.has(selectedProtocol)) return null;
  const safeHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${expected}`,
  ];
  if (selectedProtocol) safeHeaders.push(`Sec-WebSocket-Protocol: ${selectedProtocol}`);
  return Buffer.from(`${safeHeaders.join('\r\n')}\r\n\r\n`, 'latin1');
}

function eventName(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name === 'string') return record.name;
  if (typeof record.event === 'string') return record.event;
  return null;
}

/**
 * Take over one already-peeked `/ws` TCP connection. The caller must have read
 * the complete HTTP request head and must not attach any other data listeners.
 */
export function proxyTenantWebSocket(client: Socket, opts: TenantWebSocketOptions): void {
  const handshake = parseClientHandshake(opts.initialBytes, opts.backendPort, opts.allowCrossOriginWithBearer === true);
  if (!handshake) {
    client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }

  client.pause();
  client.setNoDelay(true);
  client.setKeepAlive(true);
  client.setTimeout(0);
  const upstream = net.connect({ host: '127.0.0.1', port: opts.backendPort });
  upstream.setNoDelay(true);
  upstream.setKeepAlive(true);
  upstream.setTimeout(0);

  let closed = false;
  let established = false;
  let upstreamHandshake = Buffer.alloc(0);
  let pendingMessages = 0;
  let pendingBytes = 0;
  let messageChain: Promise<void> = Promise.resolve();
  const serverFrames = new FrameDecoder(false);
  const clientFrames = new FrameDecoder(true);
  let serverFragment: Buffer[] | null = null;
  let serverFragmentBytes = 0;
  let clientFragment: Buffer[] | null = null;
  let clientFragmentBytes = 0;

  const finish = (): void => {
    if (closed) return;
    closed = true;
    clearTimeout(handshakeTimer);
    clearInterval(authTimer);
    client.destroy();
    upstream.destroy();
  };

  const closeBoth = (code: number, reason: string): void => {
    if (closed) return;
    closed = true;
    clearTimeout(handshakeTimer);
    clearInterval(authTimer);
    const payload = closePayload(code, reason);
    if (established) {
      if (!client.destroyed) client.end(encodeFrame(0x8, payload, false));
      if (!upstream.destroyed) upstream.end(encodeFrame(0x8, payload, true));
      setTimeout(() => {
        client.destroy();
        upstream.destroy();
      }, 250).unref();
    } else {
      client.destroy();
      upstream.destroy();
    }
  };

  const sendJsonPong = (): void => {
    if (closed || !established || upstream.destroyed) return;
    const payload = Buffer.from(JSON.stringify({ name: 'pong', data: { timestamp: Date.now() } }), 'utf-8');
    upstream.write(encodeFrame(0x1, payload, true));
  };

  const processServerText = (payload: Buffer): void => {
    pendingMessages += 1;
    pendingBytes += payload.length;
    if (pendingMessages > MAX_PENDING_MESSAGES || pendingBytes > MAX_PENDING_BYTES) {
      closeBoth(1009, 'event queue too large');
      return;
    }
    upstream.pause();
    messageChain = messageChain
      .then(async () => {
        if (closed) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload.toString('utf-8')) as unknown;
        } catch {
          return;
        }
        if (eventName(parsed) === 'ping') {
          sendJsonPong();
          return;
        }
        if (!opts.isStillAuthorized()) {
          closeBoth(1008, 'session expired');
          return;
        }
        const allowed = await opts.boundary.shouldForwardWebSocketPayload(opts.identity, parsed);
        if (allowed && opts.isStillAuthorized() && !client.destroyed) {
          client.write(encodeFrame(0x1, payload, false));
        }
      })
      .catch(() => {
        closeBoth(1011, 'event filter failed');
      })
      .finally(() => {
        pendingMessages -= 1;
        pendingBytes -= payload.length;
        if (pendingMessages === 0 && !closed) upstream.resume();
      });
  };

  const handleServerFrames = (chunk: Buffer): void => {
    let frames: WebSocketFrame[];
    try {
      frames = serverFrames.push(chunk);
    } catch {
      closeBoth(1002, 'invalid backend frame');
      return;
    }
    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        if (!client.destroyed) client.end(encodeFrame(0x8, frame.payload, false));
        finish();
        return;
      }
      if (frame.opcode === 0x9) {
        if (!upstream.destroyed) upstream.write(encodeFrame(0xa, frame.payload, true));
        continue;
      }
      if (frame.opcode === 0xa) continue;
      if (frame.opcode === 0x2) continue;
      if (frame.opcode === 0x1) {
        if (serverFragment) {
          closeBoth(1002, 'nested fragments');
          return;
        }
        if (frame.fin) processServerText(frame.payload);
        else {
          serverFragment = [frame.payload];
          serverFragmentBytes = frame.payload.length;
        }
        continue;
      }
      if (frame.opcode === 0x0 && serverFragment) {
        serverFragmentBytes += frame.payload.length;
        if (serverFragmentBytes > MAX_FRAME_BYTES) {
          closeBoth(1009, 'fragment too large');
          return;
        }
        serverFragment.push(frame.payload);
        if (frame.fin) {
          const complete = Buffer.concat(serverFragment, serverFragmentBytes);
          serverFragment = null;
          serverFragmentBytes = 0;
          processServerText(complete);
        }
        continue;
      }
      closeBoth(1002, 'invalid continuation');
      return;
    }
  };

  const processClientText = (payload: Buffer): void => {
    try {
      const parsed = JSON.parse(payload.toString('utf-8')) as unknown;
      if (eventName(parsed) === 'pong' && !upstream.destroyed) {
        upstream.write(encodeFrame(0x1, payload, true));
      }
    } catch {
      // Application controls are deliberately fail-closed.
    }
  };

  const handleClientFrames = (chunk: Buffer): void => {
    let frames: WebSocketFrame[];
    try {
      frames = clientFrames.push(chunk);
    } catch {
      closeBoth(1002, 'invalid client frame');
      return;
    }
    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        if (!upstream.destroyed) upstream.end(encodeFrame(0x8, frame.payload, true));
        finish();
        return;
      }
      if (frame.opcode === 0x9) {
        if (!client.destroyed) client.write(encodeFrame(0xa, frame.payload, false));
        continue;
      }
      if (frame.opcode === 0xa || frame.opcode === 0x2) continue;
      if (frame.opcode === 0x1) {
        if (clientFragment) {
          closeBoth(1002, 'nested fragments');
          return;
        }
        if (frame.fin) processClientText(frame.payload);
        else {
          clientFragment = [frame.payload];
          clientFragmentBytes = frame.payload.length;
        }
        continue;
      }
      if (frame.opcode === 0x0 && clientFragment) {
        clientFragmentBytes += frame.payload.length;
        if (clientFragmentBytes > MAX_FRAME_BYTES) {
          closeBoth(1009, 'fragment too large');
          return;
        }
        clientFragment.push(frame.payload);
        if (frame.fin) {
          const complete = Buffer.concat(clientFragment, clientFragmentBytes);
          clientFragment = null;
          clientFragmentBytes = 0;
          processClientText(complete);
        }
        continue;
      }
      closeBoth(1002, 'invalid continuation');
      return;
    }
  };

  const handshakeTimer = setTimeout(() => closeBoth(1002, 'handshake timeout'), HANDSHAKE_TIMEOUT_MS);
  handshakeTimer.unref();
  const authTimer = setInterval(() => {
    if (!opts.isStillAuthorized()) closeBoth(1008, 'session expired');
  }, AUTH_RECHECK_MS);
  authTimer.unref();

  upstream.once('connect', () => {
    upstream.write(handshake.requestHead);
  });
  upstream.on('data', (chunk: Buffer) => {
    if (closed) return;
    if (established) {
      handleServerFrames(chunk);
      return;
    }
    upstreamHandshake = Buffer.concat([upstreamHandshake, chunk]);
    if (upstreamHandshake.length > MAX_HANDSHAKE_BYTES) {
      client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      finish();
      return;
    }
    const headerEnd = upstreamHandshake.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const head = upstreamHandshake.subarray(0, headerEnd + 4);
    const remainder = upstreamHandshake.subarray(headerEnd + 4);
    const safeHead = sanitizeUpstreamHandshake(head, handshake.key, handshake.protocols);
    if (!safeHead) {
      client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      finish();
      return;
    }
    established = true;
    clearTimeout(handshakeTimer);
    client.write(safeHead);
    client.on('data', handleClientFrames);
    client.resume();
    if (handshake.remainder.length > 0) handleClientFrames(handshake.remainder);
    if (remainder.length > 0) handleServerFrames(remainder);
  });

  const onError = (): void => finish();
  upstream.on('error', onError);
  client.on('error', onError);
  upstream.on('close', onError);
  client.on('close', onError);
}
