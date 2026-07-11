import { describe, expect, it } from 'vitest';
import { safeFileResponseHeaders, safeInlineContentType } from './safe-preview.js';

describe('same-origin file preview hardening', () => {
  it.each(['text/html; charset=utf-8', 'image/svg+xml', 'application/xhtml+xml', 'application/atom+xml'])(
    'makes active document MIME inert: %s',
    (mime) => {
      expect(safeInlineContentType(mime)).toBe('text/plain; charset=utf-8');
    }
  );

  it('preserves passive image/PDF/media MIME types', () => {
    expect(safeInlineContentType('image/png')).toBe('image/png');
    expect(safeInlineContentType('application/pdf')).toBe('application/pdf');
    expect(safeInlineContentType('video/mp4')).toBe('video/mp4');
  });

  it('adds nosniff to every file and a restrictive sandbox to inline previews', () => {
    expect(safeFileResponseHeaders(false)).toMatchObject({ 'x-content-type-options': 'nosniff' });
    expect(safeFileResponseHeaders(false)).not.toHaveProperty('content-security-policy');
    expect(safeFileResponseHeaders(true)['content-security-policy']).toContain("sandbox; default-src 'none'");
  });
});
