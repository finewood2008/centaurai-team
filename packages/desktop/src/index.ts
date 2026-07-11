/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// configureChromium sets app name (dev isolation) and Chromium flags — must run before
// ANY module that calls app.getPath('userData'), because Electron caches the path on first call.
import './process/utils/configureChromium';
import { installGpuCrashHandler } from './process/utils/gpuRecovery';
import { captureBackendStartupFailure, initSentry, scheduleStartupLogReport, setSentryDeviceId } from './sentry';

initSentry();

import './process/utils/configureConsoleLog';
import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, protocol, session, shell } from 'electron';
import fixPath from 'fix-path';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import { initMainAdapterWithWindow } from './common/adapter/main';
import { ipcBridge } from './common';
import { initializeProcess } from './process';
import { startBackendOrExit } from './process/startup/backendStartup';
import { assertStartupArchitectureCompatible } from './process/startup/architectureCompatibility';
import { classifyBackendStartupFailure } from './process/startup/backendStartupFailure';
import { resolvePreferredBackendPort } from './process/startup/backendPort';
import { installQuitCleanup } from './process/startup/quitCleanup';
import { ProcessConfig } from './process/utils/initStorage';
import { DESKTOP_PET_ENABLED, LOCAL_VECTOR_DB_PROXY_BASE } from './common/config/constants';
import type { BackendStartupFailureInfo } from './common/types/platform/electron';
import { registerWindowMaximizeListeners } from '@process/bridge';
import { BackendLifecycleManager } from '@aionui/web-host';
import { resolveBinaryPath } from '@process/backend';
import './process/bridge/feedbackBridge';
import { wasLaunchedAtLogin } from '@process/bridge/applicationBridge';
import { onLanguageChanged } from './process/bridge/systemSettingsBridge';
import { announceDesktopWebUIStarted } from './process/bridge/webuiBridge';
import { setInitialLanguage } from '@process/services/i18n';
import { setupApplicationMenu } from './process/utils/appMenu';
import { startWebHost } from '@aionui/web-host';
import { initializeZoomFactor, setupZoomForWindow } from './process/utils/zoom';
import {
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  attachWindowBoundsPersistence,
  loadSavedWindowBounds,
  resolveInitialBounds,
} from './process/utils/windowBounds';
import {
  clearPendingDeepLinkUrl,
  getPendingDeepLinkUrl,
  handleDeepLinkUrl,
  PROTOCOL_SCHEME,
} from './process/utils/deepLink';
import {
  bindMainWindowReferences,
  showAndFocusMainWindow,
  showOrCreateMainWindow,
} from './process/utils/mainWindowLifecycle';
import {
  loadUserWebUIConfig,
  resolveImageWorkbenchConfig,
  resolveVectorEndpoint,
  resolveRemoteAccess,
  resolveWebUIPort,
  restoreDesktopWebUIFromPreferences,
} from './process/utils/webuiConfig';
import {
  createOrUpdateTray,
  destroyTray,
  getCloseToTrayEnabled,
  getIsQuitting,
  refreshTrayMenu,
  setCloseToTrayEnabled,
  setIsQuitting,
} from './process/utils/tray';
import { readCloseToTraySetting } from './process/utils/closeToTraySetting';
import {
  isAllowedGuestUrl,
  isAllowedImageWorkbenchBackendRequest,
  isExternalHttpUrl,
  isTrustedRendererCorsOrigin,
  isTrustedImageWorkbenchDocumentUrl,
  isTrustedMainRendererUrl,
  normalizeDistributedServerTarget,
} from './process/security/mainWindowSecurity';
import { createLocalVectorProtocolHandler } from './process/security/localVectorProtocol';
import { proxyComfyRequest, proxyImageApiRequest } from './process/security/imageWorkbenchProxy';
// @ts-expect-error - electron-squirrel-startup doesn't have types
import electronSquirrelStartup from 'electron-squirrel-startup';

// ============ Single Instance Lock ============
// Acquire lock early so the second instance quits before doing unnecessary work.
// When a second instance starts (e.g. from protocol URL), it sends its data
// to the first instance via second-instance event, then quits.
const isE2ETestMode = process.env.AIONUI_E2E_TEST === '1';
const skipSingleInstanceLock =
  isE2ETestMode || process.env.CENTAURAI_MULTI_INSTANCE === '1' || process.env.AIONUI_MULTI_INSTANCE === '1';
const deepLinkFromArgv = process.argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
const gotTheLock = skipSingleInstanceLock ? true : app.requestSingleInstanceLock({ deepLinkUrl: deepLinkFromArgv });
if (!gotTheLock) {
  console.warn('[CentaurAI] Another instance is already running; current process will exit.');
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    // Prefer additionalData (reliable on all platforms), fallback to argv scan
    const deepLinkUrl =
      (additionalData as { deepLinkUrl?: string })?.deepLinkUrl ||
      argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
    if (deepLinkUrl) {
      handleDeepLinkUrl(deepLinkUrl);
    }
    // Focus existing window or recreate one if needed.
    if (isWebUIMode || isResetPasswordMode) {
      return;
    }

    // Skip window creation if app hasn't finished initializing
    if (!appReadyDone) return;

    if (app.isReady()) {
      showOrCreateMainWindow({
        mainWindow,
        createWindow: () => {
          console.log('[CentaurAI] second-instance received with no active main window, recreating main window');
          createWindow();
        },
      });
    }
  });
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// 修复 macOS 和 Linux 下 GUI 应用的 PATH 环境变量,使其与命令行一致
if (process.platform === 'darwin' || process.platform === 'linux') {
  fixPath();

  // Supplement nvm paths that fix-path might miss (nvm is often only in .zshrc, not .zshenv)
  const nvmDir = process.env.NVM_DIR || path.join(process.env.HOME || '', '.nvm');
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
  if (fs.existsSync(nvmVersionsDir)) {
    try {
      const versions = fs.readdirSync(nvmVersionsDir);
      const nvmPaths = versions.map((v) => path.join(nvmVersionsDir, v, 'bin')).filter((p) => fs.existsSync(p));
      if (nvmPaths.length > 0) {
        const currentPath = process.env.PATH || '';
        const missingPaths = nvmPaths.filter((p) => !currentPath.includes(p));
        if (missingPaths.length > 0) {
          process.env.PATH = [...missingPaths, currentPath].join(path.delimiter);
        }
      }
    } catch {
      // Ignore errors when reading nvm directory
    }
  }
}

