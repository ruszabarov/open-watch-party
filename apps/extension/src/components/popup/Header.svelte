<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Settings as SettingsIcon, X } from '@lucide/svelte';
  import { Button } from '~/components/ui/button/index.js';
  import { cn } from '~/utils/styles.js';

  export type HeaderStatus = 'idle' | 'active' | 'reconnecting';

  interface Props {
    status: HeaderStatus | null;
    title: string;
    detail?: string | null;
    settingsOpen: boolean;
    onToggleSettings: () => void;
    leading?: Snippet;
  }

  const {
    status,
    title,
    detail = null,
    settingsOpen,
    onToggleSettings,
    leading,
  }: Props = $props();

  const dotClass = $derived(
    status === 'active'
      ? 'bg-emerald-500'
      : status === 'reconnecting'
        ? 'bg-amber-500'
        : 'bg-muted-foreground/40',
  );
  const statusLabel = $derived(
    status === 'active' ? 'Connected' : status === 'reconnecting' ? 'Reconnecting' : 'Idle',
  );
</script>

<header class="flex min-h-10 shrink-0 items-start gap-2 border-b border-border px-3 py-1.5">
  {#if status}
  <span
    class={cn('mt-1 h-2 w-2 shrink-0 rounded-full', dotClass)}
    role="img"
    aria-label={statusLabel}
  ></span>
  {/if}
  <div class="min-w-0 flex-1 leading-tight">
    <div class="flex min-w-0 items-center gap-2">
      {#if leading}
        {@render leading()}
      {/if}
      <p class="m-0 min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
    </div>
    {#if detail}
      <p class="m-0 truncate text-xs text-muted-foreground">{detail}</p>
    {/if}
  </div>
  <Button
    variant="ghost"
    size="icon-sm"
    class="shrink-0"
    aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
    aria-expanded={settingsOpen}
    onclick={onToggleSettings}
  >
    {#if settingsOpen}
      <X size={16} strokeWidth={1.75} aria-hidden="true" />
    {:else}
      <SettingsIcon size={16} strokeWidth={1.75} aria-hidden="true" />
    {/if}
  </Button>
</header>
