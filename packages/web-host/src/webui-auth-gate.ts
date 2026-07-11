/**
 * WebUI reverse-proxy auth gate.
 *
 * The bundled aioncore backend runs in `--local` mode, which disables its own
 * JWT/CSRF enforcement for protected `/api/*` routes (the auth middleware
 * injects a synthetic `system_default_user` instead of verifying a token). That
 * is safe only while the WebUI is reached over loopback. When the WebUI is
 * exposed to a LAN (`allowRemote`), the reverse proxy — not the backend — is
 * the trust boundary, so we gate it here.
 *
 * Flow: a browser may reach the backend only after presenting the WebUI
 * password. We never verify the password ourselves — we let the request hit the
 * backend's `POST /login`, which DOES verify the password against its bcrypt
 * hash even in `--local` mode (only the protected-route middleware is bypassed,
 * not the login handler). On a 2xx login response we mint a signed session
 * cookie; every other `/api/*` request and `/ws` upgrade must carry a valid one.
 *
 * The cookie is an HMAC token signed with a per-process secret and backed by a
 * small in-memory session registry. The registry makes logout and password
 * changes immediately revocable; sessions also do not survive a web-host
 * restart (acceptable: clients simply log in again). This adds NO new login UX:
 * it reuses the existing WebUI username/password and login page.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GATE_COOKIE_NAME = 'webui_gate';

/** Default session lifetime: one working day. */
const DEFAULT_TTL_SEC = 8 * 60 * 60;
/** Bound successful-login churn from one compromised/abusive account. */
const DEFAULT_MAX_SESSIONS_PER_USER = 16;
/** Hard process-wide memory bound, independent of the number of accounts. */
const DEFAULT_MAX_SESSIONS = 10_000;

const nowSec = (): number => Math.floor(Date.now() / 1000);

export type AuthGateIdentity = {
  userId: string;
  username?: string;
};

type AuthGatePayload = {
  exp?: number;
  sid?: string;
  user_id?: string;
  username?: string;
};

type AuthGateSession = {
  exp: number;
  userId?: string;
};

function identityFromPayload(payload: AuthGatePayload | null): AuthGateIdentity | null {
  const userId = typeof payload?.user_id === 'string' ? payload.user_id.trim() : '';
  if (!userId) return null;
  const username =
    typeof payload?.username === 'string' && payload.username.trim() ? payload.username.trim() : undefined;
  return { userId, username };
}

export type AuthGate = {
  /** Build the raw bearer token used by the cookie or native-client header. */
  mintToken: (identityOrTtlSec?: AuthGateIdentity | number, ttlSec?: number) => string;
  /** Build a `Set-Cookie` value authorizing the bearer for `ttlSec` seconds. */
  mintCookie: (identityOrTtlSec?: AuthGateIdentity | number, ttlSec?: number) => string;
  /** Build a `Set-Cookie` value that immediately clears the gate cookie. */
  clearCookie: () => string;
  /** Revoke one raw bearer token. Returns true when an active session was revoked. */
  revokeToken: (token: string | undefined | null) => boolean;
  /** Revoke the gate token in a raw `Cookie` header. */
  revokeCookie: (cookieHeader: string | undefined) => boolean;
  /** Revoke every active gate session belonging to one user. */
  revokeUserSessions: (userId: string) => number;
  /** Return the trusted identity embedded in a valid bearer token, when present. */
  getAuthorizedTokenIdentity: (token: string | undefined | null) => AuthGateIdentity | null;
  /** Return the trusted identity embedded in a valid cookie token, when present. */
  getAuthorizedIdentity: (cookieHeader: string | undefined) => AuthGateIdentity | null;
  /** True if a raw bearer token is valid and unexpired. */
  isAuthorizedToken: (token: string | undefined | null) => boolean;
  /** True if the raw `Cookie` header carries a valid, unexpired gate token. */
  isAuthorized: (cookieHeader: string | undefined) => boolean;
};

/**
 * Extract a single cookie value from a raw `Cookie` header, or `null`. Exported
 * so the WS-upgrade path can read the header out of a raw request buffer.
 */
