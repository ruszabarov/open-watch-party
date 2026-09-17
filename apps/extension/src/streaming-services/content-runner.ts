import type { ServiceId } from '@open-watch-party/shared';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { onMessage, sendMessage, type WatchReport, type WatchReportReason } from '../messaging';
import { isVideoTimelineReady } from './playback-readiness';
import type { VideoAdapter } from './video-adapter';

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

export type ContentScriptApi = {
  report(reason?: WatchReportReason): void;
  getVideo(): HTMLVideoElement | null;
};

// Everything a service integration must provide. The runner owns video
// discovery, event binding, reporting, messaging, and cleanup so integrations
// only describe their own player.
export type ContentService = {
  readonly serviceId: ServiceId;
  findVideo(): HTMLVideoElement | null;
  readMediaId(): string | null;
  canReport(): boolean;
  reasonForEvent(eventType: string): WatchReportReason;
  createAdapter(getVideo: () => HTMLVideoElement | null): VideoAdapter;
  /** Optional one-time setup (extra observers, context listeners). */
  install?(ctx: ContentScriptContext, api: ContentScriptApi): void;
  /** Called whenever the active video element changes, including on unbind. */
  onVideoBound?(video: HTMLVideoElement | null, api: ContentScriptApi): void;
};

export function runContentScript(ctx: ContentScriptContext, service: ContentService): void {
  let activeVideo: HTMLVideoElement | null = null;
  let pendingFrame: number | null = null;
  // Media identity from the URL only becomes authoritative once the player has
  // reported readiness for that media. This prevents a transient SPA navigation
  // from pairing a new URL with the previous video's position.
  let boundMediaId: string | null = null;
  let playerReady = false;

  const api: ContentScriptApi = {
    report: (reason = 'snapshot') => {
      const report = readWatchReport(reason);
      if (report) void sendMessage('content:watch-report', report).catch(() => undefined);
    },
    getVideo: () => activeVideo,
  };

  function readWatchReport(reason: WatchReportReason): WatchReport | null {
    const mediaId = service.readMediaId();
    const video = activeVideo;
    if (
      mediaId === null ||
      mediaId !== boundMediaId ||
      !playerReady ||
      !isVideoTimelineReady(video) ||
      !service.canReport()
    ) {
      return null;
    }

    return {
      serviceId: service.serviceId,
      mediaId,
      title: document.title,
      positionSec: Number(video.currentTime.toFixed(3)),
      playing: !video.paused,
      reason,
    };
  }

  function onVideoEvent(event: Event): void {
    bindVideo();

    if (event.type === 'loadstart' || event.type === 'emptied') {
      playerReady = false;
      return;
    }
    if (event.type === 'loadedmetadata' || event.type === 'durationchange') {
      playerReady = true;
    }
    if (playerReady) boundMediaId = service.readMediaId();

    api.report(service.reasonForEvent(event.type));
  }

  function bindVideo(): void {
    const video = service.findVideo();
    if (video === activeVideo) return;

    if (activeVideo) {
      for (const event of VIDEO_EVENTS) activeVideo.removeEventListener(event, onVideoEvent);
      service.onVideoBound?.(null, api);
    }

    activeVideo = video;
    playerReady = isVideoTimelineReady(activeVideo);
    boundMediaId = playerReady ? service.readMediaId() : null;
    if (activeVideo) {
      for (const event of VIDEO_EVENTS) activeVideo.addEventListener(event, onVideoEvent);
    }
    service.onVideoBound?.(activeVideo, api);
  }

  function refresh(): void {
    const previous = activeVideo;
    bindVideo();
    if (activeVideo !== previous) api.report('snapshot');
  }

  function schedule(): void {
    if (pendingFrame !== null) return;
    pendingFrame = ctx.requestAnimationFrame(() => {
      pendingFrame = null;
      refresh();
    });
  }

  // The document is observed only to detect player replacement or readiness.
  // Unrelated DOM churn triggers a rebind check, not a report.
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  ctx.onInvalidated(() => observer.disconnect());

  const onLocationChange = (): void => {
    playerReady = false;
    schedule();
  };
  ctx.addEventListener(window, 'wxt:locationchange', onLocationChange);
  ctx.addEventListener(window, 'popstate', onLocationChange);

  ctx.onInvalidated(
    onMessage('party:request-watch-report', () => {
      bindVideo();
      return readWatchReport('snapshot');
    }),
  );

  const adapter = service.createAdapter(() => activeVideo);
  ctx.onInvalidated(onMessage('party:apply-playback-target', ({ data }) => adapter.apply(data)));

  service.install?.(ctx, api);

  // Video listeners are attached directly to the element, so they need explicit
  // removal when the content script context is invalidated.
  ctx.onInvalidated(() => {
    if (!activeVideo) return;

    for (const event of VIDEO_EVENTS) activeVideo.removeEventListener(event, onVideoEvent);
    service.onVideoBound?.(null, api);
    activeVideo = null;
  });

  refresh();
}
