import { browser } from 'wxt/browser';
import { initialTransition, transition } from 'xstate';
import {
  SERVICE_BY_ID,
  type PartySnapshot,
  type PlaybackUpdate,
  type ServiceId,
} from '@open-watch-party/shared';
import { sendMessage, type PlaybackApplyTarget, type WatchReport } from '../messaging';
import { findServiceByUrl, getServiceDefinition } from '../streaming-services/catalog';
import {
  playbackMachine,
  playbackOperationId,
  toPlaybackUpdate,
  type PlaybackSyncEvent,
  type PlaybackSyncCommand,
  type PlaybackUpdateResult,
} from './playback-sync';
import {
  clearControlledTab,
  getBackgroundState,
  reportBackgroundError,
  setLastWarning,
} from './state';

function isServiceUrl(definition: { matchesUrl(url: URL): boolean }, rawUrl: string): boolean {
  return URL.canParse(rawUrl) && definition.matchesUrl(new URL(rawUrl));
}

export class ControlledTabService {
  private sync = initialTransition(playbackMachine)[0];
  private timer: ReturnType<typeof setTimeout> | null = null;

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

  reset(): void {
    this.dispatch({ type: 'reset' });
  }

  async handleWatchReport(tabId: number, report: WatchReport): Promise<void> {
    const atMs = performance.now();
    const generation = this.sync.context.generation;
    const state = await getBackgroundState();
    if (
      state.connectionStatus !== 'connected' ||
      state.controlledTab?.tabId !== tabId ||
      state.room?.roomCode !== this.sync.context.room?.code
    )
      return;

    this.dispatch({ type: 'observation', report, atMs, generation });
  }

  applySnapshotToControlledTab(snapshot: PartySnapshot, receivedAtMs: number): void {
    // Seed immediately, before storage reads, navigation, or player readiness.
    this.dispatch({ type: 'snapshot', snapshot, atMs: receivedAtMs });
  }

  async reconcile(): Promise<void> {
    const generation = this.sync.context.generation;
    const sequence = this.sync.context.sequence;
    const { controlledTab, connectionStatus } = await getBackgroundState();
    if (!controlledTab || connectionStatus !== 'connected') return;

    const report = await this.requestWatchReportFromTab(controlledTab.tabId);
    if (generation !== this.sync.context.generation || sequence !== this.sync.context.sequence)
      return;
    if (report) await this.handleWatchReport(controlledTab.tabId, report);
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
    this.reset();
    this.options.onControlledTabClosed();
  }

  private dispatch(event: PlaybackSyncEvent): void {
    const [snapshot, actions] = transition(playbackMachine, this.sync, event);
    this.sync = snapshot;
    for (const action of actions) {
      if (action.type !== 'command' || !action.params)
        throw new Error(`Unexpected playback action: ${action.type}`);
      void this.execute(action.params).catch((error: unknown) => {
        void reportBackgroundError(
          error instanceof Error ? error.message : 'Playback sync failed.',
        );
      });
    }
  }

  private async execute(command: PlaybackSyncCommand): Promise<void> {
    switch (command.type) {
      case 'cancel-timer':
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        return;
      case 'verify-after':
      case 'retry-after':
        this.schedule(command);
        return;
      case 'apply-target':
        await this.applyTarget(command.target);
        return;
      case 'send-update': {
        if (
          !this.sync.matches({ active: { publishing: 'sending' } }) ||
          playbackOperationId(this.sync.context) !== command.id
        )
          return;
        let result: PlaybackUpdateResult;
        try {
          result = await this.options.onControlledTabPlaybackReady(command.update);
        } catch {
          result = { status: 'retry' };
        }
        this.dispatch({ type: 'update-result', id: command.id, result, atMs: performance.now() });
      }
    }
  }

  private isApplying(id: string): boolean {
    return (
      this.sync.matches({ active: 'applying' }) && playbackOperationId(this.sync.context) === id
    );
  }

  private async applyTarget(target: PlaybackApplyTarget): Promise<void> {
    const { room, controlledTab, connectionStatus } = await getBackgroundState();
    if (
      !controlledTab ||
      !room ||
      connectionStatus !== 'connected' ||
      room.roomCode !== this.sync.context.room?.code ||
      !this.isApplying(target.commandId)
    )
      return;

    const tab = await browser.tabs.get(controlledTab.tabId);
    if (!this.isApplying(target.commandId)) return;
    const match = findServiceByUrl(tab.url);
    const mediaId =
      match?.serviceId === target.serviceId && match.isWatchPage
        ? match.service.extractMediaId(new URL(tab.url!))
        : null;
    if (mediaId !== target.playback.mediaId) {
      const service = SERVICE_BY_ID[target.serviceId];
      await browser.tabs.update(controlledTab.tabId, {
        url: service.buildCanonicalWatchUrl(target.playback.mediaId),
        active: false,
      });
      return;
    }

    try {
      await sendMessage('party:apply-playback-target', target, { tabId: controlledTab.tabId });
    } catch {
      // The player may still be loading. Verification retries the current target.
    }
  }

  private schedule(command: Extract<PlaybackSyncCommand, { deadlineMs: number }>): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const wake = (): void => {
      const remainingMs = command.deadlineMs - performance.now();
      if (remainingMs > 0) {
        this.timer = setTimeout(wake, remainingMs);
        return;
      }
      this.timer = null;
      if (command.type === 'verify-after') {
        void this.verifyRemoteApply(command.id).catch((error: unknown) => {
          this.dispatch({ type: 'timeout', id: command.id, atMs: performance.now() });
          void reportBackgroundError(
            error instanceof Error ? error.message : 'Playback verification failed.',
          );
        });
      } else {
        this.dispatch({ type: 'timeout', id: command.id, atMs: performance.now() });
      }
    };
    this.timer = setTimeout(wake, Math.max(0, command.deadlineMs - performance.now()));
  }

  private async verifyRemoteApply(id: string): Promise<void> {
    if (!this.isApplying(id)) return;
    const { controlledTab, connectionStatus } = await getBackgroundState();
    if (controlledTab && connectionStatus === 'connected') {
      const report = await this.requestWatchReportFromTab(controlledTab.tabId);
      if (!this.isApplying(id)) return;
      if (report) await this.handleWatchReport(controlledTab.tabId, report);
    }
    this.dispatch({ type: 'timeout', id, atMs: performance.now() });
  }
}
