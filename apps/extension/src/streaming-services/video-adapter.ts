import { PLAYBACK_POSITION_TOLERANCE_SEC } from '@open-watch-party/shared';

import type { PlaybackApplyTarget } from '../messaging';

export const APPLY_SEEK_THRESHOLD_SEC = PLAYBACK_POSITION_TOLERANCE_SEC;

// Black box contract: the core sends a desired target. All service quirks
// (retries, internal player APIs, ads, navigation) live behind this interface;
// the background's verification timer reissues the target on drift.
export interface VideoAdapter {
  apply(target: PlaybackApplyTarget): void;
}

export function needsSeek(
  currentTime: number,
  positionSec: number,
  thresholdSec = APPLY_SEEK_THRESHOLD_SEC,
): boolean {
  return Math.abs(currentTime - positionSec) > thresholdSec;
}

type PlaybackVideoControl = Pick<HTMLVideoElement, 'paused' | 'play' | 'pause'>;

export function setVideoPlaying(video: PlaybackVideoControl, playing: boolean): void {
  try {
    if (playing && video.paused) {
      const result = video.play();
      if (result instanceof Promise) {
        result.catch(() => undefined);
      }
    } else if (!playing && !video.paused) {
      video.pause();
    }
  } catch {
    // Best effort; the background's verification timer decides the result.
  }
}
