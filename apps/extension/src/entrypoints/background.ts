import { defineBackground } from 'wxt/utils/define-background';

import { getErrorMessage } from '$lib/errors.js';
import { onMessage } from '../utils/protocol/messaging';
import { PartySessionService } from '../utils/background/party-session-service';
import { SettingsStore } from '../utils/background/settings-store';
import { createSyncedBackgroundStore, type BackgroundStore } from '../utils/background/state';
import { ControlledTabService } from '../utils/background/controlled-tab-service';

export default defineBackground(() => {
  const store = createSyncedBackgroundStore();
  const settingsStore = new SettingsStore(store);
  const controlledTabService = new ControlledTabService(store);
  const partySessionService = new PartySessionService(store, settingsStore);

  store.on('roomSnapshotChanged', () => {
    applyRoomSnapshotToControlledTab(store, controlledTabService);
  });
  store.on('controlledTabMediaSwitchRequested', ({ context }) => {
    partySessionService.updateRoomMediaFromControlledTab(context);
  });

  registerContentHandlers(controlledTabService, partySessionService);
  registerPopupHandlers(store, settingsStore, controlledTabService, partySessionService);
  controlledTabService.registerEventHandlers();

  void (async () => {
    await settingsStore.hydrate();
    await partySessionService.connectForStoredSession();
  })();
});

function applyRoomSnapshotToControlledTab(
  store: BackgroundStore,
  controlledTabService: ControlledTabService,
): void {
  void controlledTabService.applySnapshotToControlledTab().catch((error) => {
    store.trigger.reportError({ message: getErrorMessage(error) });
  });
}

async function runPopupAction(store: BackgroundStore, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    store.trigger.reportError({ message: getErrorMessage(error) });
  }
}

function registerPopupHandlers(
  store: BackgroundStore,
  settingsStore: SettingsStore,
  controlledTabService: ControlledTabService,
  partySessionService: PartySessionService,
): void {
  onMessage('popup:create-room', ({ data }) =>
    runPopupAction(store, () =>
      createRoomFromTab(data.tabId, controlledTabService, partySessionService),
    ),
  );

  onMessage('popup:join-room', ({ data }) =>
    runPopupAction(store, () =>
      joinRoomFromTab(data.roomCode, data.tabId, controlledTabService, partySessionService),
    ),
  );

  onMessage('popup:leave-room', () => runPopupAction(store, () => partySessionService.leaveRoom()));

  onMessage('popup:update-settings', ({ data }) =>
    runPopupAction(store, () => settingsStore.updateSettings(data)),
  );
}

async function createRoomFromTab(
  tabId: number,
  controlledTabService: ControlledTabService,
  partySessionService: PartySessionService,
): Promise<void> {
  const { context, playback } = await controlledTabService.requireControllableWatchTab(tabId);
  await partySessionService.createRoom(tabId, context, playback);
}

async function joinRoomFromTab(
  roomCode: string,
  tabId: number,
  controlledTabService: ControlledTabService,
  partySessionService: PartySessionService,
): Promise<void> {
  const response = await partySessionService.joinRoom(roomCode);
  try {
    await controlledTabService.navigateControlledTabToRoom(tabId, response.snapshot.watchUrl);
  } catch (error) {
    await partySessionService.leaveRoom();
    throw error;
  }
}

function registerContentHandlers(
  controlledTabService: ControlledTabService,
  partySessionService: PartySessionService,
): void {
  onMessage('content:context', async ({ data, sender }) => {
    if (sender.tab?.id != null) {
      await controlledTabService.handleContentContext(sender.tab.id, data);
    }
  });

  onMessage('content:playback-update', ({ data, sender }) => {
    if (sender.tab?.id != null && controlledTabService.isControlledTab(sender.tab.id)) {
      partySessionService.updateRoomPlaybackFromControlledTab(data);
    }
  });
}
