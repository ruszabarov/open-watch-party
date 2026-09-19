import { and, assertEvent, not, setup } from 'xstate';
import {
  PLAYBACK_POSITION_TOLERANCE_SEC,
  type PartySnapshot,
  type PlaybackUpdate,
  type ServiceId,
} from '@open-watch-party/shared';

import type { PlaybackApplyTarget, WatchReport } from '../messaging';

const REMOTE_APPLY_TIMEOUT_MS = 2_500;
const LOCAL_UPDATE_RETRY_MS = 1_000;

type SyncPoint = {
  playback: PlaybackUpdate;
  observedAtMs: number;
};

type PlaybackContext = {
  generation: number;
  sequence: number;
  room: { code: string; serviceId: ServiceId; authority: SyncPoint } | null;
  lastObservationAtMs: number;
  deadlineMs: number;
  intent: SyncPoint | null;
  queued: SyncPoint | null;
};

export type PlaybackUpdateResult =
  | { status: 'accepted'; snapshot: PartySnapshot; receivedAtMs: number }
  | { status: 'ignored' | 'retry' };

export type PlaybackSyncEvent =
  | { type: 'reset' }
  | { type: 'snapshot'; snapshot: PartySnapshot; atMs: number }
  | { type: 'observation'; report: WatchReport; atMs: number; generation: number }
  | { type: 'update-result'; id: string; result: PlaybackUpdateResult; atMs: number }
  | { type: 'timeout'; id: string; atMs: number };

export type PlaybackSyncCommand =
  | { type: 'apply-target'; target: PlaybackApplyTarget }
  | { type: 'send-update'; id: string; update: PlaybackUpdate }
  | { type: 'verify-after' | 'retry-after'; id: string; deadlineMs: number }
  | { type: 'cancel-timer' };

const initialContext: PlaybackContext = {
  generation: 0,
  sequence: 0,
  room: null,
  lastObservationAtMs: 0,
  deadlineMs: 0,
  intent: null,
  queued: null,
};

// Use initialTransition/transition: assignments and guards are pure, and the
// returned command action parameters describe I/O for ControlledTabService.
const playbackSetup = setup({
  types: {
    context: {} as PlaybackContext,
    events: {} as PlaybackSyncEvent,
  },
  guards: {
    freshSnapshot: ({ context, event }) => {
      assertEvent(event, 'snapshot');
      return !context.room || event.atMs >= context.room.authority.observedAtMs;
    },
    currentObservation: ({ context, event }) => {
      assertEvent(event, 'observation');
      return (
        context.room !== null &&
        event.generation === context.generation &&
        event.report.serviceId === context.room.serviceId &&
        event.atMs >= context.room.authority.observedAtMs &&
        event.atMs >= context.lastObservationAtMs
      );
    },
    matchesAuthority: ({ context, event }) => {
      assertEvent(event, 'observation');
      return (
        context.room !== null &&
        playbackMatches(event.report, playbackAt(context.room.authority, event.atMs))
      );
    },
    localIntent: ({ context, event }) => {
      assertEvent(event, 'observation');
      const desired = context.queued ?? context.intent ?? context.room?.authority;
      if (!desired) return false;
      const expected = playbackAt(desired, event.atMs);
      if (playbackMatches(event.report, expected)) return false;
      // Readiness for different media is local navigation, even when paused.
      return event.report.mediaId !== expected.mediaId || isSyncIntent(event.report, expected);
    },
    currentOperation: ({ context, event }) => {
      assertEvent(event, ['update-result', 'timeout']);
      return event.id === playbackOperationId(context);
    },
    freshAcceptedResult: ({ context, event }) => {
      assertEvent(event, 'update-result');
      return (
        event.result.status === 'accepted' &&
        event.id.startsWith(`${context.generation}:`) &&
        context.room?.code === event.result.snapshot.roomCode &&
        event.result.receivedAtMs >= context.room.authority.observedAtMs
      );
    },
    retryable: ({ event }) => {
      assertEvent(event, 'update-result');
      return event.result.status === 'retry';
    },
    deadlinePassed: ({ context, event }) => {
      assertEvent(event, ['observation', 'timeout']);
      return event.atMs >= context.deadlineMs;
    },
    hasQueuedIntent: ({ context }) => context.queued !== null,
  },
  actions: {
    // Pure transitions collect this action without executing its implementation.
    command: (_args, _command: PlaybackSyncCommand) => {},
  },
});