// Handle Squirrel startup events (Windows installer)
if (electronSquirrelStartup) {
  app.quit();
}

// Global error handlers for main process
// Sentry automatically captures these, but we keep the handlers to prevent Electron's default error dialog
process.on('uncaughtException', (_error) => {
  // Sentry captures this automatically
});

process.on('unhandledRejection', (_reason, _promise) => {
  // Sentry captures this automatically
});

const hasSwitch = (flag: string) => process.argv.includes(`--${flag}`) || app.commandLine.hasSwitch(flag);
const getSwitchValue = (flag: string): string | undefined => {
  const withEqualsPrefix = `--${flag}=`;
  const equalsArg = process.argv.find((arg) => arg.startsWith(withEqualsPrefix));
  if (equalsArg) {
    return equalsArg.slice(withEqualsPrefix.length);
  }

  const argIndex = process.argv.indexOf(`--${flag}`);
  if (argIndex !== -1) {
    const nextArg = process.argv[argIndex + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      return nextArg;
    }
  }

  const cliValue = app.commandLine.getSwitchValue(flag);
  return cliValue || undefined;
};
const hasCommand = (cmd: string) => process.argv.includes(cmd);

const isWebUIMode = hasSwitch('webui');
const isRemoteMode = hasSwitch('remote');
const isResetPasswordMode = hasCommand('--resetpass');
const isVersionMode = hasCommand('--version') || hasCommand('-v');

/**
 * Distributed-client mode (`AIONUI_CLIENT=1` or `--client`). The renderer shows
 * a "select server" screen, discovers CentaurAI servers on the LAN, then
 * connects to the chosen REMOTE server (host/port below) instead of using a
 * local backend. Native Electron = secure context → microphone/voice works.
 */
/** A packaged client build ships a `client-mode.flag` marker in its resources,
 *  so the distributed client launches in client mode without any env/CLI flag. */
const clientMarkerExists = (): boolean => {
  try {
    return fs.existsSync(path.join(process.resourcesPath, 'client-mode.flag'));
  } catch {
    return false;
  }
};
const isClientMode = process.env.AIONUI_CLIENT === '1' || hasSwitch('client') || clientMarkerExists();
let clientBackendHost = '';
let clientBackendPort = 0;
let clientBackendOrigin = '';

// Flag to distinguish intentional quit from unexpected exit in WebUI mode
let isExplicitQuit = false;

// Guard against premature window creation (e.g. macOS 'activate' firing during init).
// The activate event fires on first launch before handleAppReady finishes initializeProcess(),
// causing the renderer to load and compete with initStorage on the serial configFile queue,
// which blocks startup for 100-265 seconds.
let appReadyDone = false;

let mainWindow: BrowserWindow;
const backendManager = new BackendLifecycleManager(
  {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
  },
  resolveBinaryPath
);
let disposeCronResumeListener: (() => void) | null = null;

// Flag tracking whether the backend subprocess started successfully. Read by
// the deferred runBackendMigrations trigger in createWindow().
let backendStartedOk = false;

const IMAGE_WORKBENCH_PROTOCOL = 'centaur-image-workbench';
const IMAGE_WORKBENCH_API_PROXY_PREFIX = '/__tokenclub';
const IMAGE_WORKBENCH_COMFYUI_PROXY_PREFIX = '/__comfyui';
const IMAGE_WORKBENCH_BACKEND_PROXY_PREFIX = '/__backend';
const DEFAULT_IMAGE_API_BASE_URL = 'https://api.tokenclub.pro';
const COMFYUI_LOCAL_BASE_URL = 'http://127.0.0.1:8188';
const LOCAL_VECTOR_PROTOCOL = new URL(LOCAL_VECTOR_DB_PROXY_BASE).protocol.replace(/:$/, '');
const PRIVILEGED_WORKBENCH_PARTITIONS = [
  'persist:centaur-image-workbench',
  'persist:centaur-comfyui-workbench',
] as const;

protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_WORKBENCH_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: LOCAL_VECTOR_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function getImageWorkbenchRoot(): string {
  if (app.isPackaged) {
    return path.join(__dirname, '../renderer/centaur-image-workbench');
  }
  return path.resolve(process.cwd(), 'public/centaur-image-workbench');
}

function getStaticContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
    case '.webmanifest':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    default:
      return 'application/octet-stream';
  }
}

function registerImageWorkbenchProtocol(): void {
  const createHandler =
    (partition: (typeof PRIVILEGED_WORKBENCH_PARTITIONS)[number]) =>
    async (request: Request): Promise<Response> => {
      const root = getImageWorkbenchRoot();
      const url = new URL(request.url);
      const isComfyPartition = partition === 'persist:centaur-comfyui-workbench';

      if (url.hostname === 'app' && url.pathname.startsWith(IMAGE_WORKBENCH_COMFYUI_PROXY_PREFIX)) {
        return isComfyPartition
          ? proxyComfyImageWorkbenchRequest(request, url)
          : Response.json({ error: 'ComfyUI capability is unavailable in this partition' }, { status: 403 });
      }

      if (url.hostname === 'app' && url.pathname.startsWith(IMAGE_WORKBENCH_BACKEND_PROXY_PREFIX)) {
        if (isComfyPartition) {
          return Response.json({ error: 'Backend capability is unavailable in this partition' }, { status: 403 });
        }
        // The bundled workbench only probes this exact setting write. It is
        // server-managed, so acknowledge without forwarding it. Never turn the
        // custom protocol into a generic bridge to the local trusted backend.
        if (!isAllowedImageWorkbenchBackendRequest(request.method, url.pathname)) {
          return Response.json({ error: 'Unsupported backend proxy path' }, { status: 403 });
        }
        if (request.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: createCorsHeaders() });
        }
        return Response.json({ success: true }, { status: 200, headers: createCorsHeaders() });
      }

      if (url.hostname === 'app' && url.pathname.startsWith(IMAGE_WORKBENCH_API_PROXY_PREFIX)) {
        return isComfyPartition
          ? Response.json({ error: 'Image API capability is unavailable in this partition' }, { status: 403 })
          : proxyImageApiWorkbenchRequest(request, url);
      }

      const requestedPath = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html';
      const filePath = path.resolve(root, requestedPath);

      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
        return new Response('Forbidden', { status: 403 });
      }

      try {
        const data = await fs.promises.readFile(filePath);
        return new Response(data, {
          headers: {
            'Content-Type': getStaticContentType(filePath),
          },
        });
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    };

  // Deliberately do not install the handler on defaultSession: ordinary URL
  // preview webviews live there and must not gain image API/backend proxy
  // capabilities merely by knowing the custom scheme URL.
  for (const partition of PRIVILEGED_WORKBENCH_PARTITIONS) {
    try {
      session.fromPartition(partition).protocol.handle(IMAGE_WORKBENCH_PROTOCOL, createHandler(partition));
    } catch (error) {
      console.warn(`[CentaurAI] Failed to register image workbench protocol on ${partition}:`, error);
    }
  }
}

function createCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  };
}

function registerLocalVectorProtocol(): void {
  try {
    protocol.handle(LOCAL_VECTOR_PROTOCOL, createLocalVectorProtocolHandler(resolveVectorEndpoint));
  } catch (error) {
    console.warn('[CentaurAI] Failed to register local vector protocol:', error);
  }
}

async function proxyImageApiWorkbenchRequest(request: Request, url: URL): Promise<Response> {
  const imageConfig = await resolveImageWorkbenchConfig();
  const upstreamBaseUrl = imageConfig?.baseUrl?.trim() || DEFAULT_IMAGE_API_BASE_URL;
  return proxyImageApiRequest(request, url, {
    prefix: IMAGE_WORKBENCH_API_PROXY_PREFIX,
    baseUrl: upstreamBaseUrl,
    apiKey: imageConfig?.apiKey,
  });
}

async function proxyComfyImageWorkbenchRequest(request: Request, url: URL): Promise<Response> {
  return proxyComfyRequest(request, url, {
    prefix: IMAGE_WORKBENCH_COMFYUI_PROXY_PREFIX,
    baseUrl: COMFYUI_LOCAL_BASE_URL,
  });
}

let backendStartupFailed = false;
let backendStartupFailureInfo: BackendStartupFailureInfo | null = null;
let rendererInitialLanguage: string | null = null;
let backendMigrationsScheduled = false;
let ensureAdminUserPromise: Promise<void> | null = null;
let trustedMainRendererEntryUrl: string | null = null;

ipcMain.on('get-backend-port', (event) => {
  // In client mode, ignore the (harmless) local backend and use the selected
  // remote server's port — 0 until the user picks a server on the connect screen.
  event.returnValue = isClientMode ? clientBackendPort : backendManager.port;
});

ipcMain.on('get-backend-host', (event) => {
  event.returnValue = isClientMode && clientBackendHost ? clientBackendHost : '127.0.0.1';
});

ipcMain.on('get-client-mode', (event) => {
  event.returnValue = isClientMode;
});

// Distributed client: connect to the chosen remote server, then reload so the
// preload re-exposes the new backend host/port to the renderer.
ipcMain.handle('client:connect', (event, payload: { host: string; port: number }) => {
  if (
    !isClientMode ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Unauthorized distributed-client connection request');
  }
  const target = normalizeDistributedServerTarget(payload?.host, payload?.port);
  if (!target) throw new Error('Invalid distributed server address');
  clientBackendHost = target.host;
  clientBackendPort = target.port;
  clientBackendOrigin = target.origin;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  return { host: clientBackendHost, port: clientBackendPort };
});

ipcMain.on('get-initial-language', (event) => {
  event.returnValue = rendererInitialLanguage;
});

ipcMain.on('get-backend-startup-failed', (event) => {
  event.returnValue = backendStartupFailed;
});

ipcMain.on('get-backend-startup-failure', (event) => {
  event.returnValue = backendStartupFailureInfo;
});

function markBackendStartupFailed(error: unknown): void {
  backendStartupFailed = true;
  backendStartupFailureInfo = classifyBackendStartupFailure(error);
  (globalThis as typeof globalThis & { __backendStartupFailed?: boolean }).__backendStartupFailed = true;
}

function registerCronResumeBridge(backendPort: number): void {
  disposeCronResumeListener?.();

  const onResume = () => {
    void fetch(`http://127.0.0.1:${backendPort}/api/cron/internal/system-resume`, {
      method: 'POST',
      headers: {
        'x-aionui-internal': '1',
      },
    }).catch((error) => {
      console.error('[CentaurAI] Failed to notify backend about system resume:', error);
    });
  };

  powerMonitor.on('resume', onResume);
  disposeCronResumeListener = () => {
    powerMonitor.removeListener('resume', onResume);
  };
}

/**
 * Run one-shot backend migrations after the renderer has loaded. Some steps
 * (ConfigStorage.get, ipcBridge.listProviders) route through the renderer via
 * BroadcastChannel, so invoking them before the renderer exists deadlocks the
 * main process. Called from did-finish-load.
 */
const scheduleBackendMigrations = (): void => {
  if (backendMigrationsScheduled || !backendStartedOk) return;
  backendMigrationsScheduled = true;
  void (async () => {
    try {
      const { runBackendMigrations } = await import('./process/utils/runBackendMigrations');
      await runBackendMigrations(ProcessConfig);
      console.info('[CentaurAI] runBackendMigrations completed');
    } catch (error) {
      console.error('[CentaurAI] Backend migration hook threw:', error);
    }
  })();
};

