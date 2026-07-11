/**
 * imageThumb — helpers for resolving Content-Hub thumbnails to `data:` URLs.
 *
 * `data:` is the only image source the hub uses everywhere (it's what
 * getImageBase64 returns for 生成物), so funnelling Enterprise NAS / knowledge
 * thumbnails through it too avoids img-src / blob: / cross-origin pitfalls.
 */
import { ipcBridge } from '@/common';
import { fetchWithWebuiAuth, isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { sharedDriveLocal } from '@/common/adapter/ipcBridge';
import { sharedPreviewUrl } from '@/renderer/services/SharedDriveService';

/** Convert a Blob to a `data:` URL via FileReader. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result as string));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

/**
 * Resolve a shared-library item to a `data:` URL. Desktop reads the local blob
 * file directly (the Enterprise NAS-compatible store is IPC-backed there); WebUI fetches the
 * server preview URL and inlines the bytes.
 */
export async function loadSharedImage(id: string): Promise<string | null> {
  try {
    if (isElectronDesktop() && !isRemoteClientBridgeMode()) {
      const info = await sharedDriveLocal.blobInfo.invoke({ id });
      if (!info?.path) return null;
      return await ipcBridge.fs.getImageBase64.invoke({ path: info.path });
    }
    const resp = await fetchWithWebuiAuth(await sharedPreviewUrl(id));
    if (!resp.ok) return null;
    return await blobToDataUrl(await resp.blob());
  } catch {
    return null;
  }
}
