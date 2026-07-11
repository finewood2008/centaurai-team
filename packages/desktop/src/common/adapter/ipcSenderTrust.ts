type WebContentsLike = {
  mainFrame?: unknown;
  isDestroyed?: () => boolean;
};

type IpcInvokeEventLike = {
  sender?: WebContentsLike;
  senderFrame?: unknown;
};

/**
 * Native bridge calls are accepted only from the registered privileged main
 * renderer and only from its main frame. Guest webviews and subframes must not
 * inherit filesystem/process capabilities through the generic bridge.
 */
export function isTrustedMainFrameIpcSender(
  event: IpcInvokeEventLike,
  trustedWebContents: ReadonlySet<WebContentsLike>
): boolean {
  const sender = event.sender;
  if (!sender || !trustedWebContents.has(sender)) return false;
  if (sender.isDestroyed?.()) return false;
  return event.senderFrame !== undefined && event.senderFrame === sender.mainFrame;
}
