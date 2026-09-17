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

export function createNetflixAdapter(deps: NetflixAdapterDeps): VideoAdapter {
  return {
    async apply(target: PlaybackApplyTarget): Promise<ApplyPlaybackResult> {
      if (target.serviceId !== 'netflix') return 'dropped';

      // Cross-episode navigation is owned by the background, which reads the
      // room's canonical URL. The adapter only controls the loaded player.
      const video = deps.getVideo();
      if (!video || !isVideoTimelineReady(video)) return 'dropped';
      if (deps.readMediaId() !== target.playback.mediaId) return 'dropped';

      const { positionSec, playing } = target.playback;
      deps.sendCommand(buildCommand(video, positionSec, playing));

      const applied = await waitForMatch(
        () => {
          const current = deps.getVideo();
          if (!current || !isVideoTimelineReady(current)) return null;
          if (deps.readMediaId() !== target.playback.mediaId) return null;
          return { currentTime: current.currentTime, paused: current.paused };
        },
        target.playback,
        { attempts: 20, intervalMs: 75 },
      );
      return applied ? 'applied' : 'dropped';
    },
  };
}
