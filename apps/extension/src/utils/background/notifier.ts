import type { BackgroundBroadcast } from '../protocol/extension';

export function emitStateChanged(): void {
  const message: BackgroundBroadcast = { type: 'party:state-updated' };
  void browser.runtime.sendMessage(message).catch(() => undefined);
}
