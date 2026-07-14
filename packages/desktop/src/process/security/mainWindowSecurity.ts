/**
 * Pure URL policy helpers for the privileged desktop renderer.
 *
 * Keep these helpers free of Electron imports so the policy can be unit tested
 * without constructing a BrowserWindow.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const IMAGE_WORKBENCH_PROTOCOL = 'centaur-image-workbench:';
const IMAGE_WORKBENCH_SETTINGS_PATH = '/__backend/api/settings/client';

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isExternalHttpUrl(value: string): boolean {
  const parsed = parseUrl(value);
  return parsed?.protocol === 'http:' || parsed?.protocol === 'https:';
}

/**
 * The main renderer may only remain on its exact packaged file or the exact
 * loopback dev-server origin selected at startup. Hash/history navigation is
 * allowed; navigating the privileged window to another file or origin is not.
 */
export function isTrustedMainRendererUrl(targetValue: string, entryValue: string): boolean {
  const target = parseUrl(targetValue);
  const entry = parseUrl(entryValue);
  if (!target || !entry || target.protocol !== entry.protocol) return false;

  if (entry.protocol === 'file:') {
    return target.host === entry.host && target.pathname === entry.pathname;
  }

  if (entry.protocol !== 'http:' && entry.protocol !== 'https:') return false;
  if (!LOOPBACK_HOSTS.has(entry.hostname.toLowerCase())) return false;
  return target.origin === entry.origin;
}

export type DistributedServerTarget = {
  /** Normalized hostname, including brackets for an IPv6 literal. */
  host: string;
  port: number;
  origin: string;
};

/** Parse the user-selected/discovered server without accepting URL syntax. */
export function normalizeDistributedServerTarget(
  hostValue: unknown,
  portValue: unknown
): DistributedServerTarget | null {
  if (typeof hostValue !== 'string') return null;
  const rawHost = hostValue.trim();
  const port = Number(portValue);
  if (
    !rawHost ||
    rawHost.length > 253 ||
    // oxlint-disable-next-line no-control-regex -- Host validation intentionally rejects ASCII controls.
    /[\u0000-\u0020/\\?#@]/.test(rawHost) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return null;
  }

  try {
    const hostForUrl = rawHost.includes(':') && !rawHost.startsWith('[') ? `[${rawHost}]` : rawHost;
    const parsed = new URL(`http://${hostForUrl}:${port}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return { host: parsed.hostname, port, origin: parsed.origin };
  } catch {
    return null;
  }
}

/** Exact CORS origin accepted for requests initiated by the privileged entry. */
export function isTrustedRendererCorsOrigin(origin: string | undefined, entryValue: string): boolean {
  if (!origin || /[\r\n]/.test(origin)) return false;
  const entry = parseUrl(entryValue);
  if (!entry) return false;
  if (entry.protocol === 'file:') return origin === 'null' || origin === 'file://';
  return (entry.protocol === 'http:' || entry.protocol === 'https:') && origin === entry.origin;
}

/**
 * Guest webviews intentionally support ordinary web pages. Only navigable web
 * schemes, local HTML preview sources (file/data), and the bundled image
 * workbench protocol are accepted. Local previews remain isolated guests with
 * no preload/Node capability; javascript: and other active pseudo-schemes are
 * rejected.
 */
export function isAllowedGuestUrl(value: string): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'file:' || parsed.protocol === 'data:') return true;
  return isTrustedImageWorkbenchDocumentUrl(value);
}

/** Only the bundled custom origin may live in a privileged workbench partition. */
export function isTrustedImageWorkbenchDocumentUrl(value: string): boolean {
  const parsed = parseUrl(value);
  return parsed?.protocol === IMAGE_WORKBENCH_PROTOCOL && parsed.hostname === 'app';
}

/** The legacy backend bridge is now one exact, non-forwarded settings probe. */
export function isAllowedImageWorkbenchBackendRequest(method: string, pathname: string): boolean {
  return pathname === IMAGE_WORKBENCH_SETTINGS_PATH && (method === 'PUT' || method === 'OPTIONS');
}

/** Strict surface exposed by the Electron-only local vector protocol. */
export function isAllowedLocalVectorProxyRequest(method: string, pathname: string): boolean {
  if (method === 'GET' && (pathname === '/api/documents' || pathname === '/api/image')) return true;
  if (method === 'POST' && (pathname === '/api/search' || pathname === '/api/upload')) return true;
  return method === 'DELETE' && /^\/api\/documents\/[^/]+$/.test(pathname);
}
