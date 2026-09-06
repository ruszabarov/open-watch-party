<script lang="ts">
  import { CircleAlert, TriangleAlert, X } from '@lucide/svelte';
  import * as Alert from '~/components/ui/alert/index.js';
  import { Button } from '~/components/ui/button/index.js';

  interface Props {
    kind: 'error' | 'warning';
    message: string;
    onDismiss?: () => void;
  }

  const { kind, message, onDismiss }: Props = $props();
</script>

<Alert.Root
  variant={kind === 'error' ? 'destructive' : 'default'}
  class={['flex items-start gap-2 px-3 py-2.5', kind === 'warning' ? 'bg-muted' : undefined]}
  role={kind === 'error' ? 'alert' : 'status'}
>
  <span class="inline-flex shrink-0" aria-hidden="true">
    {#if kind === 'error'}
      <CircleAlert size={14} strokeWidth={1.75} />
    {:else}
      <TriangleAlert size={14} strokeWidth={1.75} />
    {/if}
  </span>

  <Alert.Description class="wrap-break-word leading-5">
    {message}
  </Alert.Description>

  {#if onDismiss}
    <Button
      variant="ghost"
      size="icon-xs"
      class="h-5 w-5 shrink-0 opacity-70 hover:opacity-100"
      aria-label="Dismiss"
      onclick={onDismiss}
    >
      <X size={12} strokeWidth={1.75} aria-hidden="true" />
    </Button>
  {/if}
</Alert.Root>
