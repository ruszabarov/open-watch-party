import {
  NETFLIX_PLAYER_RESPONSE_SOURCE,
  parseNetflixRpcRequest,
  type NetflixPlayerCommand,
  type NetflixPlayerStatusResponse,
} from './player-rpc';
import type { NetflixPlayer } from './window';

export const NETFLIX_PLAYER_VIDEO_RECONCILE_DELAY_MS = 150;

type NetflixPlaybackVideo = Pick<HTMLVideoElement, 'paused' | 'pause' | 'play'>;

type NetflixPlayerCommandOptions = {
  getPlayer?: () => NetflixPlayer | null;
  getVideo?: () => NetflixPlaybackVideo | null;
  schedule?: (callback: () => void, delayMs: number) => void;
};

let commandGeneration = 0;

function getNetflixPlayer(): NetflixPlayer | null {
  try {
    const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
    const sessionId = videoPlayer?.getAllPlayerSessionIds?.()[0];
    return sessionId ? (videoPlayer?.getVideoPlayerBySessionId(sessionId) ?? null) : null;
  } catch {
    return null;
  }
}

function getVideo(): HTMLVideoElement | null {
  const scoped = document.querySelector<HTMLVideoElement>('[data-uia="video-canvas"] video');
  if (scoped) return scoped;
  return document.querySelector<HTMLVideoElement>('video');
}

function readTarget<T>(read: () => T | null): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

function applyViaApi(command: NetflixPlayerCommand, player: NetflixPlayer): boolean {
  try {
    if (command.positionMs !== undefined) {
      player.seek(command.positionMs);
    }

    if (command.playing) {
      const result = player.play();
      if (result instanceof Promise) {
        result.catch(() => undefined);
      }
    } else {
      player.pause();
    }

    return true;
  } catch {
    return false;
  }
}

// DOM writes are play/pause only. Never write currentTime on Netflix:
// it crashes the player ("Whoops! Something went wrong"). Seeks without
// a working Cadmium API are dropped rather than risk the error page.
function applyPlayingViaVideoElement(
  command: NetflixPlayerCommand,
  video: NetflixPlaybackVideo,
): void {
  try {
    if (command.playing && video.paused) {
      const result = video.play();
      if (result instanceof Promise) {
        result.catch(() => undefined);
      }
    } else if (!command.playing && !video.paused) {
      video.pause();
    }
  } catch {
    // Best effort; the Cadmium API is the authoritative path.
  }
}

function defaultSchedule(callback: () => void, delayMs: number): void {
  window.setTimeout(callback, delayMs);
}

// The Cadmium API is authoritative. The delayed video-element reconcile is a
// one-shot watchdog (not polling): it fixes the case where the API accepts
// the command but the <video> element lags behind and would otherwise report
// a stale paused state back. Stale generations are dropped so rapid
// play->pause sequences always settle on the latest command.
export function applyNetflixPlayerCommand(
  command: NetflixPlayerCommand,
  options: NetflixPlayerCommandOptions = {},
): void {
  const currentCommandGeneration = (commandGeneration += 1);
  const readPlayer = options.getPlayer ?? getNetflixPlayer;
  const readVideo = options.getVideo ?? getVideo;
  const player = readTarget(readPlayer);

  if (player && applyViaApi(command, player)) {
    const schedule = options.schedule ?? defaultSchedule;
    schedule(() => {
      if (currentCommandGeneration !== commandGeneration) return;

      const video = readTarget(readVideo);
      if (video) applyPlayingViaVideoElement(command, video);
    }, NETFLIX_PLAYER_VIDEO_RECONCILE_DELAY_MS);
    return;
  }

  const video = readTarget(readVideo);
  if (!video) return;

  applyPlayingViaVideoElement(command, video);
}

export function runNetflixPlayerContentScript(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.origin) {
      return;
    }

    const data = parseNetflixRpcRequest(event);
    if (data === null) {
      return;
    }

    if ('command' in data) {
      applyNetflixPlayerCommand(data.command);
      return;
    }

    window.postMessage(
      {
        source: NETFLIX_PLAYER_RESPONSE_SOURCE,
        requestId: data.requestId,
        hasPlayer: getNetflixPlayer() !== null || getVideo() !== null,
      } satisfies NetflixPlayerStatusResponse,
      '*',
    );
  });
}