function exposeBackendPort(backendPort: number): void {
  // Expose the backend port to main-process callers of httpBridge (e.g. the
  // one-shot assistant migration hook below). Must land BEFORE any
  // ipcBridge.* invoke from the main process — the renderer side reads
  // window.__backendPort via preload, but main has no `window`.
  (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort = backendPort;
}

function ensureAdminUserOnce(backendPort: number): Promise<void> {
  if (!ensureAdminUserPromise) {
    ensureAdminUserPromise = (async () => {
      try {
        const { ensureAdminUser } = await import('./process/utils/ensureAdminUser');
        await ensureAdminUser(backendPort);
      } catch (err) {
        console.error('[WebUI] ensureAdminUser failed:', err);
      }
    })();
  }
  return ensureAdminUserPromise;
}

function markBackendReady(backendPort: number, source: string): void {
  if (backendStartedOk) return;
  console.log(`[CentaurAI] ${source} ready (port=${backendPort})`);
  exposeBackendPort(backendPort);
  registerCronResumeBridge(backendPort);
  backendStartedOk = true;
  backendStartupFailed = false;
  backendStartupFailureInfo = null;
  (globalThis as typeof globalThis & { __backendStartupFailed?: boolean }).__backendStartupFailed = false;
  void ensureAdminUserOnce(backendPort);
  scheduleBackendMigrations();
}

function openExternalHttpUrl(url: string): void {
  if (!isExternalHttpUrl(url)) return;
  void shell.openExternal(url).catch((error) => {
    console.warn('[CentaurAI] Failed to open external URL:', error);
  });
}

/** Lock the privileged renderer to the application entry point. */
function installMainWindowSecurity(win: BrowserWindow, trustedRendererEntryUrl: string): void {
  const guardMainFrameNavigation = (event: Electron.Event, targetUrl: string) => {
    if (isTrustedMainRendererUrl(targetUrl, trustedRendererEntryUrl)) return;
    event.preventDefault();
    openExternalHttpUrl(targetUrl);
  };

  win.webContents.on('will-navigate', guardMainFrameNavigation);
  win.webContents.on('will-redirect', guardMainFrameNavigation);
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttpUrl(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const requestedPartition = webPreferences.partition || params.partition || '';
    if (
      PRIVILEGED_WORKBENCH_PARTITIONS.includes(
        requestedPartition as (typeof PRIVILEGED_WORKBENCH_PARTITIONS)[number]
      ) &&
      !isTrustedImageWorkbenchDocumentUrl(params.src)
    ) {
      event.preventDefault();
      return;
    }
    if (!isAllowedGuestUrl(params.src)) {
      event.preventDefault();
      return;
    }

    // Never allow a guest page to opt into a preload or Node-enabled frame.
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.nodeIntegrationInWorker = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.partition = webPreferences.partition || params.partition || 'centaur-untrusted-webviews';
  });

  win.webContents.on('did-attach-webview', (_event, guest) => {
    const privileged = PRIVILEGED_WORKBENCH_PARTITIONS.some(
      (partition) => guest.session === session.fromPartition(partition)
    );
    if (!privileged) return;

    const guardWorkbenchNavigation = (event: Electron.Event, targetUrl: string) => {
      if (isTrustedImageWorkbenchDocumentUrl(targetUrl)) return;
      event.preventDefault();
      openExternalHttpUrl(targetUrl);
    };
    guest.on('will-navigate', guardWorkbenchNavigation);
    guest.on('will-redirect', guardWorkbenchNavigation);
    guest.setWindowOpenHandler(({ url }) => {
      openExternalHttpUrl(url);
      return { action: 'deny' };
    });
  });
}

let distributedClientCorsBridgeInstalled = false;

/**
 * Keep Chromium web security enabled while allowing the packaged renderer to
 * call the one WebHost explicitly selected by a distributed-client user.
 *
 * Electron's file:// renderer is cross-origin to that HTTP server, so normal
 * fetch preflights need response CORS headers. The old `webSecurity: false`
 * disabled the browser boundary for every origin. This bridge is deliberately
 * narrower: exact server origin, trusted BrowserWindow, main frame, and trusted
 * renderer Origin only. Subframes/webviews and all other network destinations
 * receive the untouched response.
 */
function installDistributedClientCorsBridge(): void {
  if (distributedClientCorsBridgeInstalled) return;
  distributedClientCorsBridgeInstalled = true;
  const pendingOrigins = new Map<number, string>();
  const filter = { urls: ['http://*/*', 'https://*/*'] };

  const isTrustedRequest = (details: {
    url: string;
    webContentsId?: number;
    frame?: Electron.WebFrameMain | null;
  }): boolean => {
    if (!isClientMode || !clientBackendOrigin || !trustedMainRendererEntryUrl) return false;
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
    if (details.webContentsId !== mainWindow.webContents.id || details.frame !== mainWindow.webContents.mainFrame) {
      return false;
    }
    try {
      return new URL(details.url).origin === clientBackendOrigin;
    } catch {
      return false;
    }
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    if (isTrustedRequest(details) && trustedMainRendererEntryUrl) {
      const originEntry = Object.entries(details.requestHeaders).find(([name]) => name.toLowerCase() === 'origin');
      const requestOrigin = originEntry?.[1];
      if (isTrustedRendererCorsOrigin(requestOrigin, trustedMainRendererEntryUrl)) {
        pendingOrigins.set(details.id, requestOrigin as string);
        // Bound entries whose request fails before response headers arrive.
        if (pendingOrigins.size > 1_024) pendingOrigins.delete(pendingOrigins.keys().next().value as number);
      }
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const requestOrigin = pendingOrigins.get(details.id);
    pendingOrigins.delete(details.id);
    if (!requestOrigin || !isTrustedRequest(details)) {
      callback({});
      return;
    }

    const responseHeaders: Record<string, string[]> = {};
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      if (/^access-control-/i.test(name)) continue;
      responseHeaders[name] = Array.isArray(value) ? value : [String(value)];
    }
    responseHeaders['Access-Control-Allow-Origin'] = [requestOrigin];
    responseHeaders['Access-Control-Allow-Credentials'] = ['true'];
    responseHeaders['Access-Control-Allow-Methods'] = ['GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'];
    responseHeaders['Access-Control-Allow-Headers'] = [
      'Accept, Authorization, Content-Type, Range, X-Requested-By, X-WebUI-Gate-Token',
    ];
    responseHeaders['Access-Control-Expose-Headers'] = [
      'Accept-Ranges, Content-Disposition, Content-Length, Content-Range, X-WebUI-Gate-Token',
    ];
    responseHeaders['Access-Control-Allow-Private-Network'] = ['true'];
    responseHeaders['Access-Control-Max-Age'] = ['600'];
    responseHeaders['Vary'] = ['Origin'];

    if (details.method === 'OPTIONS') {
      delete responseHeaders['content-length'];
      delete responseHeaders['Content-Length'];
      delete responseHeaders['transfer-encoding'];
      delete responseHeaders['Transfer-Encoding'];
    }
    callback({
      responseHeaders,
      statusLine: details.method === 'OPTIONS' ? 'HTTP/1.1 204 No Content' : undefined,
    });
  });
}

