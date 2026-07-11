/**
 * Security policy for AI/user-authored HTML previews.
 *
 * The preview is intentionally an opaque-origin frame. Combining
 * `allow-scripts` with `allow-same-origin` would let a same-origin srcdoc reach
 * the privileged renderer (and therefore its native bridge). The CSP is placed
 * before attacker-controlled markup so later meta tags cannot loosen it and
 * active content cannot call authenticated APIs or load nested documents.
 */

export const SANDBOXED_HTML_IFRAME_SANDBOX = 'allow-scripts';

export const SANDBOXED_HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' data: blob:",
  "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/** Build a srcdoc/data-URL document whose security policy is parsed first. */
export function buildSandboxedHtmlDocument(content: string, trustedBootstrapScript?: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(SANDBOXED_HTML_CSP)}">`;
  const bootstrap = trustedBootstrapScript
    ? `<script>${trustedBootstrapScript.replace(/<\/script/gi, '<\\/script')}</script>`
    : '';
  return `<!doctype html>${policy}${bootstrap}${content}`;
}
