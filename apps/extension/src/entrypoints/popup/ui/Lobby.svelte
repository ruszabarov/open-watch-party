<script lang="ts">
  import type { PopupState } from '../../../lib/protocol/extension';
  import {
    SUPPORTED_SERVICE_DESCRIPTORS,
    getServiceDescriptor,
  } from '../../../lib/services/registry';
  import ServiceBadge from './ServiceBadge.svelte';

  interface Props {
    popup: PopupState;
    isBusy: boolean;
    onCreateRoom: () => void;
    onJoinRoom: (code: string) => void;
  }

  const { popup, isBusy, onCreateRoom, onJoinRoom }: Props = $props();

  let joinCode = $state('');

  const activeDescriptor = $derived(
    getServiceDescriptor(popup.contentContext?.serviceId),
  );

  const isReady = $derived(popup.activeTab.isNetflixWatchPage);

  const title = $derived.by(() => {
    if (isReady) {
      return (
        popup.contentContext?.mediaTitle ??
        activeDescriptor?.label ??
        'Ready to start'
      );
    }
    return 'Open a supported video page';
  });

  const hint = $derived.by(() => {
    if (isReady) {
      return activeDescriptor
        ? `Watching on ${activeDescriptor.label}. Invite friends with a code.`
        : 'Create a room or join one with a code.';
    }
    return (
      popup.contentContext?.issue ??
      `Start a playback page to begin — try ${
        SUPPORTED_SERVICE_DESCRIPTORS.map((d) => d.watchPathHint).join(', ')
      }.`
    );
  });

  const trimmedCode = $derived(joinCode.trim());

  const canAct = $derived(isReady && !isBusy);

  function handleJoin(): void {
    if (!trimmedCode) return;
    onJoinRoom(trimmedCode);
  }

  function handleCodeKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleJoin();
    }
  }
</script>

<section class="lobby">
  <div class="lobby__hero">
    <ServiceBadge serviceId={popup.contentContext?.serviceId} />
    <div class="stack-sm">
      <p class="title">{title}</p>
      <p class="hint">{hint}</p>
    </div>
  </div>

  <button
    class="btn btn-primary"
    type="button"
    onclickcapture={onCreateRoom}
    disabled={!canAct}
  >
    Create room
  </button>

  <div class="divider" role="separator" aria-hidden="true"></div>

  <form class="join" onsubmitcapture={(e) => { e.preventDefault(); handleJoin(); }}>
    <label class="label" for="join-code">Have a code?</label>
    <div class="join__row">
      <input
        id="join-code"
        type="text"
        maxlength="8"
        autocomplete="off"
        spellcheck="false"
        placeholder="ABC123"
        bind:value={joinCode}
        onkeydowncapture={handleCodeKeydown}
      />
      <button
        class="btn btn-secondary"
        type="submit"
        disabled={!canAct || !trimmedCode}
      >
        Join
      </button>
    </div>
  </form>
</section>

<style>
  .lobby {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .lobby__hero {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
    align-items: flex-start;
  }

  .join {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .join__row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }

  .join input {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-family: var(--font-mono);
    font-weight: 600;
  }
</style>
