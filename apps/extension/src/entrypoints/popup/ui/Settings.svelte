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
    onClose: () => void;
  }

  const { settings, isBusy, onSave, onClose }: Props = $props();

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

<form class="settings" onsubmitcapture={handleSave}>
  <div class="row-between">
    <p class="label">Extension settings</p>
    <button
      class="btn btn-ghost btn-icon"
      type="button"
      aria-label="Close settings"
      onclickcapture={onClose}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3.5 3.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  </div>

  <div class="settings__intro">
    <p class="settings__title">Personalize your watch party</p>
    <p class="field__hint">Your display name is shown to everyone in the room.</p>
  </div>

  <label class="field">
    <span class="field__label">Display name</span>
    <input
      type="text"
      maxlength="32"
      placeholder="Guest"
      bind:value={memberName}
    />
  </label>

  {#if SHOW_SERVER_SETTINGS}
    <label class="field">
      <span class="field__label">Server URL</span>
      <input
        type="url"
        placeholder={DEFAULT_SERVER_URL}
        bind:value={serverUrl}
      />
      <span class="field__hint">Point the extension at a self-hosted backend.</span>
    </label>
  {/if}

  <button
    class="btn btn-primary"
    type="submit"
    disabled={isBusy || !dirty}
  >
    {dirty ? 'Save changes' : 'Saved'}
  </button>
</form>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 100%;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .settings__intro {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .settings__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.2rem;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }

  .field__label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .field__hint {
    font-size: 0.75rem;
    color: var(--text-subtle);
    line-height: 1.4;
  }
</style>
