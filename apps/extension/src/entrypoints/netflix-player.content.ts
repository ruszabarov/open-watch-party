import { defineContentScript } from 'wxt/utils/define-content-script';

import {
  NETFLIX_PLAYER_REQUEST_EVENT,
  NETFLIX_PLAYER_RESPONSE_EVENT,
  parseNetflixPlayerCommandDetail,
  serializeNetflixPlayerResponse,
  type NetflixPlayerCommand,
  type NetflixPlayerResponse,
} from '../utils/services/netflix-player-bridge';

type NetflixPlayer = {
  seek(positionMs: number): void;
  play(): void;
  pause(): void;
};

type NetflixVideoPlayerApi = {
  getAllPlayerSessionIds(): string[];
  getVideoPlayerBySessionId(sessionId: string): NetflixPlayer | null | undefined;
};

declare global {
  interface Window {
    netflix?: {
      appContext?: {
        state?: {
          playerApp?: {
            getAPI?(): {
              videoPlayer?: NetflixVideoPlayerApi;
            };
          };
        };
      };
    };
  }
}

function getNetflixPlayer(): NetflixPlayer | null {
  const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
  const sessionId = videoPlayer?.getAllPlayerSessionIds?.()[0];
  return sessionId ? (videoPlayer?.getVideoPlayerBySessionId(sessionId) ?? null) : null;
}

function sendResponse(response: NetflixPlayerResponse): void {
  window.dispatchEvent(
    new CustomEvent<string>(NETFLIX_PLAYER_RESPONSE_EVENT, {
      detail: serializeNetflixPlayerResponse(response),
    }),
  );
}

function applyCommand(command: NetflixPlayerCommand): NetflixPlayerResponse {
  try {
    const player = getNetflixPlayer();
    if (!player) {
      return {
        id: command.id,
        applied: false,
        reason: 'Netflix player API is not ready yet.',
      };
    }

    if (command.positionMs !== undefined) {
      player.seek(command.positionMs);
    }

    if (command.playing) {
      player.play();
    } else {
      player.pause();
    }

    return { id: command.id, applied: true };
  } catch {
    return {
      id: command.id,
      applied: false,
      reason: 'Netflix player API rejected the sync command.',
    };
  }
}

export default defineContentScript({
  matches: ['*://*.netflix.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    window.addEventListener(NETFLIX_PLAYER_REQUEST_EVENT, (event) => {
      const command = parseNetflixPlayerCommandDetail(event.detail);
      if (!command.success) {
        return;
      }

      sendResponse(applyCommand(command.data));
    });
  },
});