export function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function createAuthGate(opts?: {
  secret?: Buffer;
  secure?: boolean;
  maxSessions?: number;
  maxSessionsPerUser?: number;
}): AuthGate {
  // A fresh random secret per process: no key management, and a restart
  // transparently invalidates every outstanding session.
  const secret = opts?.secret ?? randomBytes(32);
  const secure = opts?.secure ?? process.env.AIONUI_HTTPS === 'true';
  const sessions = new Map<string, AuthGateSession>();
  const maxSessions =
    Number.isSafeInteger(opts?.maxSessions) && (opts?.maxSessions ?? 0) > 0
      ? (opts?.maxSessions as number)
      : DEFAULT_MAX_SESSIONS;
  const maxSessionsPerUser =
    Number.isSafeInteger(opts?.maxSessionsPerUser) && (opts?.maxSessionsPerUser ?? 0) > 0
      ? (opts?.maxSessionsPerUser as number)
      : DEFAULT_MAX_SESSIONS_PER_USER;

  const sign = (payload: string): string => createHmac('sha256', secret).update(payload).digest('base64url');

  const cookieAttrs = (maxAgeSec: number): string => {
    const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
  };

  const pruneExpiredSessions = (): void => {
    const currentTime = nowSec();
    for (const [sessionId, session] of sessions) {
      if (session.exp <= currentTime) sessions.delete(sessionId);
    }
  };

  /** Evict oldest sessions before inserting a new one (Map preserves insertion order). */
  const reserveSessionSlot = (userId: string | undefined): void => {
    const sameUser = Array.from(sessions.entries()).filter(([, session]) => session.userId === userId);
    for (let index = 0; index <= sameUser.length - maxSessionsPerUser; index += 1) {
      const sessionId = sameUser[index]?.[0];
      if (sessionId) sessions.delete(sessionId);
    }
    while (sessions.size >= maxSessions) {
      const oldest = sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      sessions.delete(oldest);
    }
  };

  const parseSignedTokenPayload = (token: string | undefined | null): AuthGatePayload | null => {
    if (!token) return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;

    const payload = token.slice(0, dot);
    const sig = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(sign(payload));
    // Constant-time compare; bail before timingSafeEqual on length mismatch
    // (it throws on differing lengths).
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;

    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuthGatePayload;
      if (!Number.isSafeInteger(decoded.exp) || decoded.exp <= nowSec()) return null;
      if (typeof decoded.sid !== 'string' || !decoded.sid) return null;
      return decoded;
    } catch {
      return null;
    }
  };

  const parseActiveTokenPayload = (token: string | undefined | null): AuthGatePayload | null => {
    pruneExpiredSessions();
    const payload = parseSignedTokenPayload(token);
    if (!payload?.sid || typeof payload.exp !== 'number') return null;
    const session = sessions.get(payload.sid);
    if (!session || session.exp !== payload.exp) return null;
    const payloadUserId = typeof payload.user_id === 'string' ? payload.user_id.trim() || undefined : undefined;
    if (session.userId !== payloadUserId) return null;
    return payload;
  };

  const normalizeMintArgs = (
    identityOrTtlSec?: AuthGateIdentity | number,
    ttlSec?: number
  ): { identity?: AuthGateIdentity; ttlSec: number } => {
    const requestedTtl = typeof identityOrTtlSec === 'number' ? identityOrTtlSec : (ttlSec ?? DEFAULT_TTL_SEC);
    const normalizedTtl = Number.isFinite(requestedTtl) ? Math.trunc(requestedTtl) : DEFAULT_TTL_SEC;
    if (typeof identityOrTtlSec === 'number') return { ttlSec: normalizedTtl };
    return { identity: identityOrTtlSec, ttlSec: normalizedTtl };
  };

  return {
    mintToken(identityOrTtlSec?: AuthGateIdentity | number, ttlSec?: number): string {
      const args = normalizeMintArgs(identityOrTtlSec, ttlSec);
      pruneExpiredSessions();
      const sessionId = randomBytes(18).toString('base64url');
      const exp = nowSec() + args.ttlSec;
      const userId = args.identity?.userId.trim() || undefined;
      const body: AuthGatePayload = { exp, sid: sessionId };
      if (userId) {
        body.user_id = userId;
        if (args.identity.username) body.username = args.identity.username;
      }
      const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
      reserveSessionSlot(userId);
      sessions.set(sessionId, { exp, userId });
      return `${payload}.${sign(payload)}`;
    },

    mintCookie(identityOrTtlSec?: AuthGateIdentity | number, ttlSec?: number): string {
      const args = normalizeMintArgs(identityOrTtlSec, ttlSec);
      return `${GATE_COOKIE_NAME}=${this.mintToken(args.identity, args.ttlSec)}; ${cookieAttrs(args.ttlSec)}`;
    },

    clearCookie(): string {
      return `${GATE_COOKIE_NAME}=; ${cookieAttrs(0)}`;
    },

    revokeToken(token): boolean {
      pruneExpiredSessions();
      const payload = parseSignedTokenPayload(token);
      return Boolean(payload?.sid && sessions.delete(payload.sid));
    },

    revokeCookie(cookieHeader): boolean {
      return this.revokeToken(parseCookie(cookieHeader, GATE_COOKIE_NAME));
    },

    revokeUserSessions(userId): number {
      pruneExpiredSessions();
      const normalizedUserId = userId.trim();
      if (!normalizedUserId) return 0;
      let revoked = 0;
      for (const [sessionId, session] of sessions) {
        if (session.userId !== normalizedUserId) continue;
        sessions.delete(sessionId);
        revoked += 1;
      }
      return revoked;
    },

    getAuthorizedTokenIdentity(token): AuthGateIdentity | null {
      return identityFromPayload(parseActiveTokenPayload(token));
    },

    getAuthorizedIdentity(cookieHeader): AuthGateIdentity | null {
      return this.getAuthorizedTokenIdentity(parseCookie(cookieHeader, GATE_COOKIE_NAME));
    },

    isAuthorizedToken(token): boolean {
      return parseActiveTokenPayload(token) !== null;
    },

    isAuthorized(cookieHeader): boolean {
      return this.isAuthorizedToken(parseCookie(cookieHeader, GATE_COOKIE_NAME));
    },
  };
}
