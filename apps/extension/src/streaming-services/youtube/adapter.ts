import type { PlaybackApplyTarget } from '../../messaging';
import { isVideoTimelineReady } from '../playback-readiness';
import {
  needsSeek,
  setVideoPlaying,
  waitForMatch,
  type ApplyPlaybackResult,
  type VideoAdapter,
} from '../video-adapter';

export type YoutubeAdapterDeps = {
  getVideo: () => HTMLVideoElement | null;
  readMediaId: () => string | null;
  isAdShowing: () => boolean;
};

export function createYoutubeAdapter(deps: YoutubeAdapterDeps): VideoAdapter {
  return {
    async apply(target: PlaybackApplyTarget): Promise<ApplyPlaybackResult> {
      if (target.serviceId !== 'youtube') return 'dropped';
      if (deps.isAdShowing()) return 'dropped';

      const video = deps.getVideo();
      if (!video || !isVideoTimelineReady(video)) return 'dropped';
      if (deps.readMediaId() !== target.playback.mediaId) return 'dropped';

      const { positionSec, playing } = target.playback;
      try {
        if (needsSeek(video.currentTime, positionSec)) {
          video.currentTime = positionSec;
        }
      } catch {
        return 'dropped';
      }
      setVideoPlaying(video, playing);

      const applied = await waitForMatch(
        () => {
          const current = deps.getVideo();
          if (!current || !isVideoTimelineReady(current)) return null;
          if (deps.readMediaId() !== target.playback.mediaId) return null;
          return { currentTime: current.currentTime, paused: current.paused };
        },
        target.playback,
        { attempts: 12, intervalMs: 50 },
      );
      return applied ? 'applied' : 'dropped';
    },
  };
}
