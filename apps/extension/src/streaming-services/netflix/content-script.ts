import { SERVICE_BY_ID } from '@open-watch-party/shared';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import type { WatchReportReason } from '../../messaging';
import { runContentScript } from '../content-runner';
import { createNetflixAdapter } from './adapter';
import { NETFLIX_PLAYER_REQUEST_SOURCE, type NetflixRpcRequest } from './player-rpc';

const NETFLIX = SERVICE_BY_ID.netflix;

function sendPlayerCommand(command: NetflixRpcRequest['command']): void {
  window.postMessage(
    { source: NETFLIX_PLAYER_REQUEST_SOURCE, command } satisfies NetflixRpcRequest,
    '*',
  );
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

function findVideo(): HTMLVideoElement | null {
  const scoped = document.querySelector<HTMLVideoElement>('[data-uia="video-canvas"] video');
  return scoped ?? document.querySelector<HTMLVideoElement>('video');
}

export function runNetflixContentScript(ctx: ContentScriptContext): void {
  // URL is the episode identity; video.src is an opaque MSE blob URL.
  const readMediaId = (): string | null => NETFLIX.extractMediaId(new URL(location.href));

  runContentScript(ctx, {
    serviceId: 'netflix',
    findVideo,
    readMediaId,
    canReport: () => true,
    reasonForEvent: reasonForVideoEvent,
    createAdapter: (getVideo) =>
      createNetflixAdapter({ getVideo, readMediaId, sendCommand: sendPlayerCommand }),
  });
}
