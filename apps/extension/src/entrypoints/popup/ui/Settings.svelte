<script lang="ts">
  import { untrack } from 'svelte';
  import {
    DEFAULT_SERVER_URL,
    SHOW_SERVER_SETTINGS,
    type PopupState,
  } from '../../../lib/protocol/extension';

  interface Props {
    settings: PopupState['settings'];
    isBusy: boolean;
    onSave: (next: PopupState['settings']) => void;
  }

  const { settings, isBusy, onSave }: Props = $props();

  let memberName = $state(untrack(() => settings.memberName));
  let serverUrl = $state(untrack(() => settings.serverUrl));

  $effect(() => {
    memberName = settings.memberName;
    serverUrl = settings.serverUrl;
  });

  const dirty = $derived(
    memberName !== settings.memberName || serverUrl !== settings.serverUrl,
  );

  function handleSave(event: SubmitEvent): void {
    event.preventDefault();
    onSave({ memberName, serverUrl });
  }
</script>

<form class="flex min-h-full flex-col gap-3" onsubmitcapture={handleSave}>
  <label class="flex flex-col gap-2">
    <span class="text-sm font-semibold text-[var(--text-muted)]">Display name</span>
    <input
      type="text"
      maxlength="32"
      placeholder="Guest"
      class="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[var(--text)] transition-colors duration-150 ease-[var(--ease)] placeholder:text-[var(--text-subtle)] hover:border-[var(--border-strong)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
      bind:value={memberName}
    />
  </label>

  {#if SHOW_SERVER_SETTINGS}
    <label class="flex flex-col gap-2">
      <span class="text-sm font-semibold text-[var(--text-muted)]">Server URL</span>
      <input
        type="url"
        placeholder={DEFAULT_SERVER_URL}
        class="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[var(--text)] transition-colors duration-150 ease-[var(--ease)] placeholder:text-[var(--text-subtle)] hover:border-[var(--border-strong)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
        bind:value={serverUrl}
      />
      <span class="text-xs leading-5 text-[var(--text-subtle)]">
        Point the extension at a self-hosted backend.
      </span>
    </label>
  {/if}

  <button
    class="mt-auto inline-flex h-10 items-center justify-center rounded-lg border border-stone-900 bg-stone-900 px-4 text-base font-bold text-white shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
    type="submit"
    disabled={isBusy || !dirty}
  >
    {dirty ? 'Save changes' : 'Saved'}
  </button>
</form>
