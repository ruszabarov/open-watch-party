import { sendMessage } from '../protocol/messaging';
import { buildPopupState, type InternalState } from './state';

export function emitStateChanged(state: InternalState): void {
  void sendMessage('party:state-updated', buildPopupState(state)).catch(() => undefined);
}
