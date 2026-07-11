/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * App Store IPC bridge — exposes the bundled app catalog (manifest registry ⨉
 * ConfigFile state) and the CentaurAI-MANAGED install/launch of standalone apps:
 * "install" copies the app bundle into a default dir under userData; "launch"
 * spawns it as its own standalone window (a separate process, not embedded in
 * CentaurAI). The launch entry stays in the CentaurAI App Store.
 */

import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { ipcBridge } from '@/common';
import { getApps } from '@process/appstore/registry';
import { listAppRecords, setAppInstalled } from '@process/appstore/appState';
import { resolveAppstoreChildPath } from '@process/appstore/pathSecurity';
import { ProcessConfig } from '@process/utils/initStorage';

/** The Electron entry within each app's bundle (for managed launch). */
const APP_ENTRY: Record<string, string> = {
  'centaur-image-workbench': 'electron/main.cjs',
};
const MANAGED_APP_IDS = new Set(Object.keys(APP_ENTRY));

function isManagedAppId(id: string): boolean {
  return MANAGED_APP_IDS.has(id);
}

/**
 * Apps hidden from the App Store catalog. The image workbench is now embedded
 * inline under the 「AI工作台」 sider section (and served to LAN browsers over
 * /workbench/image/*), so it no longer appears as a download-gated store card.
 * Its manifest is kept for the inline proxy/agent wiring; it is just delisted.
 */
const STORE_HIDDEN_APP_IDS = new Set<string>(['centaur-image-workbench']);

/**
 * Locate an app's bundled payload (electron shell + dist), shipped in
 * resources/appstore-bundles/<id> (extraResources) so it's present on BOTH the
 * admin desktop and the LAN client — "install" is a local copy, no server fetch.
 */
function resolveAppstoreBundleDir(id: string): string | null {
  if (!isManagedAppId(id)) return null;
  const candidates: string[] = [];
  if (process.env.AIONUI_APPSTORE_BUNDLES_DIR) {
    const candidate = resolveAppstoreChildPath(process.env.AIONUI_APPSTORE_BUNDLES_DIR, id);
    if (candidate) candidates.push(candidate);
  }
  const rp = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (rp) {
    const candidate = resolveAppstoreChildPath(path.join(rp, 'appstore-bundles'), id);
    if (candidate) candidates.push(candidate);
  }
  const devCandidate = resolveAppstoreChildPath(path.join(process.cwd(), 'resources', 'appstore-bundles'), id);
  if (devCandidate) candidates.push(devCandidate);
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function appInstallDir(id: string): string | null {
  if (!isManagedAppId(id)) return null;
  return resolveAppstoreChildPath(path.join(app.getPath('userData'), 'appstore-apps'), id);
}

/** Copy an app's bundled payload into its default install dir and mark it installed. */
async function installBundle(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isManagedAppId(id)) return { ok: false, error: 'INVALID_APP_ID' };
  const src = resolveAppstoreBundleDir(id);
  if (!src) return { ok: false, error: 'NO_BUNDLE' };
  const dest = appInstallDir(id);
  if (!dest) return { ok: false, error: 'INVALID_APP_ID' };
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true });
  await setAppInstalled(ProcessConfig, id, true);
  console.info(`[AppStore] installed '${id}' → ${dest}`);
  return { ok: true };
}

export function initAppstoreBridge(): void {
  ipcBridge.appstore.list.provider(async () => {
    try {
      const [allManifests, records] = await Promise.all([getApps(), listAppRecords(ProcessConfig)]);
      const manifests = allManifests.filter((manifest) => !STORE_HIDDEN_APP_IDS.has(manifest.id));
      return {
        apps: manifests.map((manifest) => ({
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          icon: manifest.icon,
          category: manifest.category,
          type: manifest.type,
          enabled: records[manifest.id]?.enabled ?? false,
          installed: manifest.type === 'local-service' ? true : (records[manifest.id]?.installed ?? false),
          artifacts: manifest.distribution?.artifacts ?? [],
        })),
      };
    } catch (error) {
      console.error('[AppStore] Failed to list apps:', error);
      return { apps: [] };
    }
  });

  ipcBridge.appstore.setInstalled.provider(async ({ id, installed }) => {
    try {
      if (!isManagedAppId(id)) return;
      await setAppInstalled(ProcessConfig, id, installed);
    } catch (error) {
      console.error('[AppStore] Failed to set installed state:', error);
    }
  });

  // Managed install — copy the bundled app payload into a default dir under userData.
  ipcBridge.appstore.install.provider(async ({ id }) => {
    try {
      return await installBundle(id);
    } catch (error) {
      console.error('[AppStore] install failed:', error);
      return { ok: false, error: String(error) };
    }
  });

  // Managed launch — spawn the installed app as its own standalone window.
  // Self-heals: if the payload is missing (stale install flag, deleted dir), it
  // re-installs from the bundle first so "打开" always works.
  ipcBridge.appstore.launch.provider(async ({ id }) => {
    const entry = APP_ENTRY[id];
    if (!entry) return { ok: false, error: 'NO_BUNDLE' };
    try {
      const installDir = appInstallDir(id);
      if (!installDir) return { ok: false, error: 'INVALID_APP_ID' };
      const entryPath = path.join(installDir, entry);
      if (!existsSync(entryPath)) {
        const reinstall = await installBundle(id);
        if (!reinstall.ok) return reinstall;
      }
      await fs.access(entryPath);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE; // ensure the child boots as an Electron app, not node
      const child = spawn(process.execPath, [entryPath, '--no-sandbox', '--disable-gpu'], {
        detached: true,
        stdio: 'ignore',
        env,
      });
      child.unref();
      console.info(`[AppStore] launched standalone '${id}'`);
      return { ok: true };
    } catch (error) {
      console.error('[AppStore] launch failed:', error);
      return { ok: false, error: String(error) };
    }
  });
}
