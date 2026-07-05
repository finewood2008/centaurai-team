/**
 * @vitest-environment-options { "url": "http://server.lan:8080/" }
 *
 * The renderer ↔ web-host URL contract for the LAN workbenches: in a browser (no
 * Electron <webview>), WebviewHost rewrites the desktop workbench URL to the
 * same-origin HTTP route served by static-server (verified end-to-end with a real
 * browser in packages/web-host). The jsdom origin is set to a non-localhost host
 * so the same-origin rewrite is actually exercised (not a coincidental passthrough).
 */
import { describe, it, expect } from 'vitest';
import { adaptWorkbenchUrlForBrowser } from '@renderer/components/media/WebviewHost';

const ORIGIN = 'http://server.lan:8080';

describe('adaptWorkbenchUrlForBrowser — image workbench', () => {
  it('maps the custom-protocol URL to the same-origin HTTP route without injecting provider config', () => {
    const desktopUrl = new URL('centaur-image-workbench://app/index.html');
    desktopUrl.searchParams.set('disableServiceWorker', 'true');

    const out = adaptWorkbenchUrlForBrowser(desktopUrl.toString());
    expect(out).not.toBeNull();
    const u = new URL(out!);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe('/workbench/image/index.html');
    expect(u.searchParams.get('disableServiceWorker')).toBe('true');
    expect(u.searchParams.get('apiUrl')).toBeNull();
    expect(u.searchParams.get('model')).toBeNull();
    expect(u.searchParams.get('apiMode')).toBeNull();
    expect(u.searchParams.get('profileName')).toBeNull();
    expect(u.searchParams.get('apiKey')).toBeNull();
  });

  it('preserves custom-protocol HTML entry filenames for sibling workbenches', () => {
    expect(adaptWorkbenchUrlForBrowser('centaur-image-workbench://app/comfyui-simple.html')).toBe(
      `${ORIGIN}/workbench/image/comfyui-simple.html`
    );
  });
});

describe('adaptWorkbenchUrlForBrowser — no browser equivalent', () => {
  it('returns null so the caller falls back to the raw URL', () => {
    expect(adaptWorkbenchUrlForBrowser('https://example.com/foo')).toBeNull();
    expect(adaptWorkbenchUrlForBrowser('http://localhost:5173/workbench')).toBeNull();
    expect(adaptWorkbenchUrlForBrowser('http://localhost:3000/projects')).toBeNull();
  });
});
