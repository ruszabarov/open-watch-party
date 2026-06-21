import {
  NETFLIX_PLAYER_REQUEST_SOURCE,
  NETFLIX_PLAYER_RESPONSE_SOURCE,
  type NetflixPlayerCommand,
  type NetflixRpcRequest,
  type NetflixPlayerStatusResponse,
} from './player-rpc';
import type { NetflixPlayer } from './window';

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

// Seeks go through Netflix's internal player (a raw currentTime write gets
// reverted by its ABR pipeline). Play/pause go through the <video> element so
// Netflix's own UI controller stays in sync and its controls keep responding.
function applyCommand(command: NetflixPlayerCommand): void {
  const video = getVideo();
  if (!video) return;

  if (command.positionMs !== undefined) {
    try {
      getNetflixPlayer()?.seek(command.positionMs);
    } catch {
      // Internal player unavailable; leave the position untouched.
    }
  }

  if (command.playing && video.paused) {
    void video.play().catch(() => {});
  } else if (!command.playing && !video.paused) {
    video.pause();
  }
}

export function runNetflixPlayerContentScript(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.origin) {
      return;
    }

    const data = event.data as Partial<NetflixRpcRequest> | null;
    if (data?.source !== NETFLIX_PLAYER_REQUEST_SOURCE) {
      return;
    }

    if ('command' in data && data.command) {
      applyCommand(data.command);
      return;
    }

    if ('query' in data && data.query === 'status' && typeof data.requestId === 'string') {
      window.postMessage(
        {
          source: NETFLIX_PLAYER_RESPONSE_SOURCE,
          requestId: data.requestId,
          hasPlayer: getNetflixPlayer() !== null || getVideo() !== null,
        } satisfies NetflixPlayerStatusResponse,
        '*',
      );
    }
  });
}
