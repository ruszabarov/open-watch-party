<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import type { BackgroundState } from '~/utils/background/state';

  interface Props {
    settings: BackgroundState['settings'];
    isBusy: boolean;
    onSave: (next: BackgroundState['settings']) => void;
  }

  const { settings, isBusy, onSave }: Props = $props();

  let memberName = $state(untrack(() => settings.memberName));

  $effect(() => {
    memberName = settings.memberName;
  });

  const dirty = $derived(memberName !== settings.memberName);

  function handleSave(event: SubmitEvent): void {
    event.preventDefault();
    onSave({ memberName });
  }
</script>

<form class="flex flex-col gap-3" onsubmit={handleSave}>
  <div class="flex flex-col gap-2">
    <Label
      class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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

  <Button
    class="font-semibold"
    type="submit"
    disabled={isBusy || !dirty}
  >
    {dirty ? 'Save changes' : 'Saved'}
  </Button>
</form>
