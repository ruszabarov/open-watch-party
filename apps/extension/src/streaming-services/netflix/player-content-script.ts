import {
  NETFLIX_PLAYER_RESPONSE_SOURCE,
  parseNetflixRpcRequest,
  type NetflixPlayerCommand,
  type NetflixPlayerStatusResponse,
} from './player-rpc';
import type { NetflixPlayer } from './window';

export const NETFLIX_PLAYER_VIDEO_RECONCILE_DELAY_MS = 150;

type NetflixPlaybackVideo = Pick<HTMLVideoElement, 'currentTime' | 'paused' | 'pause' | 'play'>;

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
      player.play();
    } else {
      player.pause();
    }

    return true;
  } catch {
    return false;
  }
}

function applySeekViaVideoElement(
  command: NetflixPlayerCommand,
  video: NetflixPlaybackVideo,
): void {
  if (command.positionMs === undefined) return;

  const positionSec = command.positionMs / 1000;
  if (!Number.isFinite(positionSec)) return;

  try {
    video.currentTime = positionSec;
  } catch {
    // Netflix may reject direct timeline writes; this is only a fallback.
  }
}

function applyPlaybackViaVideoElement(
  command: NetflixPlayerCommand,
  video: NetflixPlaybackVideo,
): void {
  if (command.playing && video.paused) {
    try {
      void video.play().catch(() => undefined);
    } catch {
      // Best effort; Netflix's internal player is the authoritative path.
    }
  } else if (!command.playing && !video.paused) {
    try {
      video.pause();
    } catch {
      // Best effort.
    }
  }
}

function applyViaVideoElement(command: NetflixPlayerCommand, video: NetflixPlaybackVideo): void {
  applySeekViaVideoElement(command, video);
  applyPlaybackViaVideoElement(command, video);
}

function defaultSchedule(callback: () => void, delayMs: number): void {
  window.setTimeout(callback, delayMs);
}

// Netflix's player API is authoritative for sync, but a delayed video-element
// reconcile keeps the page controls from getting stuck if the API lags behind.
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
      if (video) applyPlaybackViaVideoElement(command, video);
    }, NETFLIX_PLAYER_VIDEO_RECONCILE_DELAY_MS);
    return;
  }

  const video = readTarget(readVideo);
  if (!video) return;

  applyViaVideoElement(command, video);
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
