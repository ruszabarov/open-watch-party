import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { SUPPORTED_SERVICE_CONTENT_MATCHES } from '@open-watch-party/shared';

const LOCAL_PARTYKIT_HOST = 'localhost:1999';

// partysocket connects to a bare host, deriving ws/wss itself, so strip any
// protocol or trailing slash a deployment env var might include.
const defaultPartyKitHost = (process.env['SERVER_URL'] ?? LOCAL_PARTYKIT_HOST)
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');

const connectSrc = [
  "'self'",
  'http://localhost:1999',
  'ws://localhost:1999',
  'http://127.0.0.1:1999',
  'ws://127.0.0.1:1999',
  // WXT dev server (Vite HMR + extension reload). Harmless in production
  // builds since localhost isn't reachable from a packaged extension.
  'http://localhost:3000',
  'ws://localhost:3000',
  'https://*',
  'wss://*',
];

const hostPermissions = [...SUPPORTED_SERVICE_CONTENT_MATCHES];

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __DEFAULT_SERVER_URL__: JSON.stringify(defaultPartyKitHost),
    },
  }),
  manifest: {
    name: 'Open Watch Party',
    description: 'Free, open source, lightweight watch parties with realtime playback sync.',
    icons: {
      16: '/16.png',
      24: '/24.png',
      32: '/32.png',
      48: '/48.png',
      64: '/64.png',
      128: '/128.png',
    },
    permissions: ['storage', 'tabs'],
    browser_specific_settings: {
      gecko: {
        id: 'open-watch-party@ruszabarov.com',
        data_collection_permissions: {
          required: ['browsingActivity', 'websiteContent'],
        },
      },
    },
    host_permissions: hostPermissions,
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src ${connectSrc.join(' ')}`,
    },
    action: {
      default_title: 'Open Watch Party',
    },
  },
});
