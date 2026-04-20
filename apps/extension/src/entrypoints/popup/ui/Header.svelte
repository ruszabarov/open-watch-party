<script lang="ts">
  import type { ConnectionStatus } from '@watch-party/shared';
  import ConnectionDot from './ConnectionDot.svelte';

  interface Props {
    status: ConnectionStatus;
    settingsOpen: boolean;
    onToggleSettings: () => void;
  }

  const { status, settingsOpen, onToggleSettings }: Props = $props();
  const settingsLabel = $derived(settingsOpen ? 'Close settings' : 'Open settings');
  const settingsCopy = $derived(settingsOpen ? 'Close' : 'Settings');
</script>

<header class="header">
  <div class="brand">
    <span class="brand__mark" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M3 2.5L3 11.5M11 2.5L11 11.5M3 7H11"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
        />
      </svg>
    </span>
    <span class="brand__name">Watch Party</span>
  </div>

  <div class="controls">
    <button
      class="btn btn-ghost header__settings"
      type="button"
      aria-label={settingsLabel}
      aria-pressed={settingsOpen}
      onclickcapture={onToggleSettings}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 10a2 2 0 100-4 2 2 0 000 4z"
          stroke="currentColor"
          stroke-width="1.4"
        />
        <path
          d="M12.7 9.6l1.1.9-1.2 2-1.3-.4c-.3.2-.7.4-1 .5l-.3 1.4H7l-.3-1.4c-.3-.1-.7-.3-1-.5l-1.3.4-1.2-2 1.1-.9c-.1-.4-.1-.8 0-1.2L3.2 7.1l1.2-2 1.3.4c.3-.2.7-.4 1-.5L7 3.6h2l.3 1.4c.3.1.7.3 1 .5l1.3-.4 1.2 2-1.1.9c.1.4.1.8 0 1.2z"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
      </svg>
      <span>{settingsCopy}</span>
    </button>
    <ConnectionDot {status} />
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-0);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .brand__mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 7px;
    background: var(--primary);
    color: var(--primary-contrast);
  }

  .brand__name {
    font-size: 0.9rem;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .header__settings {
    height: 32px;
    padding: 0 10px;
    gap: 6px;
    font-size: 0.78rem;
    border-radius: 999px;
  }
</style>
