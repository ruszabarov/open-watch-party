import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlaybackUpdate } from '@open-watch-party/shared';

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      onUpdated: { addListener: vi.fn<(callback: () => void) => void>() },
      onRemoved: { addListener: vi.fn<(callback: () => void) => void>() },
      get: vi.fn<() => Promise<unknown>>(),
      update: vi.fn<() => Promise<unknown>>(),
    },
  },
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    tabs: {
      onUpdated: { addListener: vi.fn<(callback: () => void) => void>() },
      onRemoved: { addListener: vi.fn<(callback: () => void) => void>() },
      get: vi.fn<() => Promise<unknown>>(),
      update: vi.fn<() => Promise<unknown>>(),
    },
  },
}));

vi.mock('#imports', () => ({
  storage: {
    defineItem: vi.fn<() => { getValue: () => Promise<unknown>; setValue: () => Promise<void> }>(
      () => ({
        getValue: vi.fn<() => Promise<unknown>>(),
        setValue: vi.fn<() => Promise<void>>(),
      }),
    ),
  },
}));

import type { PlaybackSyncEngine } from '../../src/background/playback-sync';
import type { WatchReport, WatchReportResult } from '../../src/messaging';

type ControlledTabServiceInternals = {
  playbackSync: PlaybackSyncEngine;
  applySyncDecision(
    tabId: number,
    decision: ReturnType<PlaybackSyncEngine['handleObservation']>,
  ): Promise<WatchReportResult>;
  scheduleLocalUpdateRetry(update: PlaybackUpdate): void;
};

function report(overrides: Partial<WatchReport> = {}): WatchReport {
  return {
    serviceId: 'netflix',
    mediaId: '123456',
    title: 'Movie',
    positionSec: 10,
    playing: true,
    reason: 'snapshot',
    ...overrides,
  };
}

describe('ControlledTabService retry scheduling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces stale retry timers when a newer local update is pending', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      tabs: {},
    });
    const { ControlledTabService } = await import('../../src/background/controlled-tab.service');

    const sentUpdates: PlaybackUpdate[] = [];
    const service = new ControlledTabService({
      onControlledTabClosed: () => undefined,
      onControlledTabPlaybackReady: vi.fn<(playback: PlaybackUpdate) => Promise<WatchReportResult>>(
        async (playback) => {
          sentUpdates.push(playback);
          return 'accepted';
        },
      ),
    });
    const internals = service as unknown as ControlledTabServiceInternals;

    const first = internals.playbackSync.handleObservation(
      report({ playing: false, reason: 'pause' }),
    );
    if (first.action !== 'send-update') throw new Error('Expected first local update');
    internals.playbackSync.markLocalUpdateResult(first.update, 'retry');
    internals.scheduleLocalUpdateRetry(first.update);

    const second = internals.playbackSync.handleObservation(
      report({ positionSec: 20, playing: false, reason: 'seek' }),
    );
    if (second.action !== 'send-update') throw new Error('Expected second local update');
    internals.playbackSync.markLocalUpdateResult(second.update, 'retry');
    internals.scheduleLocalUpdateRetry(second.update);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(sentUpdates).toEqual([second.update]);
  });

  it('ignores stale local update results after a newer update has been accepted', async () => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      tabs: {},
    });
    const { ControlledTabService } = await import('../../src/background/controlled-tab.service');
    const firstResult = Promise.withResolvers<WatchReportResult>();
    const sentUpdates: PlaybackUpdate[] = [];
    const onPlaybackReady = vi
      .fn<(playback: PlaybackUpdate) => Promise<WatchReportResult>>()
      .mockImplementationOnce((playback) => {
        sentUpdates.push(playback);
        return firstResult.promise;
      })
      .mockImplementationOnce(async (playback) => {
        sentUpdates.push(playback);
        return 'accepted';
      });
    const service = new ControlledTabService({
      onControlledTabClosed: () => undefined,
      onControlledTabPlaybackReady: onPlaybackReady,
    });
    const internals = service as unknown as ControlledTabServiceInternals;

    const first = internals.playbackSync.handleObservation(
      report({ playing: false, reason: 'pause' }),
    );
    if (first.action !== 'send-update') throw new Error('Expected first local update');
    const firstApply = internals.applySyncDecision(1, first);

    const second = internals.playbackSync.handleObservation(
      report({ positionSec: 20, playing: false, reason: 'seek' }),
    );
    if (second.action !== 'send-update') throw new Error('Expected second local update');
    await expect(internals.applySyncDecision(1, second)).resolves.toBe('accepted');

    firstResult.resolve('accepted');
    await expect(firstApply).resolves.toBe('ignored');

    expect(sentUpdates).toEqual([first.update, second.update]);
    expect(
      internals.playbackSync.handleObservation(report({ positionSec: 20, playing: false })),
    ).toEqual({ action: 'ignore' });
  });
});
