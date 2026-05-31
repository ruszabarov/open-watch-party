import type { ServiceDefinition } from '../streaming-services';

const NETFLIX_HOST_RE = /(^|\.)netflix\.com$/;
const NETFLIX_MEDIA_ID_RE = /^[0-9]+$/;

function extractNetflixMediaId(url: URL): string | null {
  return url.pathname.match(/^\/watch\/(\d+)\/?$/)?.[1] ?? null;
}

export const NETFLIX_SERVICE = {
  descriptor: {
    label: 'Netflix',
    accent: '#e50914',
    accentContrast: '#ffffff',
    glyph: 'N',
  },
  contentMatches: ['*://*.netflix.com/*'],
  matchesUrl: (url: URL) => NETFLIX_HOST_RE.test(url.hostname),
  extractMediaId: extractNetflixMediaId,
  isMediaIdValid: (mediaId: string) => NETFLIX_MEDIA_ID_RE.test(mediaId),
  buildCanonicalWatchUrl: (mediaId: string) => `https://www.netflix.com/watch/${mediaId}`,
} satisfies ServiceDefinition;
