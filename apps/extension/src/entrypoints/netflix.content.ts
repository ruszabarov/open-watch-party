import type { BackgroundToContentMessage } from '../lib/protocol/extension';

import { createNetflixAdapter } from '../lib/services/netflix';

const adapter = createNetflixAdapter();

export default defineContentScript({
  matches: ['*://*.netflix.com/*'],
  main() {
    const stopObserving = adapter.observe(
      (context) => {
        void browser.runtime.sendMessage({
          type: 'content:context',
          payload: context,
        });
      },
      (update) => {
        void browser.runtime.sendMessage({
          type: 'content:playback-update',
          payload: update,
        });
      },
    );

    void browser.runtime.sendMessage({ type: 'content:request-sync' });

    const handleRuntimeMessage = (message: BackgroundToContentMessage) => {
      if (message.type === 'party:request-context') {
        return Promise.resolve(adapter.getContext());
      }

      if (message.type === 'party:apply-snapshot') {
        return adapter.applySnapshot(message.payload.snapshot);
      }

      return undefined;
    };

    browser.runtime.onMessage.addListener(handleRuntimeMessage);

    const handleBeforeUnload = () => {
      stopObserving();
      browser.runtime.onMessage.removeListener(handleRuntimeMessage);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
  },
});
