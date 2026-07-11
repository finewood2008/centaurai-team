import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveImageWorkbenchConfig,
  resolveVectorEndpoint,
  restoreDesktopWebUIFromPreferences,
} from '@/process/utils/webuiConfig';
import { DEFAULT_VECTOR_DB_ENDPOINT } from '@/common/config/constants';

const { httpRequestMock, startWebHostMock } = vi.hoisted(() => ({
  httpRequestMock: vi.fn(),
  startWebHostMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: httpRequestMock,
}));

vi.mock('@aionui/web-host', () => ({
  startWebHost: startWebHostMock,
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    getAppPath: () => '/app',
    getPath: () => '/userData',
  },
}));

vi.mock('@/process/utils/initStorage', () => ({
  getSystemDir: () => ({ cacheDir: '/c', workDir: '/w', logDir: '/l' }),
}));

vi.mock('@/process/utils/utils', () => ({
  getDataPath: () => '/data',
}));

const okHandle = {
  port: 25808,
  localUrl: 'http://127.0.0.1:25808',
  networkUrl: 'http://192.168.1.2:25808',
  lanIP: '192.168.1.2',
  backendPort: 51441,
  stop: vi.fn().mockResolvedValue(undefined),
};

const ENABLED_REMOTE = {
  'webui.desktop.enabled': true,
  'webui.desktop.allowRemote': true,
  'webui.desktop.port': 25808,
};

describe('restoreDesktopWebUIFromPreferences', () => {
  beforeEach(() => {
    httpRequestMock.mockReset();
    startWebHostMock.mockReset();
    startWebHostMock.mockResolvedValue(okHandle);
    (globalThis as { __backendPort?: number }).__backendPort = 51441;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { __backendPort?: number }).__backendPort;
  });

  it('starts the WebUI immediately when the backend answers on the first read', async () => {
    httpRequestMock.mockResolvedValueOnce(ENABLED_REMOTE);

    await restoreDesktopWebUIFromPreferences();

    expect(startWebHostMock).toHaveBeenCalledTimes(1);
    expect(startWebHostMock.mock.calls[0][0]).toMatchObject({ allowRemote: true, port: 25808 });
  });

  it('notifies the caller with the restored handle so LAN discovery can be advertised', async () => {
    httpRequestMock.mockResolvedValueOnce(ENABLED_REMOTE);
    const onRestored = vi.fn();

    await restoreDesktopWebUIFromPreferences({ onRestored });

    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledWith(
      expect.objectContaining({
        allowRemote: true,
        networkUrl: 'http://192.168.1.2:25808',
        lanIP: '192.168.1.2',
      })
    );
  });

  it('retries instead of disabling when the backend is not yet reachable (the restart regression)', async () => {
    // Backend still starting: first two reads throw (ERR_CONNECTION_REFUSED),
    // third succeeds with the persisted "enabled + allowRemote" preference.
    httpRequestMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(ENABLED_REMOTE);

    const done = restoreDesktopWebUIFromPreferences();
    // Advance past the two 1s retry gaps so the third read runs.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    // 3 preference reads (2 refused + 1 success) prove the retry-not-disable
    // behavior; startDesktopWebUI then makes 4 more reads (resolveNasRootDir +
    // resolveVectorEndpoint + resolveImageWorkbenchConfig settings + providers) → 7 total.
    expect(httpRequestMock).toHaveBeenCalledTimes(7);
    expect(startWebHostMock).toHaveBeenCalledTimes(1);
    expect(startWebHostMock.mock.calls[0][0]).toMatchObject({ allowRemote: true });
  });

  it('does not start the WebUI when the preference is genuinely disabled', async () => {
    httpRequestMock.mockResolvedValueOnce({ 'webui.desktop.enabled': false });

    await restoreDesktopWebUIFromPreferences();

    expect(startWebHostMock).not.toHaveBeenCalled();
  });
});

describe('resolveVectorEndpoint', () => {
  const previousEndpoint = process.env.AIONUI_VECTOR_DB_ENDPOINT;
  const previousCentaurEndpoint = process.env.CENTAURAI_VECTOR_DB_ENDPOINT;

  beforeEach(() => {
    httpRequestMock.mockReset();
    delete process.env.AIONUI_VECTOR_DB_ENDPOINT;
    delete process.env.CENTAURAI_VECTOR_DB_ENDPOINT;
  });

  afterEach(() => {
    if (previousEndpoint === undefined) delete process.env.AIONUI_VECTOR_DB_ENDPOINT;
    else process.env.AIONUI_VECTOR_DB_ENDPOINT = previousEndpoint;
    if (previousCentaurEndpoint === undefined) delete process.env.CENTAURAI_VECTOR_DB_ENDPOINT;
    else process.env.CENTAURAI_VECTOR_DB_ENDPOINT = previousCentaurEndpoint;
  });

  it('rejects a historical non-loopback client setting and falls back to the edition default', async () => {
    httpRequestMock.mockResolvedValueOnce({ 'vectorDB.endpoint': 'https://attacker.example' });
    await expect(resolveVectorEndpoint()).resolves.toBe(DEFAULT_VECTOR_DB_ENDPOINT);
  });

  it('accepts a strict loopback client setting', async () => {
    httpRequestMock.mockResolvedValueOnce({ 'vectorDB.endpoint': 'http://localhost:9861/' });
    await expect(resolveVectorEndpoint()).resolves.toBe('http://localhost:9861');
  });

  it('allows an explicit administrator environment override for an external origin', async () => {
    process.env.AIONUI_VECTOR_DB_ENDPOINT = 'https://vectors.example:9443';
    await expect(resolveVectorEndpoint()).resolves.toBe('https://vectors.example:9443');
    expect(httpRequestMock).not.toHaveBeenCalled();
  });
});

