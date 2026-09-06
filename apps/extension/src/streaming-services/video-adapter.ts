import type { ApplyPlaybackResult, PlaybackApplyTarget } from '../messaging';

export type { ApplyPlaybackResult };

export const APPLY_SEEK_THRESHOLD_SEC = 1.5;

// Black box contract: the core sends a desired target and awaits the result.
// All service quirks (retries, internal player APIs, ads, navigation) live
// behind this interface — the core takes no further action on 'applied'.
export interface VideoAdapter {
  apply(target: PlaybackApplyTarget): Promise<ApplyPlaybackResult>;
}

export type AdapterVideoSnapshot = {
  currentTime: number;
  paused: boolean;
};

export function needsSeek(
  currentTime: number,
  positionSec: number,
  thresholdSec = APPLY_SEEK_THRESHOLD_SEC,
): boolean {
  return Math.abs(currentTime - positionSec) > thresholdSec;
}

export function matchesTarget(
  snapshot: AdapterVideoSnapshot,
  playback: PlaybackApplyTarget['playback'],
  thresholdSec = APPLY_SEEK_THRESHOLD_SEC,
): boolean {
  return (
    snapshot.paused === !playback.playing &&
    !needsSeek(snapshot.currentTime, playback.positionSec, thresholdSec)
  );
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
    // Best effort; the verification poll below decides the result.
  }
}

export async function waitForMatch(
  read: () => AdapterVideoSnapshot | null,
  playback: PlaybackApplyTarget['playback'],
  options?: { thresholdSec?: number; attempts?: number; intervalMs?: number },
): Promise<boolean> {
  const thresholdSec = options?.thresholdSec ?? APPLY_SEEK_THRESHOLD_SEC;
  const attempts = options?.attempts ?? 10;
  const intervalMs = options?.intervalMs ?? 50;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = read();
    if (snapshot && matchesTarget(snapshot, playback, thresholdSec)) {
      return true;
    }
    if (attempt < attempts - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return false;
}
