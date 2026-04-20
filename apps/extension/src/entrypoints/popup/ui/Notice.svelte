<script lang="ts">
  interface Props {
    kind: 'error' | 'warning';
    message: string;
    onDismiss?: () => void;
  }

  const { kind, message, onDismiss }: Props = $props();
</script>

<div class="notice notice--{kind}" role={kind === 'error' ? 'alert' : 'status'}>
  <span class="notice__icon" aria-hidden="true">
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

  <span class="notice__message">{message}</span>

  {#if onDismiss}
    <button
      class="notice__dismiss"
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

<style>
  .notice {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 8px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    border: 1px solid;
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .notice--error {
    background: var(--danger-bg);
    border-color: var(--danger-border);
    color: var(--danger);
  }

  .notice--warning {
    background: var(--warning-bg);
    border-color: var(--warning-border);
    color: var(--warning);
  }

  .notice__icon {
    display: inline-flex;
    padding-top: 2px;
    flex-shrink: 0;
  }

  .notice__message {
    min-width: 0;
    color: var(--text);
    word-break: break-word;
  }

  .notice__dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border-radius: 6px;
    background: transparent;
    color: currentColor;
    border: none;
    opacity: 0.7;
  }

  .notice__dismiss:hover {
    opacity: 1;
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
</style>
