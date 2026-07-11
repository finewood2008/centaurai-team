import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '@arco-design/web-react';
import { fetchWithWebuiAuth, isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';

export type HubUrlPreview = {
  title: string;
  url: string;
  /** Raster images are rendered with <img>; all other passive files use a
   * capability-free sandboxed frame. Active content is always forced to text. */
  mode?: 'auto' | 'image' | 'text';
};

type HubUrlPreviewModalProps = {
  preview: HubUrlPreview | null;
  onClose: () => void;
};

const ACTIVE_CONTENT_EXTENSION_RE = /\.(?:html?|xhtml|svgz?|xml)(?:$|[?#&])/i;
const RASTER_IMAGE_EXTENSION_RE = /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:$|[?#&])/i;

function decodedForInspection(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Defense in depth: inspect both the display name and encoded preview URL.
 * The latter matters for endpoints such as `?path=payload%2Esvg`. */
export function isActiveHubPreview(preview: Pick<HubUrlPreview, 'title' | 'url'>): boolean {
  return [preview.title, preview.url].some((value) => ACTIVE_CONTENT_EXTENSION_RE.test(decodedForInspection(value)));
}

function isRasterImagePreview(preview: Pick<HubUrlPreview, 'title' | 'url'>): boolean {
  return [preview.title, preview.url].some((value) => RASTER_IMAGE_EXTENSION_RE.test(decodedForInspection(value)));
}

export const MAX_ACTIVE_PREVIEW_BYTES = 1024 * 1024;
export const MAX_REMOTE_PREVIEW_BYTES = 64 * 1024 * 1024;

type StreamLimitOptions = {
  maxBytes: number;
  rejectWhenExceeded: boolean;
  onChunk: (chunk: Uint8Array) => void;
};

async function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The transport may already be closed/aborted.
  }
}

/** Consume a response incrementally and stop at a hard decoded-body byte
 * boundary. Counting stream chunks also covers compressed responses whose
 * declared Content-Length is smaller than their decoded body. */
async function consumeResponseBodyLimited(response: Response, options: StreamLimitOptions): Promise<boolean> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (options.rejectWhenExceeded && Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      // Best effort: the caller will discard the response either way.
    }
    throw new Error('PREVIEW_TOO_LARGE');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('PREVIEW_BODY_UNAVAILABLE');

  let consumed = 0;
  let exceeded = false;
  try {
    while (true) {
      // A ReadableStream is intentionally sequential; parallel reads would
      // defeat backpressure and the byte-limit accounting.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      const remaining = options.maxBytes - consumed;
      if (value.byteLength > remaining) {
        if (!options.rejectWhenExceeded && remaining > 0) {
          options.onChunk(value.subarray(0, remaining));
          consumed += remaining;
        }
        exceeded = true;
        // eslint-disable-next-line no-await-in-loop
        await cancelQuietly(reader);
        break;
      }

      options.onChunk(value);
      consumed += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (exceeded && options.rejectWhenExceeded) throw new Error('PREVIEW_TOO_LARGE');
  return exceeded;
}

/** Exported for a focused regression test of the active-content byte cap. */
export async function readActiveContentText(response: Response): Promise<string> {
  const decoder = new TextDecoder();
  let content = '';
  await consumeResponseBodyLimited(response, {
    maxBytes: MAX_ACTIVE_PREVIEW_BYTES,
    rejectWhenExceeded: false,
    onChunk: (chunk) => {
      content += decoder.decode(chunk, { stream: true });
    },
  });
  return content + decoder.decode();
}

async function readBoundedPreviewBlob(response: Response): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  await consumeResponseBodyLimited(response, {
    maxBytes: MAX_REMOTE_PREVIEW_BYTES,
    rejectWhenExceeded: true,
    // Copy each view before the stream advances; implementations may recycle
    // their internal transport buffers.
    onChunk: (chunk) => {
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      chunks.push(copy.buffer);
    },
  });
  return new Blob(chunks, {
    type: response.headers.get('content-type') || 'application/octet-stream',
  });
}

type PreviewResource = { source: string; url: string; failed: boolean };

/** iframe/img navigations cannot attach the distributed client's gate header.
 * In that mode only, fetch through the authenticated transport, enforce a
 * bounded body, and render an ephemeral local object URL. */
function useBoundedPreviewResource(source: string): Pick<PreviewResource, 'url' | 'failed'> {
  const needsAuthenticatedFetch = isRemoteClientBridgeMode() && !/^(?:blob|data):/i.test(source);
  const [resource, setResource] = useState<PreviewResource>({ source: '', url: '', failed: false });

  useEffect(() => {
    if (!needsAuthenticatedFetch) return;
    const controller = new AbortController();
    let disposed = false;
    let objectUrl = '';
    setResource({ source, url: '', failed: false });

    void fetchWithWebuiAuth(source, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`preview failed: ${response.status}`);
        const blob = await readBoundedPreviewBlob(response);
        const nextUrl = URL.createObjectURL(blob);
        if (disposed) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        objectUrl = nextUrl;
        setResource({ source, url: nextUrl, failed: false });
      })
      .catch(() => {
        if (!disposed) setResource({ source, url: '', failed: true });
      });

    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [needsAuthenticatedFetch, source]);

  if (!needsAuthenticatedFetch) return { url: source, failed: false };
  return resource.source === source ? resource : { url: '', failed: false };
}

const PreviewUnavailable: React.FC = () => (
  <div className='h-[72vh] flex items-center justify-center text-t-secondary'>Preview unavailable</div>
);

/** HTML/SVG/XML must never become a same-origin browsing context. Fetching the
 * bytes and handing them to React as a text node keeps markup inert. */
const ActiveContentTextPreview: React.FC<{ preview: HubUrlPreview }> = ({ preview }) => {
  const [content, setContent] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setContent('');
    setFailed(false);
    void fetchWithWebuiAuth(preview.url, {
      credentials: 'include',
      signal: controller.signal,
      headers: { accept: 'text/plain, text/html, image/svg+xml, application/xml;q=0.9, */*;q=0.1' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`preview failed: ${response.status}`);
        const text = await readActiveContentText(response);
        if (!controller.signal.aborted) setContent(text);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [preview.url]);

  if (failed) return <PreviewUnavailable />;

  return (
    <pre
      data-testid='hub-active-content-text-preview'
      className='h-[72vh] overflow-auto whitespace-pre-wrap break-words m-0 p-12px rd-6px bg-[var(--color-bg-2)] text-12px'
    >
      {content}
    </pre>
  );
};

const PassiveImagePreview: React.FC<{ preview: HubUrlPreview }> = ({ preview }) => {
  const resource = useBoundedPreviewResource(preview.url);
  if (resource.failed) return <PreviewUnavailable />;
  if (!resource.url) return <div className='h-[72vh] bg-[var(--color-bg-2)]' />;
  return (
    <img
      alt={preview.title}
      src={resource.url}
      referrerPolicy='no-referrer'
      className='block w-full h-[72vh] object-contain rd-6px bg-[var(--color-bg-2)]'
    />
  );
};

const PassiveFramePreview: React.FC<{ preview: HubUrlPreview }> = ({ preview }) => {
  const resource = useBoundedPreviewResource(preview.url);
  if (resource.failed) return <PreviewUnavailable />;
  return (
    <iframe
      title={preview.title}
      src={resource.url || undefined}
      // Intentionally empty: no scripts, same-origin access, forms, popups,
      // navigation, downloads or other browsing capabilities.
      sandbox=''
      referrerPolicy='no-referrer'
      className='w-full h-[72vh] border-0 rd-6px bg-[var(--color-bg-2)]'
    />
  );
};

const HubUrlPreviewModal: React.FC<HubUrlPreviewModalProps> = ({ preview, onClose }) => {
  const renderMode = useMemo(() => {
    if (!preview) return 'frame';
    // Callers cannot opt active content back into an iframe.
    if (isActiveHubPreview(preview) || preview.mode === 'text') return 'text';
    if (preview.mode === 'image' || isRasterImagePreview(preview)) return 'image';
    return 'frame';
  }, [preview]);

  return (
    <Modal
      visible={!!preview}
      title={preview?.title}
      footer={null}
      onCancel={onClose}
      unmountOnExit
      style={{ width: 'min(960px, 92vw)' }}
    >
      {preview && renderMode === 'text' && <ActiveContentTextPreview preview={preview} />}
      {preview && renderMode === 'image' && <PassiveImagePreview preview={preview} />}
      {preview && renderMode === 'frame' && <PassiveFramePreview preview={preview} />}
    </Modal>
  );
};

export default HubUrlPreviewModal;
