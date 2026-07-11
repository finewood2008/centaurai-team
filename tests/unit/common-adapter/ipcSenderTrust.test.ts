import { describe, expect, it, vi } from 'vitest';
import { isTrustedMainFrameIpcSender } from '@/common/adapter/ipcSenderTrust';

describe('native bridge IPC sender trust', () => {
  const mainFrame = {};
  const trustedSender = { mainFrame, isDestroyed: vi.fn(() => false) };
  const trusted = new Set([trustedSender]);

  it('accepts the registered main frame', () => {
    expect(isTrustedMainFrameIpcSender({ sender: trustedSender, senderFrame: mainFrame }, trusted)).toBe(true);
  });

  it('rejects a subframe from the otherwise trusted webContents', () => {
    expect(isTrustedMainFrameIpcSender({ sender: trustedSender, senderFrame: {} }, trusted)).toBe(false);
  });

  it('rejects guest/unregistered and destroyed webContents', () => {
    const guestFrame = {};
    const guest = { mainFrame: guestFrame, isDestroyed: vi.fn(() => false) };
    expect(isTrustedMainFrameIpcSender({ sender: guest, senderFrame: guestFrame }, trusted)).toBe(false);

    const destroyedFrame = {};
    const destroyed = { mainFrame: destroyedFrame, isDestroyed: vi.fn(() => true) };
    expect(
      isTrustedMainFrameIpcSender({ sender: destroyed, senderFrame: destroyedFrame }, new Set([destroyed]))
    ).toBe(false);
  });

  it('fails closed when sender frame metadata is absent', () => {
    expect(isTrustedMainFrameIpcSender({ sender: trustedSender }, trusted)).toBe(false);
    expect(isTrustedMainFrameIpcSender({}, trusted)).toBe(false);
  });
});
