import { describe, expect, it, vi } from 'vitest';

import {
  NETFLIX_PLAYER_VIDEO_RECONCILE_DELAY_MS,
  applyNetflixPlayerCommand,
} from '../../src/streaming-services/netflix/player-content-script';
import type { NetflixPlayer } from '../../src/streaming-services/netflix/window';

function playbackVideo(
  pausedInitial = true,
): Pick<HTMLVideoElement, 'currentTime' | 'paused' | 'pause' | 'play'> {
  let paused = pausedInitial;

  return {
    currentTime: 0,
    get paused() {
      return paused;
    },
    play: vi.fn<() => Promise<void>>(() => {
      paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn<() => void>(() => {
      paused = true;
    }),
  } as Pick<HTMLVideoElement, 'currentTime' | 'paused' | 'pause' | 'play'>;
}

describe('applyNetflixPlayerCommand', () => {
  it('uses Netflix internal player APIs for authoritative seek and play commands', () => {
    const video = playbackVideo(true);
    const player = {
      seek: vi.fn<(positionMs: number) => void>(),
      play: vi.fn<() => void>(),
      pause: vi.fn<() => void>(),
    } satisfies NetflixPlayer;
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];

    applyNetflixPlayerCommand(
      { playing: true, positionMs: 42_000 },
      {
        getPlayer: () => player,
        getVideo: () => video,
        schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }),
      },
    );

    expect(player.seek).toHaveBeenCalledWith(42_000);
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(NETFLIX_PLAYER_VIDEO_RECONCILE_DELAY_MS);

    scheduled[0]?.callback();
    expect(video.play).toHaveBeenCalledOnce();
  });

  it('falls back to the video element when the internal player is unavailable', () => {
    const video = playbackVideo(false);

    applyNetflixPlayerCommand(
      { playing: false, positionMs: 12_345 },
      {
        getPlayer: () => null,
        getVideo: () => video,
        schedule: () => undefined,
      },
    );

    expect(video.currentTime).toBe(12.345);
    expect(video.pause).toHaveBeenCalledOnce();
  });

  it('ignores stale delayed video reconciles after a newer command arrives', () => {
    const video = playbackVideo(true);
    const player = {
      seek: vi.fn<(positionMs: number) => void>(),
      play: vi.fn<() => void>(),
      pause: vi.fn<() => void>(),
    } satisfies NetflixPlayer;
    const scheduled: Array<() => void> = [];

    applyNetflixPlayerCommand(
      { playing: true },
      {
        getPlayer: () => player,
        getVideo: () => video,
        schedule: (callback) => scheduled.push(callback),
      },
    );
    applyNetflixPlayerCommand(
      { playing: false },
      {
        getPlayer: () => player,
        getVideo: () => video,
        schedule: (callback) => scheduled.push(callback),
      },
    );

    scheduled[0]?.();

    expect(video.play).not.toHaveBeenCalled();
  });
});
