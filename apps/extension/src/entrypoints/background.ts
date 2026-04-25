import { defineBackground } from 'wxt/utils/define-background';

import { getErrorMessage } from '../utils/errors';
import { onMessage } from '../utils/protocol/messaging';
import { createBackgroundBus } from '../utils/background/bus';
import { PartySessionService } from '../utils/background/party-session-service';
import { SettingsStore } from '../utils/background/settings-store';
import {
  createBackgroundState,
  syncBackgroundState,
  type BackgroundState,
} from '../utils/background/state';
import { ActiveTabTracker } from '../utils/background/active-tab-tracker';
import { ControlledTabService } from '../utils/background/controlled-tab-service';

export default defineBackground(() => {
  const state = createBackgroundState();
  const bus = createBackgroundBus();
  const settingsStore = new SettingsStore(state);
  const activeTabTracker = new ActiveTabTracker(state);
  const controlledTabService = new ControlledTabService(state, bus, activeTabTracker);
  const partySessionService = new PartySessionService(
    state,
    bus,
    settingsStore,
    activeTabTracker,
    controlledTabService,
  );

  registerContentHandlers(controlledTabService);
  registerPopupHandlers(state, settingsStore, partySessionService);
  activeTabTracker.registerEventHandlers();
  controlledTabService.registerEventHandlers();
  partySessionService.registerEventHandlers();

  void (async () => {
    await settingsStore.hydrate();
    await activeTabTracker.refreshActiveTab();
    await partySessionService.connectForStoredSession();
  })();
});

async function runMutation(state: BackgroundState, handler: () => Promise<void>): Promise<void> {
  try {
    await handler();
  } catch (error) {
    state.lastError = getErrorMessage(error);
    syncBackgroundState(state);
  }
}

function registerPopupHandlers(
  state: BackgroundState,
  settingsStore: SettingsStore,
  partySessionService: PartySessionService,
): void {
  onMessage('popup:create-room', () => runMutation(state, () => partySessionService.createRoom()));

  onMessage('popup:join-room', ({ data }) =>
    runMutation(state, () => partySessionService.joinRoom(data.roomCode)),
  );

  onMessage('popup:leave-room', () => runMutation(state, () => partySessionService.leaveRoom()));

  onMessage('popup:update-settings', ({ data }) =>
    runMutation(state, async () => {
      await settingsStore.updateSettings(data);
      syncBackgroundState(state);
    }),
  );
}

function registerContentHandlers(controlledTabService: ControlledTabService): void {
  onMessage('content:context', ({ data, sender }) => {
    if (sender.tab?.id != null) {
      controlledTabService.recordContentContext(sender.tab.id, data);
    }
  });

  onMessage('content:playback-update', ({ data, sender }) => {
    if (sender.tab?.id != null) {
      controlledTabService.relayControlledPlaybackUpdate(sender.tab.id, data);
    }
  });

  onMessage('content:request-sync', async ({ sender }) => {
    if (sender.tab?.id != null) {
      await controlledTabService.requestSync(sender.tab.id);
    }
  });
}
