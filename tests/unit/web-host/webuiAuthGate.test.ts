import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuthGate, GATE_COOKIE_NAME, parseCookie } from '../../../packages/web-host/src/webui-auth-gate.js';

const FIXED_SECRET = Buffer.alloc(32, 7);

afterEach(() => {
  vi.useRealTimers();
});

function cookieValue(setCookie: string): string {
  // "webui_gate=<token>; Path=/; ..." → "webui_gate=<token>"
  return setCookie.split(';')[0]!;
}

describe('parseCookie', () => {
  it('extracts a named cookie from a raw header', () => {
    expect(parseCookie('a=1; webui_gate=xyz; b=2', GATE_COOKIE_NAME)).toBe('xyz');
  });
  it('returns null when absent or header missing', () => {
    expect(parseCookie('a=1; b=2', GATE_COOKIE_NAME)).toBeNull();
    expect(parseCookie(undefined, GATE_COOKIE_NAME)).toBeNull();
  });
});

describe('createAuthGate', () => {
  it('authorizes a freshly minted cookie', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const header = cookieValue(gate.mintCookie());
    expect(gate.isAuthorized(header)).toBe(true);
  });

  it('rejects a missing or empty cookie header', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    expect(gate.isAuthorized(undefined)).toBe(false);
    expect(gate.isAuthorized('')).toBe(false);
    expect(gate.isAuthorized('other=1')).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const token = cookieValue(gate.mintCookie()).slice(GATE_COOKIE_NAME.length + 1);
    const [, sig] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url')}.${sig}`;
    expect(gate.isAuthorized(`${GATE_COOKIE_NAME}=${forged}`)).toBe(false);
  });

  it('rejects a token signed by a different secret', () => {
    const minted = cookieValue(createAuthGate({ secret: Buffer.alloc(32, 1) }).mintCookie());
    const other = createAuthGate({ secret: Buffer.alloc(32, 2) });
    expect(other.isAuthorized(minted)).toBe(false);
  });

  it('rejects an expired cookie', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    expect(gate.isAuthorized(cookieValue(gate.mintCookie(-1)))).toBe(false);
  });

  it('expires the default session after eight hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'));
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const cookie = cookieValue(gate.mintCookie());

    vi.advanceTimersByTime(8 * 60 * 60 * 1000);

    expect(gate.isAuthorized(cookie)).toBe(false);
  });

  it('revokes a logged-out bearer without invalidating a sibling session', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const loggedOut = gate.mintToken({ userId: 'alice' });
    const stillActive = gate.mintToken({ userId: 'alice' });

    expect(gate.revokeToken(loggedOut)).toBe(true);
    expect(gate.isAuthorizedToken(loggedOut)).toBe(false);
    expect(gate.isAuthorizedToken(stillActive)).toBe(true);
  });

  it('revokes the current cookie token and rejects repeated revocation', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const cookie = cookieValue(gate.mintCookie({ userId: 'alice' }));

    expect(gate.revokeCookie(cookie)).toBe(true);
    expect(gate.revokeCookie(cookie)).toBe(false);
    expect(gate.isAuthorized(cookie)).toBe(false);
  });

  it('revokes all sessions for one user without affecting another user', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const aliceCookie = cookieValue(gate.mintCookie({ userId: 'alice' }));
    const aliceBearer = gate.mintToken({ userId: 'alice' });
    const bobBearer = gate.mintToken({ userId: 'bob' });

    expect(gate.revokeUserSessions('alice')).toBe(2);
    expect(gate.isAuthorized(aliceCookie)).toBe(false);
    expect(gate.isAuthorizedToken(aliceBearer)).toBe(false);
    expect(gate.isAuthorizedToken(bobBearer)).toBe(true);
  });

  it('evicts the oldest session when one user exceeds the per-user cap', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET, maxSessionsPerUser: 2, maxSessions: 10 });
    const aliceOldest = gate.mintToken({ userId: 'alice' });
    const aliceNewer = gate.mintToken({ userId: 'alice' });
    const bob = gate.mintToken({ userId: 'bob' });
    const aliceNewest = gate.mintToken({ userId: 'alice' });

    expect(gate.isAuthorizedToken(aliceOldest)).toBe(false);
    expect(gate.isAuthorizedToken(aliceNewer)).toBe(true);
    expect(gate.isAuthorizedToken(aliceNewest)).toBe(true);
    expect(gate.isAuthorizedToken(bob)).toBe(true);
  });

  it('enforces a process-wide session cap across different users', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET, maxSessionsPerUser: 10, maxSessions: 3 });
    const oldest = gate.mintToken({ userId: 'alice' });
    const second = gate.mintToken({ userId: 'bob' });
    const third = gate.mintToken({ userId: 'carol' });
    const newest = gate.mintToken({ userId: 'dave' });

    expect(gate.isAuthorizedToken(oldest)).toBe(false);
    expect(gate.isAuthorizedToken(second)).toBe(true);
    expect(gate.isAuthorizedToken(third)).toBe(true);
    expect(gate.isAuthorizedToken(newest)).toBe(true);
  });

  it('rejects a malformed token', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    expect(gate.isAuthorized(`${GATE_COOKIE_NAME}=not-a-token`)).toBe(false);
    expect(gate.isAuthorized(`${GATE_COOKIE_NAME}=.sig`)).toBe(false);
  });

  it('clearCookie produces an immediately-expiring cookie', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const cleared = gate.clearCookie();
    expect(cleared).toContain(`${GATE_COOKIE_NAME}=;`);
    expect(cleared).toContain('Max-Age=0');
  });

  it('marks the cookie Secure only when AIONUI_HTTPS is set', () => {
    expect(createAuthGate({ secret: FIXED_SECRET, secure: true }).mintCookie()).toContain('Secure');
    const insecure = createAuthGate({ secret: FIXED_SECRET, secure: false }).mintCookie();
    expect(insecure).not.toContain('Secure');
    expect(insecure).toContain('HttpOnly');
    expect(insecure).toContain('SameSite=Strict');
  });
});
