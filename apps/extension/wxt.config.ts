import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { SUPPORTED_SERVICE_CONTENT_MATCHES } from '@open-watch-party/shared';

// `wrangler dev` serves the realtime backend on 8787.
const LOCAL_SERVER_HOST = 'localhost:8787';
const DEV_SERVER_ORIGINS = ['http://localhost:3000', 'ws://localhost:3000'];
const SERVER_HOST_PATTERN = /^[A-Za-z0-9.-]+(:\d+)?$/;
const LOOPBACK_HOST_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  hooks: {
    'build:before': (wxt) => {
      if (
        wxt.config.mode !== 'development' &&
        process.env['CI'] &&
        !process.env['SERVER_URL']?.trim()
      ) {
        throw new Error('SERVER_URL must be set when building the extension for release.');
      }
    },
  },
  zip: {
    // Firefox source review needs the whole pnpm workspace, not just the
    // extension directory, so the reviewer can install and rebuild it.
    sourcesRoot: '../..',
    excludeSources: ['apps/server/**', '.github/**', 'docs/**', 'scripts/**', 'tests/**'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __DEFAULT_SERVER_URL__: JSON.stringify(resolveServerHost()),
    },
  }),
  manifest: (env) => {
    const connectSrc = buildConnectSrc(resolveServerHost(), env.mode === 'development');

    return {
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
      permissions: ['storage', 'tabs', 'clipboardWrite'],
      browser_specific_settings: {
        gecko: {
          id: 'open-watch-party@ruszabarov.com',
          data_collection_permissions: {
            required: ['browsingActivity', 'websiteContent'],
          },
        },
      },
      host_permissions: [...SUPPORTED_SERVICE_CONTENT_MATCHES],
      content_security_policy: {
        extension_pages: `script-src 'self'; object-src 'self'; connect-src ${connectSrc.join(' ')}`,
      },
      action: {
        default_title: 'Open Watch Party',
      },
    };
  },
});

// partysocket takes a bare host and derives ws/wss itself, so strip any
// protocol or trailing slash and validate the remainder.
function resolveServerHost(): string {
  const raw = (process.env['SERVER_URL'] ?? '').trim();

  if (!raw) {
    return LOCAL_SERVER_HOST;
  }

  const host = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!SERVER_HOST_PATTERN.test(host)) {
    throw new Error(`SERVER_URL is not a valid host: ${raw}`);
  }
  return host;
}

function buildConnectSrc(host: string, isDevelopment: boolean): string[] {
  const isLoopback = LOOPBACK_HOST_PATTERN.test(host);
  const origins = [
    "'self'",
    `${isLoopback ? 'http' : 'https'}://${host}`,
    `${isLoopback ? 'ws' : 'wss'}://${host}`,
  ];

  if (isDevelopment) {
    origins.push(...DEV_SERVER_ORIGINS);
  }

  return origins;
}
