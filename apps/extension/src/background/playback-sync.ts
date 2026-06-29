import type { PartySnapshot, PlaybackUpdate } from '@open-watch-party/shared';

import type { PlaybackApplyTarget, WatchReport } from '../messaging';

const DEFAULT_POSITION_TOLERANCE_SEC = 1.5;
const DEFAULT_REMOTE_APPLY_TIMEOUT_MS = 2_500;

type SyncPoint = {
  playback: PlaybackUpdate;
  observedAtMs: number;
};

type RemoteApplyState = {
  target: PlaybackApplyTarget;
  syncPoint: SyncPoint;
  deadlineMs: number;
};

export type RemoteApplyTimer = {
  commandId: string;
  deadlineMs: number;
};

export type PlaybackSyncDecision =
  | { action: 'ignore' }
  | { action: 'send-update'; update: PlaybackUpdate }
  | { action: 'reapply-target'; target: PlaybackApplyTarget };

export type PlaybackSyncOptions = {
  now?: () => number;
  positionToleranceSec?: number;
  remoteApplyTimeoutMs?: number;
};

export class PlaybackSyncEngine {
  private readonly now: () => number;
  private readonly positionToleranceSec: number;
  private readonly remoteApplyTimeoutMs: number;
  private commandSeq = 0;
  private lastAccepted: SyncPoint | null = null;
  private pendingLocalUpdate: SyncPoint | null = null;
  private remoteApply: RemoteApplyState | null = null;

  constructor(options: PlaybackSyncOptions = {}) {
    this.now = options.now ?? Date.now;
    this.positionToleranceSec = options.positionToleranceSec ?? DEFAULT_POSITION_TOLERANCE_SEC;
    this.remoteApplyTimeoutMs = options.remoteApplyTimeoutMs ?? DEFAULT_REMOTE_APPLY_TIMEOUT_MS;
  }

  reset(): void {
    this.lastAccepted = null;
    this.pendingLocalUpdate = null;
    this.remoteApply = null;
  }

  beginRemoteApply(snapshot: PartySnapshot): PlaybackApplyTarget {
    const issuedAtMs = this.now();
    const target = this.createTarget(snapshot);

    this.pendingLocalUpdate = null;
    this.lastAccepted = { playback: target.playback, observedAtMs: issuedAtMs };
    this.remoteApply = {
      target,
      syncPoint: { playback: target.playback, observedAtMs: issuedAtMs },
      deadlineMs: issuedAtMs + this.remoteApplyTimeoutMs,
    };

    return target;
  }

  handleObservation(report: WatchReport): PlaybackSyncDecision {
    const observedAtMs = this.now();
    const reportPlayback = toPlaybackUpdate(report);

    if (this.remoteApply) {
      if (this.matchesSyncPoint(report, this.remoteApply.syncPoint, observedAtMs)) {
        this.lastAccepted = {
          playback: reportPlayback,
          observedAtMs,
        };
        this.remoteApply = null;
        return { action: 'ignore' };
      }

      if (observedAtMs < this.remoteApply.deadlineMs) {
        return { action: 'ignore' };
      }

      const target = this.reissueRemoteApply(this.remoteApply, observedAtMs);
      return { action: 'reapply-target', target };
    }

    const activeLocalUpdate = this.pendingLocalUpdate ?? this.lastAccepted;
    if (activeLocalUpdate && this.matchesSyncPoint(report, activeLocalUpdate, observedAtMs)) {
      this.reanchorAcceptedPlayback(reportPlayback, observedAtMs);
      return { action: 'ignore' };
    }

    if (!isSyncIntent(report)) {
      this.reanchorAcceptedPlayback(reportPlayback, observedAtMs);
      return { action: 'ignore' };
    }

    if (activeLocalUpdate && !this.shouldBroadcastIntent(report, activeLocalUpdate, observedAtMs)) {
      this.reanchorAcceptedPlayback(reportPlayback, observedAtMs);
      return { action: 'ignore' };
    }

    this.pendingLocalUpdate = { playback: reportPlayback, observedAtMs };
    return { action: 'send-update', update: reportPlayback };
  }

  markLocalUpdateResult(update: PlaybackUpdate, result: 'accepted' | 'ignored' | 'retry'): boolean {
    const pendingLocalUpdate = this.pendingLocalUpdate;
    if (!pendingLocalUpdate || !playbackUpdatesEqual(pendingLocalUpdate.playback, update)) {
      return false;
    }

    if (result === 'accepted') {
      this.lastAccepted = {
        playback: update,
        observedAtMs: pendingLocalUpdate.observedAtMs,
      };
      this.pendingLocalUpdate = null;
      return true;
    }

    if (result === 'ignored') {
      this.pendingLocalUpdate = null;
    }

    return true;
  }

  getPendingLocalUpdate(): PlaybackUpdate | null {
    return this.pendingLocalUpdate?.playback ?? null;
  }

