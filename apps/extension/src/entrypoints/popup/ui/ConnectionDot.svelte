<script lang="ts">
  import type { ConnectionStatus } from '@watch-party/shared';

  interface Props {
    status: ConnectionStatus;
  }

  const { status }: Props = $props();

  const labels: Record<ConnectionStatus, string> = {
    disconnected: 'Offline',
    connecting: 'Connecting',
    connected: 'Online',
    reconnecting: 'Reconnecting',
    error: 'Connection error',
  };
</script>

<span class="dot dot--{status}" title={labels[status]} aria-label={labels[status]}></span>

<style>
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    background: var(--text-subtle);
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
    color: var(--text-subtle);
    transition: background-color 180ms var(--ease), color 180ms var(--ease);
  }

  .dot--connected {
    background: var(--success);
    color: var(--success);
  }

  .dot--connecting,
  .dot--reconnecting {
    background: var(--warning);
    color: var(--warning);
    animation: pulse 1.4s var(--ease) infinite;
  }

  .dot--error {
    background: var(--danger);
    color: var(--danger);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
