import { describe, expect, it } from 'vitest';

import type { PartySnapshot, PlaybackUpdate } from '@open-watch-party/shared';
import { PlaybackSyncEngine, playbackAt } from '../../src/background/playback-sync';
import type { WatchReport } from '../../src/messaging';

function snapshot(overrides: Partial<PartySnapshot['playback']> = {}): PartySnapshot {
  return {
    roomCode: 'ROOM01',
    serviceId: 'netflix',
    watchUrl: 'https://www.netflix.com/watch/123456',
    members: [],
    createdAt: 1,
    playback: {
      serviceId: 'netflix',
      mediaId: '123456',
      title: 'Movie',
      positionSec: 10,
      playing: true,
      updatedAt: 1,
      sourceMemberId: 'remote-member',
      ...overrides,
    },
  };
}

function report(overrides: Partial<WatchReport> = {}): WatchReport {
  return {
    serviceId: 'netflix',
    mediaId: '123456',
    title: 'Movie',
    positionSec: 10,
    playing: true,
    ...overrides,
  };
}

describe('PlaybackSyncEngine', () => {
  it('applies remote targets with command ids and ignores stale local observations', () => {
    let now = 1_000;
    const engine = new PlaybackSyncEngine({ now: () => now, remoteApplyTimeoutMs: 1_000 });

    const target = engine.beginRemoteApply(snapshot());

    expect(target).toEqual({
      commandId: 'p1',
      serviceId: 'netflix',
      playback: { mediaId: '123456', title: 'Movie', positionSec: 10, playing: true },
    });

    now = 1_200;
    expect(engine.handleObservation(report({ positionSec: 4, playing: false }))).toEqual({
      action: 'ignore',
    });
  });

  it('confirms a remote target and then ignores normal clock progress', () => {
    let now = 1_000;
    const engine = new PlaybackSyncEngine({ now: () => now });

    engine.beginRemoteApply(snapshot());

    now = 1_300;
    expect(engine.handleObservation(report({ positionSec: 10.3 }))).toEqual({ action: 'ignore' });

    now = 2_300;
    expect(engine.handleObservation(report({ positionSec: 11.3 }))).toEqual({ action: 'ignore' });
  });

  it('uses playback state, not document title metadata, for remote convergence', () => {
    let now = 1_000;
    const engine = new PlaybackSyncEngine({ now: () => now });

    engine.beginRemoteApply(snapshot({ title: 'Room title' }));

    now = 1_300;
    expect(
      engine.handleObservation(report({ title: 'Different page title', positionSec: 10.3 })),
    ).toEqual({
      action: 'ignore',
    });
  });

  it('sends meaningful local playback changes and dedupes the pending update', () => {
    let now = 1_000;
    const engine = new PlaybackSyncEngine({ now: () => now });

    engine.beginRemoteApply(snapshot());
    now = 1_100;
    engine.handleObservation(report({ positionSec: 10.1 }));

    now = 1_200;
    const decision = engine.handleObservation(report({ positionSec: 10.2, playing: false }));
    expect(decision).toEqual({
      action: 'send-update',
      update: { mediaId: '123456', title: 'Movie', positionSec: 10.2, playing: false },
    });

    expect(engine.handleObservation(report({ positionSec: 10.2, playing: false }))).toEqual({
      action: 'ignore',
    });

    if (decision.action === 'send-update') {
      engine.markLocalUpdateResult(decision.update, 'accepted');
    }

    now = 2_200;
    expect(engine.handleObservation(report({ positionSec: 10.2, playing: false }))).toEqual({
      action: 'ignore',
    });
  });

  it('keeps a failed local update pending for retry', () => {
    let now = 1_000;
    const engine = new PlaybackSyncEngine({ now: () => now });

    engine.beginRemoteApply(snapshot());
    now = 1_100;
    engine.handleObservation(report({ positionSec: 10.1 }));

    const decision = engine.handleObservation(report({ positionSec: 10.2, playing: false }));
    if (decision.action !== 'send-update') throw new Error('Expected local update');

    engine.markLocalUpdateResult(decision.update, 'retry');

    expect(engine.getPendingLocalUpdate()).toEqual(decision.update);
    expect(engine.handleObservation(report({ positionSec: 10.2, playing: false }))).toEqual({
      action: 'ignore',
    });
  });

  it('ignores stale local update results after a newer update becomes pending', () => {
    const engine = new PlaybackSyncEngine();

    const first = engine.handleObservation(report({ playing: false }));
    if (first.action !== 'send-update') throw new Error('Expected first local update');

    const second = engine.handleObservation(report({ positionSec: 20, playing: false }));
    if (second.action !== 'send-update') throw new Error('Expected second local update');

    expect(engine.markLocalUpdateResult(first.update, 'accepted')).toBe(false);
    expect(engine.getPendingLocalUpdate()).toEqual(second.update);

    expect(engine.markLocalUpdateResult(first.update, 'ignored')).toBe(false);
    expect(engine.getPendingLocalUpdate()).toEqual(second.update);

    expect(engine.markLocalUpdateResult(second.update, 'accepted')).toBe(true);
    expect(engine.getPendingLocalUpdate()).toBeNull();
  });

  it('reissues a remote target when the controlled tab never converges', () => {
    let now = 1_000;
    const engine = new PlaybackSyncEngine({ now: () => now, remoteApplyTimeoutMs: 1_000 });

    engine.beginRemoteApply(snapshot());

    now = 2_200;
    const decision = engine.handleObservation(report({ positionSec: 4, playing: false }));

    expect(decision).toEqual({
      action: 'reapply-target',
      target: {
        commandId: 'p2',
        serviceId: 'netflix',
        playback: { mediaId: '123456', title: 'Movie', positionSec: 11.2, playing: true },
      },
    });
  });

  it('reissues a remote target on timeout even without a fresh observation', () => {
    let now = 1_000;
    const engine = new PlaybackSyncEngine({ now: () => now, remoteApplyTimeoutMs: 1_000 });

    engine.beginRemoteApply(snapshot());

    now = 2_200;
    expect(engine.handleRemoteApplyTimeout()).toEqual({
      action: 'reapply-target',
      target: {
        commandId: 'p2',
        serviceId: 'netflix',
        playback: { mediaId: '123456', title: 'Movie', positionSec: 11.2, playing: true },
      },
    });
  });
});

describe('playbackAt', () => {
  it('derives playing positions from the sync point clock', () => {
    const playback: PlaybackUpdate = {
      mediaId: '123456',
      title: 'Movie',
      positionSec: 10,
      playing: true,
    };

    expect(playbackAt({ playback, observedAtMs: 1_000 }, 2_500)).toEqual({
      ...playback,
      positionSec: 11.5,
    });
  });
});