const createWindow = ({ showOnReady = true }: { showOnReady?: boolean } = {}): void => {
  console.log('[CentaurAI] Creating main window...');
  const { x: windowX, y: windowY, width: windowWidth, height: windowHeight } = resolveInitialBounds();

  // Get app icon for development mode (Windows/Linux need icon in BrowserWindow)
  // In production, icons are set via forge.config.ts packagerConfig
  let devIcon: Electron.NativeImage | undefined;
  if (!app.isPackaged) {
    try {
      // Windows: app.ico (no dev version), Linux: app_dev.png (with padding)
      const iconFile = process.platform === 'win32' ? 'app.ico' : 'app_dev.png';
      const iconPath = path.join(process.cwd(), 'resources', iconFile);
      if (fs.existsSync(iconPath)) {
        devIcon = nativeImage.createFromPath(iconPath);
        if (devIcon.isEmpty()) devIcon = undefined;
      }
    } catch {
      // Ignore icon loading errors in development
    }
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    ...(windowX !== undefined && windowY !== undefined ? { x: windowX, y: windowY } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false, // Hide until CSS is loaded to prevent FOUC
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    // Set icon for Windows/Linux in development mode
    ...(devIcon && process.platform !== 'darwin' ? { icon: devIcon } : {}),
    // Custom titlebar configuration / 自定义标题栏配置
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden',
          // Align traffic-light vertical center with the titlebar button centers.
          // Titlebar is 45px; buttons are 36px flex-centered → button center y≈22.5.
          // Empirically y=13 places the traffic lights on the same horizontal line
          // as the sidebar / back / forward icons.
          // NOTE: requires a full app restart to take effect (BrowserWindow option).
          trafficLightPosition: { x: 10, y: 13 },
        }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      webviewTag: true, // 启用 webview 标签用于 HTML 预览 / Enable webview tag for HTML preview
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep Chromium's origin boundary intact. The co-located vector DB is
      // reached through the strict centaur-vector:// main-process proxy.
      webSecurity: true,
    },
  });
  console.log(`[CentaurAI] Main window created (id=${mainWindow.id})`);

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const fallbackFile = path.join(__dirname, '../renderer/index.html');
  const trustedRendererEntryUrl = !app.isPackaged && rendererUrl ? rendererUrl : pathToFileURL(fallbackFile).toString();
  trustedMainRendererEntryUrl = trustedRendererEntryUrl;
  installMainWindowSecurity(mainWindow, trustedRendererEntryUrl);

  scheduleStartupLogReport(mainWindow);

  // Show window after content is ready to prevent FOUC (Flash of Unstyled Content)
  // Use 'ready-to-show' which fires when renderer has painted first frame,
  // combined with 'did-finish-load' as belt-and-suspenders approach.
  if (showOnReady) {
    const showWindow = () => {
      if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        console.log('[CentaurAI] Showing main window');
        mainWindow.show();
        mainWindow.focus();
      }
    };
    mainWindow.once('ready-to-show', () => {
      console.log('[CentaurAI] Window ready-to-show');
      showWindow();
    });
    // Belt-and-suspenders: also show on did-finish-load in case ready-to-show already fired
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[CentaurAI] Renderer did-finish-load');
      showWindow();
      scheduleBackendMigrations();
    });
    // Fallback: show window after 5s even if events don't fire (e.g. loadURL failure)
    setTimeout(showWindow, 5000);
  } else if (process.platform === 'darwin' && app.dock) {
    void app.dock.hide();
  }

  initMainAdapterWithWindow(mainWindow);
  bindMainWindowReferences(mainWindow);

  setupApplicationMenu();

  setupZoomForWindow(mainWindow);
  registerWindowMaximizeListeners(mainWindow);
  attachWindowBoundsPersistence(mainWindow, (bounds) => ProcessConfig.set('window.bounds', bounds));

  // Initialize auto-updater service (skip when disabled via env, e.g. E2E / CI)
  // 初始化自动更新服务（通过环境变量禁用时跳过，例如 E2E / CI 场景）
  const isCiRuntime = process.env.CI === 'true' || process.env.CI === '1' || process.env.GITHUB_ACTIONS === 'true';
  const disableAutoUpdater =
    process.env.AIONUI_DISABLE_AUTO_UPDATE === '1' ||
    process.env.AIONUI_E2E_TEST === '1' ||
    isCiRuntime ||
    !app.isPackaged; // dev mode — never check for updates
  if (!disableAutoUpdater) {
    Promise.all([import('./process/services/autoUpdaterService'), import('./process/bridge/updateBridge')])
      .then(([{ autoUpdaterService }, { createAutoUpdateStatusBroadcast }]) => {
        // Create status broadcast callback that emits via ipcBridge (pure emitter, no window binding)
        const statusBroadcast = createAutoUpdateStatusBroadcast();
        autoUpdaterService.initialize(statusBroadcast);
        // Check for updates after 3 seconds delay
        // 3秒后检查更新
        setTimeout(() => {
          void autoUpdaterService.checkForUpdatesAndNotify();
        }, 3000);
      })
      .catch((error) => {
        console.error('[App] Failed to initialize autoUpdaterService:', error);
      });
  } else {
    console.log('[CentaurAI] Auto-updater disabled via env/CI guard');
  }

  // Load the renderer: dev server URL in development, built HTML file in production
  if (!app.isPackaged && rendererUrl) {
    console.log(`[CentaurAI] Loading renderer URL: ${rendererUrl}`);
    mainWindow.loadURL(rendererUrl).catch((error) => {
      console.error('[CentaurAI] loadURL failed, falling back to file:', error.message || error);
      mainWindow.loadFile(fallbackFile).catch((e2) => {
        console.error('[CentaurAI] loadFile fallback also failed:', e2.message || e2);
      });
    });
  } else {
    console.log(`[CentaurAI] Loading renderer file: ${fallbackFile}`);
    mainWindow.loadFile(fallbackFile).catch((error) => {
      console.error('[CentaurAI] loadFile failed:', error.message || error);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[CentaurAI] did-fail-load:', { errorCode, errorDescription, validatedURL, isMainFrame });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[CentaurAI] render-process-gone:', details);

    // Reload the renderer to recover from the crash.
    // The isDestroyed() guard in adapter/main.ts prevents further sends
    // to the dead webContents while the reload is in progress.
    if (!mainWindow.isDestroyed()) {
      console.log('[CentaurAI] Attempting to recover from renderer crash by reloading...');

      if (!app.isPackaged && rendererUrl) {
        mainWindow.loadURL(rendererUrl).catch((error) => {
          console.error('[CentaurAI] Recovery loadURL failed:', error.message || error);
        });
      } else {
        mainWindow.loadFile(fallbackFile).catch((error) => {
          console.error('[CentaurAI] Recovery loadFile failed:', error.message || error);
        });
      }
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[CentaurAI] Renderer became unresponsive');
  });

  mainWindow.on('closed', () => {
    console.log('[CentaurAI] Main window closed');
    trustedMainRendererEntryUrl = null;
  });

  // DevTools is no longer auto-opened at startup.
  // Use the DevTools toggle in Settings > System (dev mode only) to open it.

  // Listen to DevTools state changes and notify Renderer
  mainWindow.webContents.on('devtools-opened', () => {
    ipcBridge.application.devToolsStateChanged.emit({ isOpen: true });
  });

  mainWindow.webContents.on('devtools-closed', () => {
    ipcBridge.application.devToolsStateChanged.emit({ isOpen: false });
  });

  // 关闭拦截：当启用"关闭到托盘"时，隐藏窗口而非关闭
  // Close interception: hide window instead of closing when "close to tray" is enabled
  mainWindow.on('close', (event) => {
    if (mainWindow.isDestroyed()) return;
    if (getCloseToTrayEnabled() && !getIsQuitting()) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
};

const handleAppReady = async (): Promise<void> => {
  const t0 = performance.now();
  const mark = (label: string) => console.log(`[CentaurAI:ready] ${label} +${Math.round(performance.now() - t0)}ms`);
  mark('start');
  registerImageWorkbenchProtocol();
  registerLocalVectorProtocol();

  // Grant microphone / audio capture so voice input works natively (this is the
  // whole point of the distributed client — a LAN browser over HTTP can't).
  try {
    const isTrustedMainFrame = (wc: Electron.WebContents | null, isMainFrame: boolean | undefined): boolean => {
      if (!wc || isMainFrame !== true || !trustedMainRendererEntryUrl) return false;
      if (!mainWindow || mainWindow.isDestroyed() || wc !== mainWindow.webContents || wc.isDestroyed()) return false;
      return isTrustedMainRendererUrl(wc.getURL(), trustedMainRendererEntryUrl);
    };
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      callback(permission === 'media' && isTrustedMainFrame(wc, details.isMainFrame));
    });
    session.defaultSession.setPermissionCheckHandler(
      (wc, permission, _requestingOrigin, details) =>
        permission === 'media' && isTrustedMainFrame(wc, details.isMainFrame)
    );
  } catch (e) {
    console.warn('[CentaurAI] Failed to set media permission handler:', e);
  }

  installDistributedClientCorsBridge();

  // Do not install a partition-wide CORS bypass here. The dedicated custom
  // protocol handlers above are the only network capabilities granted to the
  // image workbenches. A wildcard http(s) shim would let a workbench XSS read
  // loopback/private-network services and bypass those route allowlists.

  if (!app.isPackaged) {
    try {
      const { default: installExtension, REACT_DEVELOPER_TOOLS } = await import('electron-devtools-installer');
      await installExtension(REACT_DEVELOPER_TOOLS);
      console.log('[DevTools] React Developer Tools installed');
    } catch (e) {
      console.warn('[DevTools] Failed to install React DevTools:', e);
    }
  }

  // CLI mode: print app version and exit immediately (used by CI smoke tests)
  if (isVersionMode) {
    console.log(app.getVersion());
    app.exit(0);
    return;
  }

  // Set dock icon in development mode on macOS
  // In production, the icon is set via forge.config.ts packagerConfig.icon
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    try {
      const iconPath = path.join(process.cwd(), 'resources', 'app_dev.png');
      if (fs.existsSync(iconPath)) {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          app.dock.setIcon(icon);
        }
      }
    } catch {
      // Ignore dock icon errors in development
    }
  }

  setSentryDeviceId();

  try {
    await initializeProcess();
    rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;
    mark('initializeProcess');
  } catch (error) {
    console.error('Failed to initialize process:', error);
    app.exit(1);
    return;
  }

  // Distributed client: do NOT spawn a local backend. The IPC bridges set up by
  // initializeProcess() (incl. LAN discovery) are enough for the "select server"
  // screen; once the user connects, the window reloads pointing at the remote
  // server. This keeps the client lightweight (no aioncore on each PC).
  if (isClientMode) {
    createWindow({ showOnReady: true });
    appReadyDone = true;
    mark('client-mode ready (no local backend)');
    return;
  }

  // Start aioncore only after initializeProcess(). initStorage may open
  // the legacy Electron SQLite catalog for a one-shot v26 migration and must
  // close it before the backend touches the same file.
  const backendStartup = await startBackendOrExit({
    startBackend: async () => {
      assertStartupArchitectureCompatible({
        arch: process.arch,
        isPackaged: app.isPackaged,
        platform: process.platform,
      });
      const { getDataPath } = await import('./process/utils/utils');
      const { getSystemDir } = await import('./process/utils/initStorage');
      const sysDir = getSystemDir();
      return backendManager.start(
        getDataPath(),
        sysDir.logDir,
        {
          cacheDir: sysDir.cacheDir,
          workDir: sysDir.workDir,
          logDir: sysDir.logDir,
        },
        {
          allowPendingOnHealthTimeout: !(isWebUIMode || isResetPasswordMode),
          onHealthTimeout: async (error) => {
            markBackendStartupFailed(error);
            await captureBackendStartupFailure(error);
          },
          onPendingExit: async (error) => {
            markBackendStartupFailed(error);
            await captureBackendStartupFailure(error);
          },
          onReady: (backendPort) => {
            markBackendReady(backendPort, 'backendManager.lateReady');
          },
        },
        resolvePreferredBackendPort(process.env, app.isPackaged)
      );
    },
    onStarted: (backendPort) => {
      exposeBackendPort(backendPort);
      if (backendManager.status === 'running') {
        markBackendReady(backendPort, 'backendManager.start');
        return;
      }
      mark(`backendManager.start pending health (port=${backendPort})`);
    },
    captureFailure: async (error) => {
      markBackendStartupFailed(error);
      await captureBackendStartupFailure(error);
    },
    exitApp: (code) => app.exit(code),
    exitOnFailure: isWebUIMode || isResetPasswordMode,
    logError: console.error,
  });
  if (!backendStartup.ok) {
    if (isWebUIMode || isResetPasswordMode) {
      return;
    }
  }

  // One-shot WebUI admin credential migration. Must run after the backend is
  // up (__backendPort set) and before any mode branch below that might log the
  // user in. Swallows its own errors; the next boot retries.
  const bootBackendPort = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  if (backendStartedOk && bootBackendPort) {
    await ensureAdminUserOnce(bootBackendPort);
  }

  // One-shot backend migrations are deferred until after the renderer finishes
  // loading. Some migration steps (ConfigStorage.get, ipcBridge.listProviders)
  // route through the renderer via BroadcastChannel; running them here would
  // deadlock because the renderer does not exist yet. See scheduleBackendMigrations().

  try {
    initializeZoomFactor(await ProcessConfig.get('ui.zoomFactor'));
    mark('initializeZoomFactor');
  } catch (error) {
    console.error('[CentaurAI] Failed to restore zoom factor:', error);
    initializeZoomFactor(undefined);
  }

  try {
    loadSavedWindowBounds(await ProcessConfig.get('window.bounds'));
    mark('restoreWindowBounds');
  } catch (error) {
    console.error('[CentaurAI] Failed to restore window bounds:', error);
    loadSavedWindowBounds(undefined);
  }

  if (isResetPasswordMode) {
    // Handle password reset without creating window
    try {
      const { resetPasswordCLI, resolveResetPasswordUsername } = await import('./process/utils/resetPasswordCLI');
      const username = resolveResetPasswordUsername(process.argv);

      await resetPasswordCLI(username);

      app.quit();
    } catch {
      app.exit(1);
    }
  } else if (isWebUIMode) {
    const userConfigInfo = loadUserWebUIConfig();
    if (userConfigInfo.exists && userConfigInfo.path) {
      // Config file loaded from user directory
    }
    const resolvedPort = resolveWebUIPort(userConfigInfo.config, getSwitchValue);
    const allowRemote = resolveRemoteAccess(userConfigInfo.config, isRemoteMode);
    try {
      // Inside Electron (`AionUi --webui` or packaged `aionui-web` mode that
      // launches via the Electron shell), reuse the desktop app's data-dir so
      // that conversations / cron jobs created in any path show up everywhere.
      // Matches the desktop IPC path at line 493 above.
      const { getDataPath } = await import('./process/utils/utils');
      const { getSystemDir } = await import('./process/utils/initStorage');
      const sysDirWebUI = getSystemDir();
      // M6: Switch to @aionui/web-host
      const handle = await startWebHost({
        app: {
          version: app.getVersion(),
          isPackaged: app.isPackaged,
          resourcesPath: app.getAppPath(),
          // Same reason as dataDir below: webui.config.json must live next to
          // the DB under the CLI-safe symlink path, so every password-change
          // entry point (CLI --resetpass, settings-toggle IPC, browser login)
          // reads the same file.
          userDataPath: getDataPath(),
        },
        staticDir: path.join(__dirname, '../renderer'),
        port: resolvedPort,
        allowRemote,
        vectorEndpoint: await resolveVectorEndpoint(),
        dataDir: getDataPath(),
        logDir: sysDirWebUI.logDir,
        // Expose the same AIONUI_{CACHE,WORK,LOG}_DIR env the desktop IPC path
        // passes at line 493, so /api/system/info reports the symlink workDir
        // instead of the path-with-spaces userData root.
        dirs: {
          cacheDir: sysDirWebUI.cacheDir,
          workDir: sysDirWebUI.workDir,
          logDir: sysDirWebUI.logDir,
        },
        backend: {
          kind: 'useExistingBackend',
          port: (() => {
            // Reuse the backend already spawned by backendManager.start() above.
            // Spawning a second backend here would race the first on SQLite.
            const port = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
            if (!port) {
              throw new Error('[WebUI] Cannot start: aioncore is not running (globalThis.__backendPort unset)');
            }
            return port;
          })(),
        },
      });
      console.log(`[WebUI] Headless server started (port=${handle.port}, backendPort=${handle.backendPort})`);
    } catch (err) {
      console.error(`[WebUI] Failed to start server on port ${resolvedPort}:`, err);
      app.exit(1);
      return;
    }

    // Keep the process alive in WebUI mode by preventing default quit behavior.
    // On Linux headless (systemd), Electron may attempt to quit when no windows exist.
    app.on('will-quit', (event) => {
      // Only prevent quit if this is an unexpected exit (server still running).
      // Explicit app.exit() calls bypass will-quit, so they are unaffected.
      if (!isExplicitQuit) {
        event.preventDefault();
        console.warn('[WebUI] Prevented unexpected quit — server is still running');
      }
    });
  } else {
    // 初始化关闭到托盘设置 / Initialize close-to-tray setting
    if (isE2ETestMode) {
      setCloseToTrayEnabled(false);
      destroyTray();
    } else {
      try {
        const savedCloseToTray = await readCloseToTraySetting();
        setCloseToTrayEnabled(savedCloseToTray);
        if (getCloseToTrayEnabled()) {
          createOrUpdateTray();
        }
      } catch {
        // Ignore storage read errors, default to false
      }
    }

    const showMainWindowOnReady = !(wasLaunchedAtLogin() && getCloseToTrayEnabled());

    createWindow({ showOnReady: showMainWindowOnReady });
    appReadyDone = true;
    mark('createWindow');

    // Initialize desktop pet (delayed to not block main window)
    setTimeout(() => {
      void (async () => {
        try {
          const petEnabled = DESKTOP_PET_ENABLED && (await ProcessConfig.get('pet.enabled'));
          if (petEnabled === true) {
            // Read pet sub-settings before creating the pet so flags are honored
            // on the first createPetWindow() call (which is sync).
            const confirmEnabled = (await ProcessConfig.get('pet.confirmEnabled')) ?? true;
            const { createPetWindow, setPetConfirmEnabled } = await import('./process/pet/petManager');
            setPetConfirmEnabled(confirmEnabled);
            createPetWindow();
          }
        } catch (error) {
          console.error('[Pet] Failed to initialize:', error);
        }
      })();
    }, 3000);

    // 读取语言设置并初始化主进程 i18n，然后刷新托盘菜单
    // Read language setting and initialize main process i18n, then refresh tray menu
    try {
      const savedLanguage = await ProcessConfig.get('language');
      await setInitialLanguage(savedLanguage);
      // After language is set, refresh tray menu if it exists
      await refreshTrayMenu();
    } catch (error) {
      console.error('[index] Failed to initialize i18n language:', error);
    }

    // 监听语言变更，刷新托盘菜单文案 / Listen for language changes to refresh tray menu labels
    onLanguageChanged(() => {
      void refreshTrayMenu();
    });

    if (!isE2ETestMode) {
      // 窗口创建后异步恢复 WebUI，不阻塞 UI / Restore WebUI async after window creation, non-blocking
      restoreDesktopWebUIFromPreferences({ onRestored: announceDesktopWebUIStarted }).catch((error) => {
        console.error('[WebUI] Failed to auto-restore:', error);
      });
    }

    // Flush pending deep-link URL (received before window was ready)
    const pendingUrl = getPendingDeepLinkUrl();
    if (pendingUrl) {
      clearPendingDeepLinkUrl();
      mainWindow.webContents.once('did-finish-load', () => {
        handleDeepLinkUrl(pendingUrl);
      });
    }
  }

  // Verify CDP is ready and log status
  const { cdpPort, verifyCdpReady } = await import('./process/utils/configureChromium');
  if (cdpPort) {
    const cdpReady = await verifyCdpReady(cdpPort);
    if (cdpReady) {
      console.log(`[CDP] Remote debugging server ready at http://127.0.0.1:${cdpPort}`);
      console.log(
        `[CDP] MCP chrome-devtools: npx chrome-devtools-mcp@0.16.0 --browser-url=http://127.0.0.1:${cdpPort}`
      );
    } else {
      console.warn(`[CDP] Warning: Remote debugging port ${cdpPort} not responding`);
    }
  }
};

