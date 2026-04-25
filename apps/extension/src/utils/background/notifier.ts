import { sendMessage } from '../protocol/messaging';
import { selectPopupView, type BackgroundState } from './state';

export function emitStateChanged(state: BackgroundState): void {
  void sendMessage('party:state-updated', selectPopupView(state)).catch(() => undefined);
}
