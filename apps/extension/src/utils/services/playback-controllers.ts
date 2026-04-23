import type { ServiceContentContext } from '../protocol/extension';

const SEEK_CORRECTION_THRESHOLD_SEC = 1.5;

export interface PlaybackApplyParams {
  readonly video: HTMLVideoElement;
  readonly targetPositionSec: number;
  readonly shouldPlay: boolean;
  readonly context: ServiceContentContext;
}

export type PlaybackApplyResult = { ok: true } | { ok: false; reason: string };

export interface PlaybackController {
  apply(params: PlaybackApplyParams): Promise<PlaybackApplyResult>;
}

function syncVideoPosition(video: HTMLVideoElement, targetPositionSec: number): void {
  if (Math.abs(video.currentTime - targetPositionSec) > SEEK_CORRECTION_THRESHOLD_SEC) {
    video.currentTime = targetPositionSec;
  }
}

async function syncVideoPlaybackState(
  video: HTMLVideoElement,
  shouldPlay: boolean,
): Promise<PlaybackApplyResult> {
  if (shouldPlay && video.paused) {
    try {
      await video.play();
    } catch {
      return {
        ok: false,
        reason: 'Browser blocked playback start on this tab.',
      };
    }
  }

  if (!shouldPlay && !video.paused) {
    video.pause();
  }

  return { ok: true };
}

export function createHtml5PlaybackController(): PlaybackController {
  return {
    async apply({ video, targetPositionSec, shouldPlay }) {
      syncVideoPosition(video, targetPositionSec);
      return syncVideoPlaybackState(video, shouldPlay);
    },
  };
}
