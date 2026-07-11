import React, { type ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Modal: ({ children, visible }: { children?: ReactNode; visible?: boolean }) =>
      visible ? <div data-testid='modal'>{children}</div> : null,
  };
});

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light' }),
}));

vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({ launchPreview: vi.fn(), loading: false }),
}));

vi.mock('@/renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import Diff2Html from '@/renderer/components/media/Diff2Html';
import HubUrlPreviewModal, {
  MAX_ACTIVE_PREVIEW_BYTES,
  MAX_REMOTE_PREVIEW_BYTES,
  readActiveContentText,
} from '@/renderer/pages/contentHub/components/manage/HubUrlPreviewModal';

const activePayload = '<svg><script data-testid="active-payload">alert(1)</script></svg>';

beforeEach(() => {
  delete (window as Window & { __clientMode?: boolean }).__clientMode;
  delete (window as Window & { __backendPort?: number }).__backendPort;
  delete (window as Window & { __backendHost?: string }).__backendHost;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(activePayload)));
});

afterEach(() => {
  cleanup();
  delete (window as Window & { __clientMode?: boolean }).__clientMode;
  delete (window as Window & { __backendPort?: number }).__backendPort;
  delete (window as Window & { __backendHost?: string }).__backendHost;
  vi.unstubAllGlobals();
});

describe('Content Hub URL preview isolation', () => {
  it('sandboxes passive previews without granting same-origin access', () => {
    render(
      <HubUrlPreviewModal
        preview={{ title: 'report.pdf', url: '/api/nas/preview?path=report.pdf' }}
        onClose={vi.fn()}
      />
    );

    const frame = document.querySelector('iframe');
    expect(frame).toHaveAttribute('sandbox', '');
  });

  it.each([
    ['HTML title', 'payload.html', '/api/nas/preview?path=payload.html'],
    ['encoded SVG URL', 'diagram.png', '/api/nas/preview?path=payload%2Esvg'],
  ])('rejects active content identified from the %s', async (_case, title, url) => {
    render(<HubUrlPreviewModal preview={{ title, url }} onClose={vi.fn()} />);

    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    const textPreview = await screen.findByTestId('hub-active-content-text-preview');
    expect(textPreview.querySelector('svg, script')).toBeNull();
    expect(textPreview.textContent).toContain('<script');
  });

  it('streams active content only up to the byte cap and cancels the remaining body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const read = vi.fn().mockResolvedValueOnce({
      done: false,
      value: new Uint8Array(MAX_ACTIVE_PREVIEW_BYTES + 128).fill('a'.charCodeAt(0)),
    });
    const response = {
      headers: new Headers(),
      body: {
        getReader: () => ({ read, cancel, releaseLock }),
      },
    } as unknown as Response;

    const text = await readActiveContentText(response);

    expect(new TextEncoder().encode(text)).toHaveLength(MAX_ACTIVE_PREVIEW_BYTES);
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('uses a bounded authenticated object URL for passive previews in distributed Electron', async () => {
    Object.assign(window, {
      __clientMode: true,
      __backendPort: 25812,
      __backendHost: '192.168.1.20',
    });
    const createObjectURL = vi.fn(() => 'blob:bounded-preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'application/pdf', 'content-length': '3' },
      })
    );

    render(
      <HubUrlPreviewModal
        preview={{ title: 'report.pdf', url: 'http://192.168.1.20:25812/api/nas/preview?path=report.pdf' }}
        onClose={vi.fn()}
      />
    );

    const frame = document.querySelector('iframe');
    expect(frame).toHaveAttribute('sandbox', '');
    await waitFor(() => expect(frame).toHaveAttribute('src', 'blob:bounded-preview'));
    expect(createObjectURL).toHaveBeenCalledOnce();

    cleanup();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:bounded-preview');
  });

  it('rejects a remote passive preview whose declared body exceeds the hard limit', async () => {
    Object.assign(window, {
      __clientMode: true,
      __backendPort: 25812,
      __backendHost: '192.168.1.20',
    });
    const createObjectURL = vi.fn(() => 'blob:must-not-render');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Uint8Array([1]), {
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(MAX_REMOTE_PREVIEW_BYTES + 1),
        },
      })
    );

    render(
      <HubUrlPreviewModal
        preview={{ title: 'huge.pdf', url: 'http://192.168.1.20:25812/api/nas/preview?path=huge.pdf' }}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('Preview unavailable')).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('Diff title rendering', () => {
  it('renders a crafted title as text instead of executable DOM', () => {
    const craftedTitle = '<img data-testid="title-payload" src=x onerror="window.__pwned=1">report.txt';
    const diff = [
      'diff --git a/report.txt b/report.txt',
      'index 1111111..2222222 100644',
      '--- a/report.txt',
      '+++ b/report.txt',
      '@@ -1 +1 @@',
      '-before',
      '+after',
    ].join('\n');

    render(<Diff2Html diff={diff} title={craftedTitle} file_path='report.txt' />);

    const fileName = document.querySelector('.d2h-file-name');
    expect(fileName?.querySelector('img')).toBeNull();
    expect(fileName?.textContent).toBe(craftedTitle);
  });
});
