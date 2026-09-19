import { SERVICE_BY_ID } from '@open-watch-party/shared';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import type { WatchReportReason } from '../../messaging';
import { runContentScript } from '../content-runner';
import { createYoutubeAdapter } from './adapter';
import { isYoutubeAdPlayback } from './ads';

const YOUTUBE = SERVICE_BY_ID.youtube;

function findPlayer(video: HTMLVideoElement | null): Element | null {
  return video?.closest('#movie_player') ?? document.querySelector('#movie_player');
}

function reasonForVideoEvent(type: string): WatchReportReason {
  switch (type) {
    case 'play':
      return 'play';
    case 'pause':
      return 'pause';
    case 'seeked':
      return 'seek';
    default:
      return 'snapshot';
  }
}

export function runYoutubeContentScript(ctx: ContentScriptContext): void {
  let currentPlayer: Element | null = null;
  let playerObserver: MutationObserver | null = null;

  const readMediaId = (): string | null => YOUTUBE.extractMediaId(new URL(location.href));
  const isAdShowing = (): boolean => isYoutubeAdPlayback(currentPlayer?.getAttribute('class'));

  runContentScript(ctx, {
    serviceId: 'youtube',
    findVideo: () =>
      document.querySelector<HTMLVideoElement>(
        '#movie_player video, video.html5-main-video, video',
      ),
    readMediaId,
    canReport: () => !isAdShowing(),
    reasonForEvent: reasonForVideoEvent,
    createAdapter: (getVideo) => createYoutubeAdapter({ getVideo, readMediaId, isAdShowing }),
    onVideoBound: (video, api) => {
      const player = findPlayer(video);
      if (player === currentPlayer) return;

      currentPlayer = player;
      playerObserver?.disconnect();
      playerObserver = null;
      if (!player) return;

      // Ad state lives on the player's class attribute. When the ad ends, send
      // a snapshot so the engine can correct the position YouTube suppressed.
      let wasAdShowing = isAdShowing();
      playerObserver = new MutationObserver(() => {
        const adShowing = isAdShowing();
        if (wasAdShowing && !adShowing) api.report('snapshot');
        wasAdShowing = adShowing;
      });
      playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    },
    install: (installCtx) => {
      installCtx.onInvalidated(() => playerObserver?.disconnect());
    },
  });
}
