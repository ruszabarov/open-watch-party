import type { PlaybackApplyTarget } from '../../messaging';
import { isVideoTimelineReady } from '../playback-readiness';
import { needsSeek, setVideoPlaying, type VideoAdapter } from '../video-adapter';

export type YoutubeAdapterDeps = {
  getVideo: () => HTMLVideoElement | null;
  readMediaId: () => string | null;
  isAdShowing: () => boolean;
};

export function createYoutubeAdapter(deps: YoutubeAdapterDeps): VideoAdapter {
  return {
    apply(target: PlaybackApplyTarget): void {
      if (target.serviceId !== 'youtube') return;
      if (deps.isAdShowing()) return;

      const video = deps.getVideo();
      if (!video || !isVideoTimelineReady(video)) return;
      if (deps.readMediaId() !== target.playback.mediaId) return;

      const { positionSec, playing } = target.playback;
      try {
        if (needsSeek(video.currentTime, positionSec)) {
          video.currentTime = positionSec;
        }
      } catch {
        return;
      }
      setVideoPlaying(video, playing);
    },
  };
}