export const playbackMachine = playbackSetup
  .extend({
    actions: {
      reset: playbackSetup.assign(({ context }) => ({
        ...initialContext,
        generation: context.generation + 1,
      })),
      receiveSnapshot: playbackSetup.assign(({ event }) => {
        assertEvent(event, 'snapshot');
        return {
          room: {
            code: event.snapshot.roomCode,
            serviceId: event.snapshot.serviceId,
            authority: snapshotPoint(event.snapshot, event.atMs),
          },
          intent: null,
          queued: null,
        };
      }),
      rememberObservation: playbackSetup.assign(({ event }) => {
        assertEvent(event, 'observation');
        return { lastObservationAtMs: event.atMs };
      }),
      rememberIntent: playbackSetup.assign(({ event }) => {
        assertEvent(event, 'observation');
        return { intent: { playback: toPlaybackUpdate(event.report), observedAtMs: event.atMs } };
      }),
      queueIntent: playbackSetup.assign(({ event }) => {
        assertEvent(event, 'observation');
        return { queued: { playback: toPlaybackUpdate(event.report), observedAtMs: event.atMs } };
      }),
      acceptResult: playbackSetup.assign(({ context, event }) => {
        assertEvent(event, 'update-result');
        if (event.result.status !== 'accepted' || !context.room) return {};
        return {
          room: {
            ...context.room,
            authority: snapshotPoint(event.result.snapshot, event.result.receivedAtMs),
          },
        };
      }),
      clearIntent: playbackSetup.assign({ intent: null, queued: null }),
      applyPlayback: playbackSetup.enqueueActions(({ context, event, enqueue }) => {
        assertEvent(event, ['snapshot', 'observation', 'timeout', 'update-result']);
        if (!context.room) throw new Error('Cannot apply playback without a room timeline.');
        const sequence = context.sequence + 1;
        const id = playbackOperationId({ ...context, sequence });
        const deadlineMs = event.atMs + REMOTE_APPLY_TIMEOUT_MS;
        enqueue.assign({ sequence, deadlineMs });
        enqueue({
          type: 'command',
          params: {
            type: 'apply-target',
            target: {
              commandId: id,
              serviceId: context.room.serviceId,
              playback: playbackAt(context.room.authority, event.atMs),
            },
          },
        });
        enqueue({ type: 'command', params: { type: 'verify-after', id, deadlineMs } });
      }),
      publishPlayback: playbackSetup.enqueueActions(({ context, event, enqueue }) => {
        assertEvent(event, ['observation', 'update-result', 'timeout']);
        const intent = context.queued ?? context.intent;
        if (!intent) throw new Error('Cannot publish playback without a local intent.');
        const sequence = context.sequence + 1;
        const id = playbackOperationId({ ...context, sequence });
        const update = playbackAt(intent, event.atMs);
        enqueue.assign({
          sequence,
          intent: { playback: update, observedAtMs: event.atMs },
          queued: null,
        });
        enqueue({ type: 'command', params: { type: 'send-update', id, update } });
      }),
      scheduleRetry: playbackSetup.enqueueActions(({ context, event, enqueue }) => {
        assertEvent(event, 'update-result');
        const deadlineMs = event.atMs + LOCAL_UPDATE_RETRY_MS;
        enqueue.assign({ deadlineMs });
        enqueue({
          type: 'command',
          params: { type: 'retry-after', id: playbackOperationId(context), deadlineMs },
        });
      }),
    },
  })
  .createMachine({
    id: 'playback',
    context: initialContext,
    initial: 'inactive',
    on: {
      reset: { target: '.inactive', actions: 'reset' },
      // A remote snapshot can interrupt a publish whose request is already on
      // the wire. Its later acknowledgement is still the server's newest state.
      'update-result': {
        guard: 'freshAcceptedResult',
        target: '.active.applying',
        reenter: true,
        actions: ['acceptResult', 'clearIntent'],
      },
      snapshot: {
        guard: 'freshSnapshot',
        target: '.active.applying',
        reenter: true,
        actions: 'receiveSnapshot',
      },
    },
    states: {
      inactive: {},
      active: {
        initial: 'synced',
        on: {
          observation: { guard: 'currentObservation', actions: 'rememberObservation' },
        },
        states: {
          synced: {
            on: {
              observation: [
                {
                  guard: and(['currentObservation', 'localIntent']),
                  target: 'publishing',
                  actions: ['rememberObservation', 'rememberIntent'],
                },
                {
                  guard: and(['currentObservation', not('matchesAuthority')]),
                  target: 'applying',
                  actions: 'rememberObservation',
                },
              ],
            },
          },
          applying: {
            entry: 'applyPlayback',
            exit: { type: 'command', params: { type: 'cancel-timer' } },
            on: {
              observation: [
                {
                  guard: and(['currentObservation', 'matchesAuthority']),
                  target: 'synced',
                  actions: 'rememberObservation',
                },
                {
                  guard: and(['currentObservation', 'deadlinePassed']),
                  target: 'applying',
                  reenter: true,
                  actions: 'rememberObservation',
                },
              ],
              timeout: {
                guard: and(['currentOperation', 'deadlinePassed']),
                target: 'applying',
                reenter: true,
              },
            },
          },
          publishing: {
            initial: 'sending',
            exit: 'clearIntent',
            on: {
              observation: {
                guard: and(['currentObservation', 'localIntent']),
                actions: ['rememberObservation', 'queueIntent'],
              },
            },
            states: {
              sending: {
                entry: 'publishPlayback',
                on: {
                  'update-result': [
                    { guard: and(['currentOperation', 'retryable']), target: 'retrying' },
                    { guard: 'currentOperation', target: 'settled', actions: 'acceptResult' },
                  ],
                },
              },
              retrying: {
                entry: 'scheduleRetry',
                exit: { type: 'command', params: { type: 'cancel-timer' } },
                on: {
                  timeout: {
                    guard: and(['currentOperation', 'deadlinePassed']),
                    target: 'sending',
                  },
                },
              },
              settled: {
                always: [
                  { guard: 'hasQueuedIntent', target: 'sending' },
                  { target: '#playback.active.synced' },
                ],
              },
            },
          },
        },
      },
    },
  });

