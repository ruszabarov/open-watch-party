import type { PlaybackApplyTarget } from '../../messaging';
import { isVideoTimelineReady } from '../playback-readiness';
import { needsSeek, type VideoAdapter } from '../video-adapter';
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
    apply(target: PlaybackApplyTarget): void {
      if (target.serviceId !== 'netflix') return;

      // Cross-episode navigation is owned by the background, which reads the
      // room's canonical URL. The adapter only controls the loaded player.
      const video = deps.getVideo();
      if (!video || !isVideoTimelineReady(video)) return;
      if (deps.readMediaId() !== target.playback.mediaId) return;

      const { positionSec, playing } = target.playback;
      deps.sendCommand(buildCommand(video, positionSec, playing));
    },
  };
}
