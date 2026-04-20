<script lang="ts">
  interface Props {
    kind: 'error' | 'warning';
    message: string;
    onDismiss?: () => void;
  }

  const { kind, message, onDismiss }: Props = $props();
</script>

<div
  class:border-[var(--danger-border)]={kind === 'error'}
  class:bg-[var(--danger-bg)]={kind === 'error'}
  class:text-[var(--danger)]={kind === 'error'}
  class:border-[var(--warning-border)]={kind === 'warning'}
  class:bg-[var(--warning-bg)]={kind === 'warning'}
  class:text-[var(--warning)]={kind === 'warning'}
  class="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
  role={kind === 'error' ? 'alert' : 'status'}
>
  <span class="inline-flex shrink-0 pt-0.5" aria-hidden="true">
    {#if kind === 'error'}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.4" />
        <path d="M7 4.5v3m0 2v.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    {:else}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M7 2l5.2 9H1.8L7 2z"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
        <path d="M7 6v2m0 2v.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    {/if}
  </span>

  <span class="min-w-0 flex-1 break-words text-[var(--text)]">{message}</span>

  {#if onDismiss}
    <button
      class="inline-flex items-center justify-center rounded-md border-none bg-transparent p-1 text-current opacity-70 transition-opacity duration-150 ease-[var(--ease)] hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
      type="button"
      aria-label="Dismiss"
      onclickcapture={onDismiss}
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3.5 3.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
  {/if}
</div>