  isPendingLocalUpdate(update: PlaybackUpdate): boolean {
    return (
      this.pendingLocalUpdate !== null &&
      playbackUpdatesEqual(this.pendingLocalUpdate.playback, update)
    );
  }

  getRemoteApplyTimer(): RemoteApplyTimer | null {
    if (!this.remoteApply) return null;

    return {
      commandId: this.remoteApply.target.commandId,
      deadlineMs: this.remoteApply.deadlineMs,
    };
  }

  isRemoteApplyCurrent(commandId: string): boolean {
    return this.remoteApply?.target.commandId === commandId;
  }

  handleRemoteApplyTimeout(): PlaybackSyncDecision {
    if (!this.remoteApply) return { action: 'ignore' };

    const observedAtMs = this.now();
    if (observedAtMs < this.remoteApply.deadlineMs) {
      return { action: 'ignore' };
    }

    const target = this.reissueRemoteApply(this.remoteApply, observedAtMs);
    return { action: 'reapply-target', target };
  }

  private createTarget(snapshot: PartySnapshot): PlaybackApplyTarget {
    return {
      commandId: `p${(this.commandSeq += 1)}`,
      serviceId: snapshot.serviceId,
      playback: {
        mediaId: snapshot.playback.mediaId,
        title: snapshot.playback.title ?? '',
        positionSec: snapshot.playback.positionSec,
        playing: snapshot.playback.playing,
      },
    };
  }

  private reissueRemoteApply(state: RemoteApplyState, issuedAtMs: number): PlaybackApplyTarget {
    const target = {
      ...state.target,
      commandId: `p${(this.commandSeq += 1)}`,
      playback: playbackAt(state.syncPoint, issuedAtMs),
    };

    state.target = target;
    state.syncPoint = { playback: target.playback, observedAtMs: issuedAtMs };
    state.deadlineMs = issuedAtMs + this.remoteApplyTimeoutMs;
    return target;
  }

  private matchesSyncPoint(
    report: WatchReport,
    syncPoint: SyncPoint,
    observedAtMs: number,
  ): boolean {
    const expectedPlayback = playbackAt(syncPoint, observedAtMs);

    return playbackMatches(report, expectedPlayback, this.positionToleranceSec);
  }

  private shouldBroadcastIntent(
    report: WatchReport,
    syncPoint: SyncPoint,
    observedAtMs: number,
  ): boolean {
    const expectedPlayback = playbackAt(syncPoint, observedAtMs);

    if (report.mediaId !== expectedPlayback.mediaId) {
      return true;
    }

    switch (report.reason) {
      case 'play':
        return report.playing && !expectedPlayback.playing;
      case 'pause':
        return !report.playing && expectedPlayback.playing;
      case 'seek':
        return (
          Math.abs(report.positionSec - expectedPlayback.positionSec) >= this.positionToleranceSec
        );
      case 'snapshot':
        return false;
    }
  }

  private reanchorAcceptedPlayback(playback: PlaybackUpdate, observedAtMs: number): void {
    if (this.pendingLocalUpdate) return;
    if (!this.lastAccepted) return;
    if (playback.mediaId !== this.lastAccepted.playback.mediaId) return;
    if (playback.playing !== this.lastAccepted.playback.playing) return;

    this.lastAccepted = { playback, observedAtMs };
  }
}

function isSyncIntent(report: WatchReport): boolean {
  return report.reason === 'play' || report.reason === 'pause' || report.reason === 'seek';
}

export function toPlaybackUpdate(report: WatchReport): PlaybackUpdate {
  return {
    mediaId: report.mediaId,
    title: report.title ?? '',
    positionSec: report.positionSec,
    playing: report.playing,
  };
}

export function playbackMatches(
  report: WatchReport,
  expected: PlaybackUpdate,
  positionToleranceSec = DEFAULT_POSITION_TOLERANCE_SEC,
): boolean {
  return (
    report.mediaId === expected.mediaId &&
    report.playing === expected.playing &&
    Math.abs(report.positionSec - expected.positionSec) < positionToleranceSec
  );
}

function playbackUpdatesEqual(left: PlaybackUpdate, right: PlaybackUpdate): boolean {
  return (
    left.mediaId === right.mediaId &&
    (left.title ?? '') === (right.title ?? '') &&
    left.positionSec === right.positionSec &&
    left.playing === right.playing
  );
}

export function playbackAt(syncPoint: SyncPoint, observedAtMs: number): PlaybackUpdate {
  if (!syncPoint.playback.playing) {
    return syncPoint.playback;
  }

  return {
    ...syncPoint.playback,
    positionSec: Number(
      (
        syncPoint.playback.positionSec +
        Math.max(0, observedAtMs - syncPoint.observedAtMs) / 1000
      ).toFixed(3),
    ),
  };
}
