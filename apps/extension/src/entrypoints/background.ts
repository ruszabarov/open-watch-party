import { defineBackground } from 'wxt/utils/define-background';
import { errorMessage } from '@open-watch-party/shared';
import { ControlledTabService } from '../background/controlled-tab.service';
import { PartySessionService } from '../background/party-session.service';
import { reportBackgroundError } from '../background/state';
import { onMessage } from '../messaging';

// Chrome suspends an extension service worker after ~30s without activity.
// A message every 20s keeps the room socket alive; the same tick asks the
// controlled tab for a fresh report so quiet playback still gets reconciled.
const HEARTBEAT_INTERVAL_MS = 20_000;

export default defineBackground(() => {
  const controller = new BackgroundController();

  controller.start();
});

class BackgroundController {
  private readonly partySessionService: PartySessionService;
  private readonly controlledTabService: ControlledTabService;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.partySessionService = new PartySessionService({
      onRoomSnapshotChanged: () => {
        this.applyRoomSnapshotToControlledTab();
      },
      onSessionEnded: () => {
        this.controlledTabService.reset();
      },
    });

    this.controlledTabService = new ControlledTabService({
      onControlledTabClosed: () => {
        this.leaveRoomAfterControlledTabClosed();
      },
      onControlledTabPlaybackReady: (playback) =>
        this.partySessionService.updateRoomPlaybackFromControlledTab(playback),
    });
  }

  start(): void {
    this.registerContentHandlers();
    this.registerPopupHandlers();
    this.controlledTabService.registerEventHandlers();
    this.startHeartbeat();

    void this.partySessionService.resumeStoredSession().catch((error) => {
      void reportBackgroundError(errorMessage(error, 'Unexpected error.'));
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      void this.partySessionService.heartbeat();
      void this.controlledTabService.reconcile();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private applyRoomSnapshotToControlledTab(): void {
    void this.controlledTabService.applySnapshotToControlledTab().catch((error) => {
      void reportBackgroundError(errorMessage(error, 'Unexpected error.'));
    });
  }

  private leaveRoomAfterControlledTabClosed(): void {
    void this.partySessionService.leaveRoom().catch(() => {
      // Best effort; closing a controlled tab should not surface a user-facing error.
    });
  }

  private registerPopupHandlers(): void {
    onMessage('popup:create-room', ({ data }) => this.createRoomFromTab(data.tabId));

    onMessage('popup:join-room', ({ data }) => this.joinRoomFromTab(data.roomCode, data.tabId));

    onMessage('popup:leave-room', () => this.partySessionService.leaveRoom());
  }

  private async createRoomFromTab(tabId: number): Promise<void> {
    const { serviceId, playback } =
      await this.controlledTabService.requireControllableWatchTab(tabId);
    await this.partySessionService.createRoom(tabId, serviceId, playback);
  }

  private async joinRoomFromTab(roomCode: string, tabId: number): Promise<void> {
    const response = await this.partySessionService.joinRoom(roomCode, tabId);
    try {
      await this.controlledTabService.navigateControlledTabToRoom(
        tabId,
        response.snapshot.watchUrl,
      );
    } catch (error) {
      await this.partySessionService.leaveRoom();
      throw error;
    }
  }

  private registerContentHandlers(): void {
    onMessage('content:watch-report', async ({ data, sender }) => {
      if (sender.tab?.id !== undefined) {
        return this.controlledTabService.handleWatchReport(sender.tab.id, data);
      }

      return 'ignored';
    });
  }
}
