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

  const toneClasses: Record<ConnectionStatus, string> = {
    disconnected: 'bg-[var(--text-subtle)] text-[var(--text-subtle)]',
    connecting: 'animate-pulse bg-[var(--warning)] text-[var(--warning)]',
    connected: 'bg-[var(--success)] text-[var(--success)]',
    reconnecting: 'animate-pulse bg-[var(--warning)] text-[var(--warning)]',
    error: 'bg-[var(--danger)] text-[var(--danger)]',
  };
</script>

<span
  class={`inline-block h-2 w-2 rounded-full shadow-[0_0_0_3px_color-mix(in_srgb,currentColor_12%,transparent)] transition-colors duration-150 ease-[var(--ease)] ${toneClasses[status]}`}
  title={labels[status]}
  aria-label={labels[status]}
></span>
