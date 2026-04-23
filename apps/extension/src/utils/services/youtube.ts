import {
  createDomVideoAdapter,
} from './dom-video';
import { createSelectorMediaLocator } from './media-locators';
import {
  createHtml5PlaybackController,
  type PlaybackController,
} from './playback-controllers';
import type { ServicePlugin } from './types';

const YOUTUBE_HOST_RE =
  /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/;
const YOUTUBE_TITLE_SUFFIX = /\s*-\s*YouTube$/i;

interface YouTubePlayerApi {
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
}

type YouTubePlayerElement = HTMLElement & YouTubePlayerApi;

function parseYoutube(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return YOUTUBE_HOST_RE.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function extractYoutubeMediaId(url: URL): string | undefined {
  const host = url.hostname;

  if (/(^|\.)youtube\.com$/.test(host)) {
    if (url.pathname === '/watch') {
      return url.searchParams.get('v') ?? undefined;
    }
    return (
      url.pathname.match(/^\/(?:embed|live)\/([^/?#]+)/)?.[1] ?? undefined
    );
  }

  if (/(^|\.)youtube-nocookie\.com$/.test(host)) {
    return url.pathname.match(/^\/embed\/([^/?#]+)/)?.[1] ?? undefined;
  }

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0];
    return id || undefined;
  }

  return undefined;
}

function isYouTubePlayerElement(
  value: Element | null,
): value is YouTubePlayerElement {
  const seekTo = value ? Reflect.get(value, 'seekTo') : undefined;
  const playVideo = value ? Reflect.get(value, 'playVideo') : undefined;
  const pauseVideo = value ? Reflect.get(value, 'pauseVideo') : undefined;

  if (
    !value ||
    !(value instanceof HTMLElement) ||
    typeof seekTo !== 'function' ||
    typeof playVideo !== 'function' ||
    typeof pauseVideo !== 'function'
  ) {
    return false;
  }

  return true;
}

function getYoutubePlayerApi(): YouTubePlayerElement | null {
  const player = document.getElementById('movie_player');
  return isYouTubePlayerElement(player) ? player : null;
}

const html5PlaybackController = createHtml5PlaybackController();

const youtubePlaybackController: PlaybackController = {
  async apply(params) {
    const player = getYoutubePlayerApi();
    if (!player) {
      return html5PlaybackController.apply(params);
    }

    player.seekTo(params.targetPositionSec, true);
    if (params.shouldPlay) {
      player.playVideo();
    } else {
      player.pauseVideo();
    }

    return { ok: true };
  },
};

export const YOUTUBE_SERVICE: ServicePlugin = {
  descriptor: {
    id: 'youtube',
    label: 'YouTube',
    accent: '#ff0033',
    accentContrast: '#ffffff',
    glyph: 'Y',
    watchPathHint: 'youtube.com/watch?v=…',
  },
  contentMatches: [
    '*://*.youtube.com/*',
    '*://youtu.be/*',
    '*://*.youtube-nocookie.com/*',
  ],
  matchesService: (url) => parseYoutube(url) !== null,
  matchesWatchPage: (url) => {
    const parsed = parseYoutube(url);
    return parsed ? extractYoutubeMediaId(parsed) !== undefined : false;
  },
  createAdapter: () =>
    createDomVideoAdapter({
      serviceId: 'youtube',
      locator: createSelectorMediaLocator({
        // YouTube keeps a hidden miniplayer <video> around; prefer the main
        // movie container before falling back to any <video>.
        videoSelector: '#movie_player video, video.html5-main-video, video',
        structureRootSelector: '#movie_player',
        getMediaId: (loc) => extractYoutubeMediaId(new URL(loc.href)),
        getMediaTitle: (doc) =>
          doc.title.replace(YOUTUBE_TITLE_SUFFIX, '').trim(),
      }),
      playbackController: youtubePlaybackController,
      issueWhenNoMedia: 'Open a youtube.com/watch?v=… page to start a party.',
      issueWhenPlayerNotReady: 'YouTube player is still loading.',
    }),
};