// ============ Protocol Registration ============
// Register aionui:// as the default protocol client
if (process.defaultApp) {
  // Dev mode: need to pass execPath explicitly
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

// macOS: handle aionui:// URLs via the open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
  if (isWebUIMode || isResetPasswordMode || !app.isReady()) {
    return;
  }
  // Focus existing window so user sees the result
  showOrCreateMainWindow({ mainWindow, createWindow });
});

// 监听 GPU 子进程崩溃，连续多次后下次启动自动关闭硬件加速（参见 ELECTRON-9A / ELECTRON-9D）。
installGpuCrashHandler();

// Ensure we don't miss the ready event when running in CLI/WebUI mode
void app
  .whenReady()
  .then(handleAppReady)
  .catch((error) => {
    // App initialization failed
    console.error('[CentaurAI] App initialization failed:', error);
    app.quit();
  });

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // 当关闭到托盘启用时，不退出应用 / Don't quit when close-to-tray is enabled
  if (getCloseToTrayEnabled()) {
    return;
  }
  // In WebUI mode, don't quit when windows are closed since we're running a web server
  if (!isWebUIMode && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // Skip if handleAppReady hasn't finished — it will create the window itself.
  if (!appReadyDone) return;
  if (!isWebUIMode && app.isReady()) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 从托盘恢复隐藏的窗口 / Restore hidden window from tray
      showAndFocusMainWindow(mainWindow);
      if (process.platform === 'darwin' && app.dock) {
        void app.dock.show();
      }
    } else {
      createWindow();
    }
  }
});

installQuitCleanup({
  onBeforeQuit: (handler) => app.on('before-quit', (event) => handler(event)),
  quitApp: () => app.quit(),
  setIsQuitting,
  markExplicitQuit: () => {
    isExplicitQuit = true;
  },
  destroyTray,
  disposeCronResumeListener: () => {
    disposeCronResumeListener?.();
    disposeCronResumeListener = null;
  },
  // Stop aioncore subprocess — backend shutdown kills all agent children
  // transitively (no separate frontend workerTaskManager remains).
  stopBackend: () => backendManager.stop(),
  destroyPetWindow: async () => {
    const { destroyPetWindow } = await import('./process/pet/petManager');
    destroyPetWindow();
  },
  logInfo: console.log,
  logWarn: console.warn,
  logError: console.error,
});

app.on('will-quit', () => {
  console.log('[CentaurAI] will-quit — all cleanup should be complete');
});

app.on('quit', (_event, exitCode) => {
  console.log(`[CentaurAI] quit (exitCode=${exitCode})`);
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
