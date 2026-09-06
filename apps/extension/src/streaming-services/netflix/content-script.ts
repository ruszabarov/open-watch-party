import { SERVICE_BY_ID } from '@open-watch-party/shared';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { onMessage, sendMessage, type WatchReport, type WatchReportReason } from '../../messaging';
import {
  NETFLIX_PLAYER_REQUEST_SOURCE,
  type NetflixPlayerCommand,
  type NetflixRpcRequest,
} from './player-rpc';
import { isVideoTimelineReady } from '../playback-readiness';

const NETFLIX = SERVICE_BY_ID.netflix;
const VIDEO_EVENTS = [
  'play',
  'pause',
  'seeking',
  'seeked',
  'emptied',
  'loadstart',
  'loadedmetadata',
  'durationchange',
  'ended',
  'error',
] as const;
const SEEK_THRESHOLD_SEC = 1.5;
const ECHO_SUPPRESSION_MS = 500;

type PendingEpisodeTarget = {
  mediaId: string;
  positionSec: number;
  playing: boolean;
};

function getVideo(): HTMLVideoElement | null {
  const scoped = document.querySelector<HTMLVideoElement>('[data-uia="video-canvas"] video');
  if (scoped) return scoped;
  return document.querySelector<HTMLVideoElement>('video');
}

function sendPlayerCommand(command: NetflixPlayerCommand): void {
  window.postMessage(
    { source: NETFLIX_PLAYER_REQUEST_SOURCE, command } satisfies NetflixRpcRequest,
    '*',
  );
}

function sendReport(report: WatchReport): void {
  void sendMessage('content:watch-report', report).catch(() => undefined);
}

function reasonForVideoEvent(type: string): WatchReportReason {
  switch (type) {
    case 'play':
      return 'play';
    case 'pause':
      return 'pause';
    case 'seeking':
    case 'seeked':
      return 'seek';
    default:
      return 'snapshot';
  }
}

export function runNetflixContentScript(ctx: ContentScriptContext): void {
  let activeVideo: HTMLVideoElement | null = null;
  let pendingFrame: number | null = null;
  let suppressUntilMs = 0;
  let pendingEpisode: PendingEpisodeTarget | null = null;

  const readMediaId = (): string | null => NETFLIX.extractMediaId(new URL(location.href));

  const readWatchReport = (reason: WatchReportReason = 'snapshot'): WatchReport | null => {
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
      reason,
    };
  };

  const buildCommand = (positionSec: number, playing: boolean): NetflixPlayerCommand =>
    activeVideo && Math.abs(activeVideo.currentTime - positionSec) > SEEK_THRESHOLD_SEC
      ? { playing, positionMs: Math.round(positionSec * 1000) }
      : { playing };

  const flushPendingEpisode = () => {
    if (!pendingEpisode || !activeVideo) return;
    if (readMediaId() !== pendingEpisode.mediaId) return;
    if (!isVideoTimelineReady(activeVideo)) return;

    const { positionSec, playing } = pendingEpisode;
    pendingEpisode = null;
    suppressUntilMs = Date.now() + ECHO_SUPPRESSION_MS;
    sendPlayerCommand(buildCommand(positionSec, playing));
  };

  const sendPlaybackReport = (reason: WatchReportReason = 'snapshot') => {
    // Own corrections re-emit video events; downgrade them so the follower
    // doesn't broadcast back and fight the leader.
    if (reason !== 'snapshot' && Date.now() < suppressUntilMs) {
      reason = 'snapshot';
    }

    const report = readWatchReport(reason);
    if (report) sendReport(report);
  };

  const bindVideo = () => {
    const video = getVideo();
    if (video === activeVideo) return;

    if (activeVideo) {
      for (const e of VIDEO_EVENTS) activeVideo.removeEventListener(e, onVideoEvent);
    }
    activeVideo = video;
    if (activeVideo) {
      for (const e of VIDEO_EVENTS) activeVideo.addEventListener(e, onVideoEvent);
    }
  };

  function refresh(reason: WatchReportReason = 'snapshot') {
    bindVideo();
    flushPendingEpisode();
    sendPlaybackReport(reason);
  }

  const onVideoEvent = (event: Event) => {
    bindVideo();
    flushPendingEpisode();
    sendPlaybackReport(reasonForVideoEvent(event.type));
  };

  const scheduleRefresh = () => {
    if (pendingFrame !== null) return;
    pendingFrame = ctx.requestAnimationFrame(() => {
      pendingFrame = null;
      refresh();
    });
  };

  // URL is the episode identity (video.src is an opaque MSE blob URL).
  // Location changes fire synchronously on SPA navigation, well before the
  // new video node exists; the pending target applies on loadedmetadata.
  const onLocationChange = () => {
    scheduleRefresh();
  };

  const pageObserver = new MutationObserver(scheduleRefresh);
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  ctx.onInvalidated(() => pageObserver.disconnect());

  ctx.addEventListener(window, 'wxt:locationchange', onLocationChange);
  ctx.addEventListener(window, 'popstate', onLocationChange);

  ctx.onInvalidated(
    onMessage('party:request-watch-report', () => {
      bindVideo();
      return readWatchReport();
    }),
  );

  ctx.onInvalidated(
    onMessage('party:apply-playback-target', ({ data }) => {
      if (data.serviceId !== 'netflix') return;

      const mediaId = readMediaId();
      const { positionSec, playing } = data.playback;

      // Follow-the-leader: navigate instead of silently dropping
      // cross-episode commands. The queued target applies once the new
      // video node is ready (flushPendingEpisode on loadedmetadata).
      if (mediaId === null || mediaId !== data.playback.mediaId) {
        pendingEpisode = {
          mediaId: data.playback.mediaId,
          positionSec,
          playing,
        };
        suppressUntilMs = Date.now() + ECHO_SUPPRESSION_MS;
        location.href = NETFLIX.buildCanonicalWatchUrl(data.playback.mediaId);
        return;
      }

      if (!activeVideo) return;

      suppressUntilMs = Date.now() + ECHO_SUPPRESSION_MS;
      sendPlayerCommand(buildCommand(positionSec, playing));
    }),
  );

  refresh();
}
