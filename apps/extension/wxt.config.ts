import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
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
