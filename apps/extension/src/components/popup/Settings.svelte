<script lang="ts">
  import { untrack } from 'svelte';
  import { LoaderCircle } from '@lucide/svelte';
  import { Button } from '~/components/ui/button/index.js';
  import { Input } from '~/components/ui/input/index.js';
  import { Label } from '~/components/ui/label/index.js';
  import type { Settings as StoredSettings } from '~/storage/settings';

  interface Props {
    settings: StoredSettings;
    isBusy: boolean;
    onSave: (next: StoredSettings) => void;
  }

  const { settings, isBusy, onSave }: Props = $props();

  let memberName = $state(untrack(() => settings.memberName));

  $effect(() => {
    memberName = settings.memberName;
  });

  const dirty = $derived(memberName !== settings.memberName);

  function handleSave(event: SubmitEvent): void {
    event.preventDefault();
    onSave({ ...settings, memberName });
  }
</script>

<form class="flex flex-col gap-3" onsubmit={handleSave}>
  <div class="flex flex-col gap-1.5">
    <Label
      class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
      for="display-name"
    >
      Display name
    </Label>
    <Input
      id="display-name"
      type="text"
      maxlength={32}
      placeholder="Guest"
      bind:value={memberName}
    />
  </div>

  <Button type="submit" disabled={isBusy || !dirty}>
    {#if isBusy}
      <LoaderCircle size={14} strokeWidth={2} class="animate-spin" aria-hidden="true" />
      Saving…
    {:else}
      {dirty ? 'Save changes' : 'Saved'}
    {/if}
  </Button>
</form>
