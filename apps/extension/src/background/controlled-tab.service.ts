import { browser } from 'wxt/browser';
import type { PartySnapshot, PlaybackUpdate, ServiceId } from '@open-watch-party/shared';
import {
  sendMessage,
  type PlaybackApplyTarget,
  type WatchReport,
  type WatchReportResult,
} from '../messaging';
import { findServiceByUrl, getServiceDefinition } from '../streaming-services/catalog';
import { PlaybackSyncEngine, toPlaybackUpdate, type PlaybackSyncDecision } from './playback-sync';
import { clearControlledTab, getBackgroundState, setControlledTab, setLastWarning } from './state';

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
      onControlledTabPlaybackReady: (playback: PlaybackUpdate) => Promise<WatchReportResult>;
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

  async handleWatchReport(tabId: number, report: WatchReport): Promise<WatchReportResult> {
    const state = await getBackgroundState();
    const room = state.room;
    if (!room) {
      this.resetPlaybackSync();
      return 'ignored';
    }

    if (report.serviceId !== room.serviceId) {
      return 'ignored';
    }

    const controlledTab = state.controlledTab;
    if (!controlledTab) {
      return this.adoptTabForRoom(tabId, report, room);
    }

    if (controlledTab.tabId !== tabId) {
      return 'ignored';
    }

    await setControlledTab({
      tabId,
      mediaId: report.mediaId,
    });

    return this.applyDecision(controlledTab.tabId, this.playbackSync.handleObservation(report));
  }

  async applySnapshotToControlledTab(): Promise<void> {
    const { room, controlledTab } = await getBackgroundState();
    if (!room || !controlledTab) return;

    const tabMediaId = await this.readWatchTabMediaId(controlledTab.tabId, room.serviceId);
    if (tabMediaId !== room.playback.mediaId) {
      await this.navigateControlledTabToRoom(controlledTab.tabId, room.watchUrl, false);
      return;
    }

    this.sendApplyTarget(controlledTab.tabId, this.playbackSync.beginRemoteApply(room));
    await setLastWarning(null);
  }

  async navigateControlledTabToRoom(tabId: number, watchUrl: string, active = true): Promise<void> {
    if ((await getBackgroundState()).controlledTab?.tabId === tabId) {
      await clearControlledTab();
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

  private async adoptTabForRoom(
    tabId: number,
    report: WatchReport,
    room: PartySnapshot,
  ): Promise<WatchReportResult> {
    await setControlledTab({ tabId, mediaId: report.mediaId });
    await setLastWarning(null);

    if (room.playback.mediaId !== report.mediaId) {
      await this.navigateControlledTabToRoom(tabId, room.watchUrl, false);
      return 'ignored';
    }

    this.sendApplyTarget(tabId, this.playbackSync.beginRemoteApply(room));
    return 'accepted';
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

  private applyDecision(tabId: number, decision: PlaybackSyncDecision): Promise<WatchReportResult> {
    switch (decision.action) {
      case 'ignore':
        return Promise.resolve('ignored');
      case 'reapply-target':
        this.sendApplyTarget(tabId, decision.target);
        return Promise.resolve('ignored');
      case 'send-update':
        return this.dispatchLocalUpdate(decision.update);
    }
  }

  private sendApplyTarget(tabId: number, target: PlaybackApplyTarget): void {
    this.clearLocalUpdateRetryTimer();
    void sendMessage('party:apply-playback-target', target, { tabId }).catch(() => undefined);
    this.scheduleRemoteApplyVerification(tabId, target.commandId);
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

  private async dispatchLocalUpdate(update: PlaybackUpdate): Promise<WatchReportResult> {
    const result = await this.options.onControlledTabPlaybackReady(update);
    const resultApplied = this.playbackSync.markLocalUpdateResult(update, result);
    if (!resultApplied) return 'ignored';

    if (result === 'retry') {
      this.scheduleLocalUpdateRetry(update);
    } else {
      this.clearLocalUpdateRetryTimer();
    }

    return result;
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