describe('resolveImageWorkbenchConfig', () => {
  const prevImageWorkbenchKey = process.env.AIONUI_IMAGE_WORKBENCH_KEY;
  const prevImageUpstreamUrl = process.env.AIONUI_IMAGE_UPSTREAM_URL;
  const prevImageWorkbenchModel = process.env.AIONUI_IMAGE_WORKBENCH_MODEL;

  beforeEach(() => {
    httpRequestMock.mockReset();
    delete process.env.AIONUI_IMAGE_WORKBENCH_KEY;
    delete process.env.AIONUI_IMAGE_UPSTREAM_URL;
    delete process.env.AIONUI_IMAGE_WORKBENCH_MODEL;
  });

  afterEach(() => {
    if (prevImageWorkbenchKey === undefined) delete process.env.AIONUI_IMAGE_WORKBENCH_KEY;
    else process.env.AIONUI_IMAGE_WORKBENCH_KEY = prevImageWorkbenchKey;
    if (prevImageUpstreamUrl === undefined) delete process.env.AIONUI_IMAGE_UPSTREAM_URL;
    else process.env.AIONUI_IMAGE_UPSTREAM_URL = prevImageUpstreamUrl;
    if (prevImageWorkbenchModel === undefined) delete process.env.AIONUI_IMAGE_WORKBENCH_MODEL;
    else process.env.AIONUI_IMAGE_WORKBENCH_MODEL = prevImageWorkbenchModel;
  });

  it('uses the Settings > Tools image generation model provider for the workbench key', async () => {
    httpRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === '/api/settings/client') {
        return {
          'tools.imageGenerationModel': {
            id: 'provider-1',
            name: 'Stored label',
            platform: 'custom',
            use_model: 'gpt-image-2',
          },
        };
      }
      if (path === '/api/providers') {
        return [
          {
            id: 'provider-1',
            name: 'System Image Provider',
            platform: 'custom',
            base_url: 'https://api.example.com/v1',
            api_key: 'SYSTEM_KEY',
            models: ['gpt-image-2'],
          },
        ];
      }
      return undefined;
    });

    await expect(resolveImageWorkbenchConfig()).resolves.toMatchObject({
      apiKey: 'SYSTEM_KEY',
      baseUrl: 'https://api.example.com/v1',
      profileName: 'System Image Provider',
      model: 'gpt-image-2',
    });
  });

  it('ignores the retired standalone image workbench profile setting', async () => {
    httpRequestMock.mockResolvedValueOnce({
      'webui.imageWorkbenchConfig': {
        activeProfileId: 'legacy',
        profiles: [{ id: 'legacy', apiKey: 'LEGACY_KEY', model: 'legacy-model' }],
      },
    });

    await expect(resolveImageWorkbenchConfig()).resolves.toBeUndefined();
  });

  it('auto-selects the first supported provider image model when no model is configured', async () => {
    httpRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === '/api/settings/client') return {};
      if (path === '/api/providers') {
        return [
          {
            id: 'text-provider',
            name: 'Text Provider',
            platform: 'custom',
            base_url: 'https://text.example.com/v1',
            api_key: 'TEXT_KEY',
            models: ['gpt-4o'],
          },
          {
            id: 'gemini-provider',
            name: 'Gemini Provider',
            platform: 'gemini',
            base_url: '',
            api_key: 'GEMINI_KEY',
            models: ['gemini-2.5-pro'],
          },
        ];
      }
      return undefined;
    });

    await expect(resolveImageWorkbenchConfig()).resolves.toMatchObject({
      apiKey: 'GEMINI_KEY',
      profileName: 'Gemini Provider',
      model: 'gemini-2.5-flash-image-preview',
    });
  });

  it('auto-selects an explicitly registered image model from settings', async () => {
    httpRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === '/api/settings/client') {
        return {
          'tools.imageGenerationModels': {
            'custom-provider': ['custom-art-model'],
          },
        };
      }
      if (path === '/api/providers') {
        return [
          {
            id: 'custom-provider',
            name: 'Custom Image Provider',
            platform: 'custom',
            base_url: 'https://custom.example.com/v1',
            api_key: 'CUSTOM_KEY',
            models: ['custom-art-model'],
          },
        ];
      }
      return undefined;
    });

    await expect(resolveImageWorkbenchConfig()).resolves.toMatchObject({
      apiKey: 'CUSTOM_KEY',
      baseUrl: 'https://custom.example.com/v1',
      profileName: 'Custom Image Provider',
      model: 'custom-art-model',
    });
  });
});
