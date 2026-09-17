import {
  PLAYBACK_POSITION_TOLERANCE_SEC,
  type PartySnapshot,
  type PlaybackUpdate,
  type ServiceId,
} from '@open-watch-party/shared';

import type { PlaybackApplyTarget, WatchReport } from '../messaging';

const DEFAULT_REMOTE_APPLY_TIMEOUT_MS = 2_500;

type SyncPoint = {
  playback: PlaybackUpdate;
  observedAtMs: number;
};

type RemoteApplyState = {
  target: PlaybackApplyTarget;
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

// Outcome of a local playback update round-trip. `retry` means the request can
// plausibly succeed later; the sender reschedules it.
export type PlaybackUpdateResult = 'accepted' | 'ignored' | 'retry';

export type PlaybackSyncOptions = {
  now?: () => number;
  positionToleranceSec?: number;
  remoteApplyTimeoutMs?: number;
};

// The engine keeps one authoritative room timeline (a playback position anchored
// to a local monotonic instant). Local reports only ever confirm or challenge
// that timeline; they never replace it, so buffering, ads, or a stalled player
// cannot silently pull the room out of sync.
export class PlaybackSyncEngine {
  private readonly now: () => number;
  private readonly positionToleranceSec: number;
  private readonly remoteApplyTimeoutMs: number;
  private commandSeq = 0;
  private authority: SyncPoint | null = null;
  private serviceId: ServiceId | null = null;
  private pendingLocalUpdate: SyncPoint | null = null;
  private remoteApply: RemoteApplyState | null = null;

  constructor(options: PlaybackSyncOptions = {}) {
    this.now = options.now ?? Date.now;
    this.positionToleranceSec = options.positionToleranceSec ?? PLAYBACK_POSITION_TOLERANCE_SEC;
    this.remoteApplyTimeoutMs = options.remoteApplyTimeoutMs ?? DEFAULT_REMOTE_APPLY_TIMEOUT_MS;
  }

  reset(): void {
    this.authority = null;
    this.serviceId = null;
    this.pendingLocalUpdate = null;
    this.remoteApply = null;
  }

  /** False until a room timeline has been seeded for the current media. */
  hasAuthority(): boolean {
    return this.authority !== null;
  }

  beginRemoteApply(snapshot: PartySnapshot): PlaybackApplyTarget {
    this.serviceId = snapshot.serviceId;
    this.pendingLocalUpdate = null;
    return this.issueTarget(
      snapshot.serviceId,
      {
        mediaId: snapshot.playback.mediaId,
        title: snapshot.playback.title ?? '',
        positionSec: snapshot.playback.positionSec,
        playing: snapshot.playback.playing,
      },
      this.now(),
    );
  }

  handleObservation(report: WatchReport): PlaybackSyncDecision {
    const observedAtMs = this.now();
    const reportPlayback = toPlaybackUpdate(report);

    if (this.remoteApply) {
      if (this.matchesAuthority(report, observedAtMs)) {
        this.remoteApply = null;
        return { action: 'ignore' };
      }

      if (observedAtMs < this.remoteApply.deadlineMs) {
        return { action: 'ignore' };
      }

      return this.reissue(observedAtMs);
    }

    // A local intent is in flight; wait for the server to accept or reject it.
    if (this.pendingLocalUpdate) {
      return { action: 'ignore' };
    }

    if (this.matchesAuthority(report, observedAtMs)) {
      return { action: 'ignore' };
    }

    if (!isSyncIntent(report)) {
      return this.authority && this.serviceId ? this.reissue(observedAtMs) : { action: 'ignore' };
    }

    if (this.authority && !this.shouldBroadcastIntent(report, this.authority, observedAtMs)) {
      return { action: 'ignore' };
    }

    this.pendingLocalUpdate = { playback: reportPlayback, observedAtMs };
    return { action: 'send-update', update: reportPlayback };
  }

  markLocalUpdateResult(update: PlaybackUpdate, result: PlaybackUpdateResult): boolean {
    const pendingLocalUpdate = this.pendingLocalUpdate;
    if (!pendingLocalUpdate || !playbackUpdatesEqual(pendingLocalUpdate.playback, update)) {
      return false;
    }

    if (result === 'accepted') {
      this.authority = { playback: update, observedAtMs: pendingLocalUpdate.observedAtMs };
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

    return this.reissue(observedAtMs);
  }

  private issueTarget(
    serviceId: ServiceId,
    playback: PlaybackUpdate,
    issuedAtMs: number,
  ): PlaybackApplyTarget {
    const target: PlaybackApplyTarget = {
      commandId: `p${(this.commandSeq += 1)}`,
      serviceId,
      playback,
    };

    this.authority = { playback, observedAtMs: issuedAtMs };
    this.remoteApply = { target, deadlineMs: issuedAtMs + this.remoteApplyTimeoutMs };
    return target;
  }

  private reissue(issuedAtMs: number): PlaybackSyncDecision {
    if (!this.authority || !this.serviceId) return { action: 'ignore' };

    const target = this.issueTarget(
      this.serviceId,
      playbackAt(this.authority, issuedAtMs),
      issuedAtMs,
    );
    return { action: 'reapply-target', target };
  }

  private matchesAuthority(report: WatchReport, observedAtMs: number): boolean {
    if (!this.authority) return false;

    return playbackMatches(
      report,
      playbackAt(this.authority, observedAtMs),
      this.positionToleranceSec,
    );
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
  positionToleranceSec = PLAYBACK_POSITION_TOLERANCE_SEC,
): boolean {
  return (
    report.mediaId === expected.mediaId &&
    report.playing === expected.playing &&
    Math.abs(report.positionSec - expected.positionSec) <= positionToleranceSec
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