export function playbackOperationId(
  context: Pick<PlaybackContext, 'generation' | 'sequence'>,
): string {
  return `${context.generation}:${context.sequence}`;
}

function snapshotPoint(snapshot: PartySnapshot, receivedAtMs: number): SyncPoint {
  return {
    playback: {
      mediaId: snapshot.playback.mediaId,
      title: snapshot.playback.title ?? '',
      positionSec: snapshot.playback.positionSec,
      playing: snapshot.playback.playing,
    },
    observedAtMs: receivedAtMs,
  };
}

function isSyncIntent(report: WatchReport, expected: PlaybackUpdate): boolean {
  switch (report.reason) {
    case 'play':
      return report.playing && !expected.playing;
    case 'pause':
      return !report.playing && expected.playing;
    case 'seek':
      return Math.abs(report.positionSec - expected.positionSec) > PLAYBACK_POSITION_TOLERANCE_SEC;
    case 'snapshot':
      return false;
  }
}

export function toPlaybackUpdate(report: WatchReport): PlaybackUpdate {
  return {
    mediaId: report.mediaId,
    title: report.title ?? '',
    positionSec: report.positionSec,
    playing: report.playing,
  };
}

function playbackMatches(report: WatchReport, expected: PlaybackUpdate): boolean {
  return (
    report.mediaId === expected.mediaId &&
    report.playing === expected.playing &&
    Math.abs(report.positionSec - expected.positionSec) <= PLAYBACK_POSITION_TOLERANCE_SEC
  );
}

function playbackAt(point: SyncPoint, atMs: number): PlaybackUpdate {
  return point.playback.playing
    ? {
        ...point.playback,
        positionSec: Number(
          (point.playback.positionSec + Math.max(0, atMs - point.observedAtMs) / 1000).toFixed(3),
        ),
      }
    : point.playback;
}
