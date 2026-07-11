import { describe, expect, it } from 'vitest';
import {
  isAllowedGuestUrl,
  isAllowedImageWorkbenchBackendRequest,
  isAllowedLocalVectorProxyRequest,
  isExternalHttpUrl,
  isTrustedImageWorkbenchDocumentUrl,
  isTrustedMainRendererUrl,
  isTrustedRendererCorsOrigin,
  normalizeDistributedServerTarget,
} from '@/process/security/mainWindowSecurity';

describe('main window URL security policy', () => {
  it('allows same-origin loopback development navigation', () => {
    expect(isTrustedMainRendererUrl('http://localhost:5173/settings?tab=system#gpu', 'http://localhost:5173/')).toBe(
      true
    );
    expect(isTrustedMainRendererUrl('http://127.0.0.1:5173/#/chat', 'http://127.0.0.1:5173/')).toBe(true);
  });

  it('rejects non-loopback dev entries and origin changes', () => {
    expect(isTrustedMainRendererUrl('https://attacker.example/', 'http://localhost:5173/')).toBe(false);
    expect(isTrustedMainRendererUrl('http://localhost:9999/', 'http://localhost:5173/')).toBe(false);
    expect(isTrustedMainRendererUrl('https://app.example/', 'https://app.example/')).toBe(false);
  });

  it('only allows the exact packaged renderer file', () => {
    const entry = 'file:///opt/CentaurAI/resources/app.asar/out/renderer/index.html';
    expect(isTrustedMainRendererUrl(`${entry}#/conversation/1`, entry)).toBe(true);
    expect(isTrustedMainRendererUrl('file:///home/user/.ssh/id_rsa', entry)).toBe(false);
  });

  it('only delegates ordinary web URLs to the operating system', () => {
    expect(isExternalHttpUrl('https://centaurai.com/docs')).toBe(true);
    expect(isExternalHttpUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isExternalHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('allows isolated preview sources and the controlled image workbench but rejects script schemes', () => {
    expect(isAllowedGuestUrl('https://example.com/')).toBe(true);
    expect(isAllowedGuestUrl('http://127.0.0.1:18791/')).toBe(true);
    expect(isAllowedGuestUrl('centaur-image-workbench://app/index.html')).toBe(true);
    expect(isAllowedGuestUrl('centaur-image-workbench://evil/index.html')).toBe(false);
    expect(isAllowedGuestUrl('file:///home/user/workspace/preview.html')).toBe(true);
    expect(isAllowedGuestUrl('data:text/html,<h1>preview</h1>')).toBe(true);
    expect(isAllowedGuestUrl('javascript:alert(1)')).toBe(false);
  });

  it('locks privileged workbench partitions to the bundled custom origin', () => {
    expect(isTrustedImageWorkbenchDocumentUrl('centaur-image-workbench://app/index.html?model=test')).toBe(true);
    expect(isTrustedImageWorkbenchDocumentUrl('centaur-image-workbench://evil/index.html')).toBe(false);
    expect(isTrustedImageWorkbenchDocumentUrl('https://attacker.example/')).toBe(false);
    expect(isTrustedImageWorkbenchDocumentUrl('data:text/html,attacker')).toBe(false);
  });

  it('does not reintroduce a generic workbench-to-backend proxy', () => {
    expect(isAllowedImageWorkbenchBackendRequest('PUT', '/__backend/api/settings/client')).toBe(true);
    expect(isAllowedImageWorkbenchBackendRequest('OPTIONS', '/__backend/api/settings/client')).toBe(true);
    expect(isAllowedImageWorkbenchBackendRequest('GET', '/__backend/api/settings/client')).toBe(false);
    expect(isAllowedImageWorkbenchBackendRequest('POST', '/__backend/api/fs/read')).toBe(false);
    expect(isAllowedImageWorkbenchBackendRequest('DELETE', '/__backend/api/agents/custom/evil')).toBe(false);
  });

  it('keeps the local vector capability on a minimal route allowlist', () => {
    expect(isAllowedLocalVectorProxyRequest('GET', '/api/documents')).toBe(true);
    expect(isAllowedLocalVectorProxyRequest('POST', '/api/search')).toBe(true);
    expect(isAllowedLocalVectorProxyRequest('POST', '/api/upload')).toBe(true);
    expect(isAllowedLocalVectorProxyRequest('DELETE', '/api/documents/doc%2Fid')).toBe(true);
    expect(isAllowedLocalVectorProxyRequest('POST', '/api/reindex')).toBe(false);
    expect(isAllowedLocalVectorProxyRequest('GET', '/api/memory/files')).toBe(false);
    expect(isAllowedLocalVectorProxyRequest('GET', '/api/documents/../../etc/passwd')).toBe(false);
  });

  it('normalizes only a host plus a valid TCP port for distributed clients', () => {
    expect(normalizeDistributedServerTarget('192.168.1.20', 25812)).toEqual({
      host: '192.168.1.20',
      port: 25812,
      origin: 'http://192.168.1.20:25812',
    });
    expect(normalizeDistributedServerTarget('server.local', '25812')).toEqual({
      host: 'server.local',
      port: 25812,
      origin: 'http://server.local:25812',
    });
    expect(normalizeDistributedServerTarget('http://attacker.example', 80)).toBeNull();
    expect(normalizeDistributedServerTarget('server.local/path', 25812)).toBeNull();
    expect(normalizeDistributedServerTarget('user@server.local', 25812)).toBeNull();
    expect(normalizeDistributedServerTarget('server.local', 65_536)).toBeNull();
  });

  it('reflects CORS only for the exact privileged renderer origin', () => {
    const packagedEntry = 'file:///opt/CentaurAI/resources/app.asar/out/renderer/index.html';
    expect(isTrustedRendererCorsOrigin('null', packagedEntry)).toBe(true);
    expect(isTrustedRendererCorsOrigin('file://', packagedEntry)).toBe(true);
    expect(isTrustedRendererCorsOrigin('https://attacker.example', packagedEntry)).toBe(false);

    const devEntry = 'http://localhost:5173/';
    expect(isTrustedRendererCorsOrigin('http://localhost:5173', devEntry)).toBe(true);
    expect(isTrustedRendererCorsOrigin('http://localhost:5174', devEntry)).toBe(false);
  });
});
