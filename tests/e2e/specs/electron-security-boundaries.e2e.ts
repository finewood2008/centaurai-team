import { expect, test } from '../fixtures';

test.describe('Electron privileged renderer boundaries', () => {
  test('isolates guest partitions and keeps custom protocols least-privileged', async ({ electronApp, page }) => {
    const preferences = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      return win?.webContents.getLastWebPreferences();
    });
    expect(preferences?.webSecurity).toBe(true);
    expect(preferences?.nodeIntegration).toBe(false);
    expect(preferences?.contextIsolation).toBe(true);
    expect(preferences?.sandbox).toBe(true);

    const statuses = await page.evaluate(async () => {
      const mountGuest = async (src: string, partition?: string): Promise<any> => {
        const guest = document.createElement('webview') as any;
        if (partition) guest.partition = partition;
        guest.src = src;
        guest.style.display = 'none';
        document.body.appendChild(guest);
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error(`guest load timeout: ${src}`)), 10_000);
          guest.addEventListener(
            'dom-ready',
            () => {
              window.clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        });
        return guest;
      };

      const workbench = await mountGuest('centaur-image-workbench://app/index.html', 'persist:centaur-image-workbench');
      const exactProbe = await workbench.executeJavaScript(`
        fetch('centaur-image-workbench://app/__backend/api/settings/client', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ 'webui.imageWorkbenchConfig': { model: 'test' } })
        }).then((response) => response.status)
      `);
      const genericBackend = await workbench.executeJavaScript(`
        fetch('centaur-image-workbench://app/__backend/api/fs/read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: '/etc/passwd' })
        }).then((response) => response.status)
      `);
      workbench.remove();

      const untrusted = await mountGuest('data:text/html,<title>untrusted</title>');
      const defaultPartitionCapability = await untrusted.executeJavaScript(`
        fetch('centaur-image-workbench://app/__backend/api/settings/client', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        }).then((response) => response.status).catch(() => 'blocked')
      `);
      untrusted.remove();

      const vectorReindex = await fetch('centaur-vector://local/api/reindex', { method: 'POST' }).then(
        (response) => response.status
      );
      return { exactProbe, genericBackend, defaultPartitionCapability, vectorReindex };
    });

    expect(statuses).toEqual({
      exactProbe: 200,
      genericBackend: 403,
      defaultPartitionCapability: 'blocked',
      vectorReindex: 403,
    });
  });
});
