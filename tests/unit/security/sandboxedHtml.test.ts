import { describe, expect, it } from 'vitest';
import {
  buildSandboxedHtmlDocument,
  SANDBOXED_HTML_CSP,
  SANDBOXED_HTML_IFRAME_SANDBOX,
} from '@/renderer/utils/security/sandboxedHtml';

describe('untrusted HTML preview isolation', () => {
  it('keeps script previews on an opaque origin', () => {
    expect(SANDBOXED_HTML_IFRAME_SANDBOX).toBe('allow-scripts');
    expect(SANDBOXED_HTML_IFRAME_SANDBOX).not.toContain('allow-same-origin');
  });

  it('parses a fail-closed CSP before attacker markup', () => {
    const payload = '<script>parent.electronAPI.fs.readFile()</script><iframe src="https://evil.example"></iframe>';
    const document = buildSandboxedHtmlDocument(payload);

    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf(payload));
    expect(SANDBOXED_HTML_CSP).toContain("connect-src 'none'");
    expect(SANDBOXED_HTML_CSP).toContain("frame-src 'none'");
    expect(SANDBOXED_HTML_CSP).toContain("form-action 'none'");
    expect(SANDBOXED_HTML_CSP).not.toMatch(/\bhttps?:/);
  });

  it('does not let a bootstrap string terminate its trusted script element', () => {
    const document = buildSandboxedHtmlDocument('<p>preview</p>', '</script><script>globalThis.pwned=true</script>');
    expect(document).not.toContain('</script><script>globalThis.pwned=true');
    expect(document).toContain('<\\/script>');
  });
});
