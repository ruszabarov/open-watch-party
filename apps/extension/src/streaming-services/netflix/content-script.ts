import { SERVICE_BY_ID } from '@open-watch-party/shared';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { onMessage, sendMessage, type WatchReport } from '../../messaging';
import {
  NETFLIX_PLAYER_REQUEST_SOURCE,
  NETFLIX_PLAYER_RESPONSE_SOURCE,
  type NetflixPlayerCommand,
  type NetflixPlayerStatusResponse,
  type NetflixRpcRequest,
} from './player-rpc';
import { isVideoTimelineReady } from '../playback-readiness';

const NETFLIX = SERVICE_BY_ID.netflix;
const VIDEO_EVENTS = [
  'play',
  'pause',
  'seeked',
  'loadedmetadata',
  'durationchange',
  'ended',
] as const;
const SEEK_THRESHOLD_SEC = 1.5;
const PLAYER_STATUS_TIMEOUT_MS = 250;

function sendPlayerCommand(command: NetflixPlayerCommand): void {
  window.postMessage(
    { source: NETFLIX_PLAYER_REQUEST_SOURCE, command } satisfies NetflixRpcRequest,
    '*',
  );
}

function sendReport(report: WatchReport): void {
  void sendMessage('content:watch-report', report).catch(() => undefined);
}

export function runNetflixContentScript(ctx: ContentScriptContext): void {
  let activeVideo: HTMLVideoElement | null = null;
  let pendingFrame: number | null = null;

  const readMediaId = (): string | null => {
    const mediaId = NETFLIX.extractMediaId(new URL(location.href));
    if (!activeVideo || mediaId === null) return null;

    return mediaId;
  };

  const readWatchReport = (): WatchReport | null => {
    const mediaId = readMediaId();
    if (mediaId === null || !isVideoTimelineReady(activeVideo)) {
      return null;
    }

    return {
      serviceId: 'netflix',
      mediaId,
      title: document.title,
      positionSec: Number(activeVideo.currentTime.toFixed(3)),
      playing: !activeVideo.paused,
    };
  };

  const requestPlayerStatus = (): Promise<boolean | null> => {
    const requestId = crypto.randomUUID();

    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onResponse);
        resolve(null);
      }, PLAYER_STATUS_TIMEOUT_MS);

      const onResponse = (event: MessageEvent) => {
        if (event.source !== window) return;

        const data = event.data as Partial<NetflixPlayerStatusResponse> | null;
        if (
          data?.source !== NETFLIX_PLAYER_RESPONSE_SOURCE ||
          data.requestId !== requestId ||
          typeof data.hasPlayer !== 'boolean'
        ) {
          return;
        }

        window.clearTimeout(timeout);
        window.removeEventListener('message', onResponse);
        resolve(data.hasPlayer);
      };

      window.addEventListener('message', onResponse);
      window.postMessage(
        {
          source: NETFLIX_PLAYER_REQUEST_SOURCE,
          requestId,
          query: 'status',
        } satisfies NetflixRpcRequest,
        '*',
      );
    });
  };

  const sendPlaybackReport = () => {
    void requestPlayerStatus().then((hasPlayer) => {
      if (hasPlayer === false) return;

      const report = readWatchReport();
      if (report) sendReport(report);
    });
  };

  const onVideoEvent = () => {
    refresh();
  };

  function refresh() {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (video !== activeVideo) {
      if (activeVideo) {
        for (const e of VIDEO_EVENTS) activeVideo.removeEventListener(e, onVideoEvent);
      }
      activeVideo = video;
      if (activeVideo) {
        for (const e of VIDEO_EVENTS) activeVideo.addEventListener(e, onVideoEvent);
      }
    }
    sendPlaybackReport();
  }

  const scheduleRefresh = () => {
    if (pendingFrame !== null) return;
    pendingFrame = ctx.requestAnimationFrame(() => {
      pendingFrame = null;
      refresh();
    });
  };

  const pageObserver = new MutationObserver(scheduleRefresh);
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  ctx.onInvalidated(() => pageObserver.disconnect());

  ctx.addEventListener(window, 'wxt:locationchange', scheduleRefresh);

  ctx.onInvalidated(
    onMessage('party:request-watch-report', () => {
      refresh();
      return readWatchReport();
    }),
  );

  ctx.onInvalidated(
    onMessage('party:apply-playback-target', ({ data }) => {
      if (data.serviceId !== 'netflix') return;

      const mediaId = readMediaId();
      if (!activeVideo || mediaId === null || mediaId !== data.playback.mediaId) return;

      const { positionSec, playing } = data.playback;
      const command: NetflixPlayerCommand =
        Math.abs(activeVideo.currentTime - positionSec) > SEEK_THRESHOLD_SEC
          ? { playing, positionMs: Math.round(positionSec * 1000) }
          : { playing };

      sendPlayerCommand(command);
    }),
  );

  refresh();
}
