import path from 'node:path';

const APP_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isSafeAppId(id: string): boolean {
  return APP_ID_RE.test(id);
}

/** Resolve exactly one validated child directory; traversal always fails. */
export function resolveAppstoreChildPath(baseDir: string, id: string): string | null {
  if (!isSafeAppId(id)) return null;
  const base = path.resolve(baseDir);
  const child = path.resolve(base, id);
  return path.dirname(child) === base ? child : null;
}
