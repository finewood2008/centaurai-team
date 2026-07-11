import React, { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

describe('AuthContext authentication', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    const remoteWindow = window as Window & {
      __backendHost?: string;
      __backendPort?: number;
      __clientMode?: boolean;
    };
    delete remoteWindow.__backendHost;
    delete remoteWindow.__backendPort;
    delete remoteWindow.__clientMode;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('accepts a successful /login response without an embedded user and fetches /api/auth/user', async () => {
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-webui-gate-token': 'gate-token' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, user: { id: 'u1', username: 'admin' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchSpy);
    const onResult = vi.fn();
    const { AuthProvider, useAuth } = await import('@/renderer/hooks/context/AuthContext');
    const LoginProbe: React.FC = () => {
      const { login, status } = useAuth();
      const didLogin = useRef(false);
      useEffect(() => {
        if (status === 'checking' || didLogin.current) return;
        didLogin.current = true;
        void login({ username: 'admin', password: 'pw' }).then(onResult);
      }, [login, status]);
      return null;
    };

    render(
      <AuthProvider>
        <LoginProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ success: true }));
    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual(['/api/auth/user', '/login', '/api/auth/user']);
  });

  it('sends the saved gate bearer when a distributed client logs out', async () => {
    const remoteWindow = window as Window & {
      electronAPI?: unknown;
      __backendHost?: string;
      __backendPort?: number;
      __clientMode?: boolean;
    };
    delete remoteWindow.electronAPI;
    remoteWindow.__clientMode = true;
    remoteWindow.__backendHost = '192.0.2.10';
    remoteWindow.__backendPort = 25808;
    const { setWebuiGateToken } = await import('@/common/adapter/httpBridge');
    setWebuiGateToken('gate-token');
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, user: { id: 'u1', username: 'admin' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchSpy);
    const onLogout = vi.fn();
    const { AuthProvider, useAuth } = await import('@/renderer/hooks/context/AuthContext');
    const LogoutProbe: React.FC = () => {
      const { logout, status } = useAuth();
      const didLogout = useRef(false);
      useEffect(() => {
        if (status !== 'authenticated' || didLogout.current) return;
        didLogout.current = true;
        void logout().then(onLogout);
      }, [logout, status]);
      return null;
    };

    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(onLogout).toHaveBeenCalledOnce());
    const logoutInit = fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(logoutInit?.headers).toMatchObject({ 'X-WebUI-Gate-Token': 'gate-token' });
  });
});
