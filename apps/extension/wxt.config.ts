import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

const LOCAL_SERVER_URL = 'http://localhost:8787';
const defaultServerUrl = process.env.WATCH_PARTY_SERVER_URL ?? LOCAL_SERVER_URL;
const showServerSettings = process.env.WATCH_PARTY_SHOW_SERVER_SETTINGS === 'true';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __WATCH_PARTY_DEFAULT_SERVER_URL__: JSON.stringify(defaultServerUrl),
      __WATCH_PARTY_SHOW_SERVER_SETTINGS__: JSON.stringify(showServerSettings),
    },
  }),
  manifest: {
    name: 'Watch Party',
    description: 'Cross-platform Netflix watch parties with realtime sync.',
    permissions: ['storage', 'tabs'],
    host_permissions: ['*://*.netflix.com/*'],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src 'self' http://localhost:8787 ws://localhost:8787 http://127.0.0.1:8787 ws://127.0.0.1:8787 https://* wss://*",
    },
    action: {
      default_title: 'Watch Party',
    },
  },
});
