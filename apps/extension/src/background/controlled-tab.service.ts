import { browser } from 'wxt/browser';
import type { PlaybackUpdate, ServiceId } from '@open-watch-party/shared';
import { sendMessage, type PlaybackApplyTarget, type WatchReport } from '../messaging';
import { findServiceByUrl, getServiceDefinition } from '../streaming-services/catalog';
import {
  PlaybackSyncEngine,
  toPlaybackUpdate,
  type PlaybackSyncDecision,
  type PlaybackUpdateResult,
} from './playback-sync';
import { clearControlledTab, getBackgroundState, setLastWarning } from './state';

const DEFAULT_LOCAL_UPDATE_RETRY_MS = 1_000;

function isServiceUrl(definition: { matchesUrl(url: URL): boolean }, rawUrl: string): boolean {
  return URL.canParse(rawUrl) && definition.matchesUrl(new URL(rawUrl));
}

export class ControlledTabService {
  private readonly playbackSync = new PlaybackSyncEngine();
  private remoteApplyTimer: ReturnType<typeof setTimeout> | null = null;
  private localUpdateRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: {
      onControlledTabClosed: () => void;
      onControlledTabPlaybackReady: (playback: PlaybackUpdate) => Promise<PlaybackUpdateResult>;
    },
  ) {}

  registerEventHandlers(): void {
    browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
      void this.handleTabUpdated(tabId, tab.url);
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      void this.handleTabRemoved(tabId);
    });
  }

  /** Drop all sync state and pending timers when the session ends. */
  reset(): void {
    this.resetPlaybackSync();
  }

  async handleWatchReport(tabId: number, report: WatchReport): Promise<void> {
    const state = await getBackgroundState();
    const room = state.room;
    if (!room) {
      this.resetPlaybackSync();
      return;
    }

    if (state.connectionStatus !== 'connected') return;

    if (report.serviceId !== room.serviceId) {
      return;
    }

    // Only the reserved tab may control the room. Reports from other tabs on
    // the same service are ignored, not adopted.
    const controlledTab = state.controlledTab;
    if (!controlledTab || controlledTab.tabId !== tabId) {
      return;
    }

    // After a navigation the engine has no authority yet, so the first report
    // from the player seeds the room timeline. A report for anything but the
    // room's media is the page still catching up.
    if (!this.playbackSync.hasAuthority()) {
      if (report.mediaId !== room.playback.mediaId) return;

      await setLastWarning(null);
      this.sendApplyTarget(tabId, this.playbackSync.beginRemoteApply(room));
      return;
    }

    await this.applyDecision(tabId, this.playbackSync.handleObservation(report));
  }

  async applySnapshotToControlledTab(): Promise<void> {
    const { room, controlledTab, connectionStatus } = await getBackgroundState();
    if (!room || !controlledTab || connectionStatus !== 'connected') return;

    const tabMediaId = await this.readWatchTabMediaId(controlledTab.tabId, room.serviceId);
    if (tabMediaId !== room.playback.mediaId) {
      await this.navigateControlledTabToRoom(controlledTab.tabId, room.watchUrl, false);
      return;
    }

    this.sendApplyTarget(controlledTab.tabId, this.playbackSync.beginRemoteApply(room));
    await setLastWarning(null);
  }

  /** Periodic drift correction for quiet playback with no media events. */
  async reconcile(): Promise<void> {
    const { room, controlledTab, connectionStatus } = await getBackgroundState();
    if (!room || !controlledTab) return;
    if (connectionStatus !== 'connected') return;

    const report = await this.requestWatchReportFromTab(controlledTab.tabId);
    if (report) await this.handleWatchReport(controlledTab.tabId, report);
  }

  async navigateControlledTabToRoom(tabId: number, watchUrl: string, active = true): Promise<void> {
    const { controlledTab } = await getBackgroundState();
    if (controlledTab?.tabId === tabId) {
      this.resetPlaybackSync();
    }
    await setLastWarning(null);

    try {
      await browser.tabs.update(tabId, {
        url: watchUrl,
        active,
      });
    } catch (error) {
      throw new Error('Could not open the room video in the current tab.', { cause: error });
    }
  }

  async requireControllableWatchTab(
    tabId: number,
  ): Promise<{ serviceId: ServiceId; playback: PlaybackUpdate }> {
    const tab = await browser.tabs.get(tabId);
    const match = findServiceByUrl(tab.url);
    if (!match) {
      throw new Error('Open a supported watch page before starting a party.');
    }
    if (!match.isWatchPage) {
      throw new Error(`Open a ${match.service.descriptor.label} watch page to start a party.`);
    }

    const expectedMediaId = match.service.extractMediaId(new URL(tab.url!));
    const report = await this.requestWatchReportFromTab(tabId);

    if (!report || report.serviceId !== match.serviceId || report.mediaId !== expectedMediaId) {
      throw new Error(`${match.service.descriptor.label} playback state is not ready yet.`);
    }

    return { serviceId: match.serviceId, playback: toPlaybackUpdate(report) };
  }

  private async requestWatchReportFromTab(tabId: number): Promise<WatchReport | null> {
    try {
      const response = await sendMessage('party:request-watch-report', undefined, { tabId });
      return response ?? null;
    } catch {
      return null;
    }
  }

  private async handleTabUpdated(tabId: number, url: string | undefined): Promise<void> {
    const { controlledTab, session } = await getBackgroundState();
    if (tabId !== controlledTab?.tabId || !url || !session) {
      return;
    }

    const sessionService = getServiceDefinition(session.serviceId);
    if (sessionService && !isServiceUrl(sessionService, url)) {
      await setLastWarning(`The controlled tab left ${sessionService.descriptor.label}.`);
    }
  }

  private async handleTabRemoved(tabId: number): Promise<void> {
    if ((await getBackgroundState()).controlledTab?.tabId !== tabId) {
      return;
    }

    await clearControlledTab();
    this.resetPlaybackSync();
    this.options.onControlledTabClosed();
  }

  private applyDecision(tabId: number, decision: PlaybackSyncDecision): Promise<void> {
    switch (decision.action) {
      case 'ignore':
        return Promise.resolve();
      case 'reapply-target':
        this.sendApplyTarget(tabId, decision.target);
        return Promise.resolve();
      case 'send-update':
        return this.dispatchLocalUpdate(decision.update);
    }
  }

  private sendApplyTarget(tabId: number, target: PlaybackApplyTarget): void {
    this.clearLocalUpdateRetryTimer();
    // Navigation and retries belong to the background. The adapter only reads
    // and controls its own player; the verification timer reissues on drift.
    void this.awaitApplyResult(tabId, target);
    this.scheduleRemoteApplyVerification(tabId, target.commandId);
  }

  private async awaitApplyResult(tabId: number, target: PlaybackApplyTarget): Promise<void> {
    try {
      await sendMessage('party:apply-playback-target', target, { tabId });
    } catch {
      // Best effort; the verification timer reissues if the tab diverges.
    }
  }

  private scheduleRemoteApplyVerification(tabId: number, commandId: string): void {
    this.clearRemoteApplyTimer();

    const timer = this.playbackSync.getRemoteApplyTimer();
    if (!timer || timer.commandId !== commandId) return;

    this.remoteApplyTimer = setTimeout(
      () => {
        this.remoteApplyTimer = null;
        void this.verifyRemoteApply(tabId, commandId);
      },
      Math.max(0, timer.deadlineMs - Date.now()),
    );
  }

  private async verifyRemoteApply(tabId: number, commandId: string): Promise<void> {
    if (!this.playbackSync.isRemoteApplyCurrent(commandId)) return;

    const report = await this.requestWatchReportFromTab(tabId);
    if (!this.playbackSync.isRemoteApplyCurrent(commandId)) return;

    if (report) {
      await this.handleWatchReport(tabId, report);
      return;
    }

    await this.applyDecision(tabId, this.playbackSync.handleRemoteApplyTimeout());
  }

  private async dispatchLocalUpdate(update: PlaybackUpdate): Promise<void> {
    const result = await this.options.onControlledTabPlaybackReady(update);
    const resultApplied = this.playbackSync.markLocalUpdateResult(update, result);
    if (!resultApplied) return;

    if (result === 'retry') {
      this.scheduleLocalUpdateRetry(update);
    } else {
      this.clearLocalUpdateRetryTimer();
    }
  }

  private scheduleLocalUpdateRetry(update: PlaybackUpdate): void {
    this.clearLocalUpdateRetryTimer();
    this.localUpdateRetryTimer = setTimeout(() => {
      this.localUpdateRetryTimer = null;
      void this.retryLocalUpdate(update);
    }, DEFAULT_LOCAL_UPDATE_RETRY_MS);
  }

  private async retryLocalUpdate(update: PlaybackUpdate): Promise<void> {
    if (!this.playbackSync.isPendingLocalUpdate(update)) return;

    const result = await this.options.onControlledTabPlaybackReady(update);
    const resultApplied = this.playbackSync.markLocalUpdateResult(update, result);
    if (resultApplied && result === 'retry' && this.playbackSync.isPendingLocalUpdate(update)) {
      this.scheduleLocalUpdateRetry(update);
    }
  }

  private resetPlaybackSync(): void {
    this.clearRemoteApplyTimer();
    this.clearLocalUpdateRetryTimer();
    this.playbackSync.reset();
  }

  private clearRemoteApplyTimer(): void {
    if (!this.remoteApplyTimer) return;

    clearTimeout(this.remoteApplyTimer);
    this.remoteApplyTimer = null;
  }

  private clearLocalUpdateRetryTimer(): void {
    if (!this.localUpdateRetryTimer) return;

    clearTimeout(this.localUpdateRetryTimer);
    this.localUpdateRetryTimer = null;
  }

  private async readWatchTabMediaId(tabId: number, serviceId: ServiceId): Promise<string | null> {
    const tab = await browser.tabs.get(tabId);
    const match = findServiceByUrl(tab.url);
    if (!match || match.serviceId !== serviceId || !match.isWatchPage) {
      return null;
    }

    return match.service.extractMediaId(new URL(tab.url!));
  }
}
