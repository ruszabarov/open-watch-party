import { SERVICE_BY_ID } from '@open-watch-party/shared';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { runNetflixContentScript } from '../streaming-services/netflix/content-script';

export default defineContentScript({
  matches: [...SERVICE_BY_ID.netflix.contentMatches],
  main: runNetflixContentScript,
});
