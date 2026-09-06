import type { PlaybackApplyTarget } from '../../messaging';
import { isVideoTimelineReady } from '../playback-readiness';
import {
  needsSeek,
  waitForMatch,
  type ApplyPlaybackResult,
  type VideoAdapter,
} from '../video-adapter';
import type { NetflixPlayerCommand } from './player-rpc';

export type NetflixAdapterDeps = {
  getVideo: () => HTMLVideoElement | null;
  readMediaId: () => string | null;
  sendCommand: (command: NetflixPlayerCommand) => void;
  navigateToMedia: (mediaId: string) => void;
  markSuppressed: () => void;
};

export type NetflixAdapter = VideoAdapter & {
  // Applies a target queued by an earlier cross-episode navigation once the
  // new video node is ready. Called on every refresh/loadedmetadata.
  flushPending: () => void;
};

type PendingEpisodeTarget = {
  mediaId: string;
  positionSec: number;
  playing: boolean;
};

function buildCommand(
  video: HTMLVideoElement,
  positionSec: number,
  playing: boolean,
): NetflixPlayerCommand {
  // Never write currentTime on Netflix: it crashes the player
  // ("Whoops! Something went wrong"). Seeks go through Cadmium only.
  return needsSeek(video.currentTime, positionSec)
    ? { playing, positionMs: Math.round(positionSec * 1000) }
    : { playing };
}

export function createNetflixAdapter(deps: NetflixAdapterDeps): NetflixAdapter {
  let pending: PendingEpisodeTarget | null = null;

  const sendFor = (video: HTMLVideoElement, positionSec: number, playing: boolean): void => {
    deps.markSuppressed();
    deps.sendCommand(buildCommand(video, positionSec, playing));
  };

  const readSnapshot = (mediaId: string) => () => {
    const video = deps.getVideo();
    if (!video || !isVideoTimelineReady(video)) return null;
    if (deps.readMediaId() !== mediaId) return null;
    return { currentTime: video.currentTime, paused: video.paused };
  };

  return {
    async apply(target: PlaybackApplyTarget): Promise<ApplyPlaybackResult> {
      if (target.serviceId !== 'netflix') return 'dropped';

      const { positionSec, playing } = target.playback;

      // Follow-the-leader: navigate instead of silently dropping
      // cross-episode commands. The queued target applies once the new
      // video node is ready (flushPending on loadedmetadata).
      if (deps.readMediaId() !== target.playback.mediaId) {
        pending = { mediaId: target.playback.mediaId, positionSec, playing };
        deps.markSuppressed();
        deps.navigateToMedia(target.playback.mediaId);
        return 'deferred';
      }

      const video = deps.getVideo();
      if (!video || !isVideoTimelineReady(video)) return 'dropped';

      sendFor(video, positionSec, playing);

      const applied = await waitForMatch(readSnapshot(target.playback.mediaId), target.playback, {
        attempts: 20,
        intervalMs: 75,
      });
      return applied ? 'applied' : 'dropped';
    },

    flushPending(): void {
      if (!pending) return;
      if (deps.readMediaId() !== pending.mediaId) return;

      const video = deps.getVideo();
      if (!video || !isVideoTimelineReady(video)) return;

      const { positionSec, playing } = pending;
      pending = null;
      sendFor(video, positionSec, playing);
    },
  };
}
