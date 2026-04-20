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

<section class="flex flex-col gap-3">
  <div class="flex items-start gap-3">
    <ServiceBadge serviceId={popup.contentContext?.serviceId} />
    <div class="space-y-1">
      <p class="m-0 text-sm font-semibold leading-5">
        {title}
      </p>
      <p class="m-0 text-sm leading-5 text-[var(--text-muted)]">{hint}</p>
    </div>
  </div>

  <button
    class="inline-flex h-10 items-center justify-center rounded-lg border border-stone-900 bg-stone-900 px-4 text-base font-bold text-white shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
    type="button"
    onclickcapture={onCreateRoom}
    disabled={!canAct}
  >
    Create room
  </button>

  <div class="h-px bg-[var(--border)]" role="separator" aria-hidden="true"></div>

  <form
    class="flex flex-col gap-2"
    onsubmitcapture={(e) => { e.preventDefault(); handleJoin(); }}
  >
    <label
      class="text-xs font-semibold uppercase tracking-wide text-[var(--text-subtle)]"
      for="join-code"
    >
      Have a code?
    </label>
    <div class="flex gap-2">
      <input
        id="join-code"
        type="text"
        maxlength="8"
        autocomplete="off"
        spellcheck="false"
        placeholder="ABC123"
        class="h-9 w-full flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 font-semibold uppercase tracking-widest text-[var(--text)] [font-family:var(--font-mono)] transition-colors duration-150 ease-[var(--ease)] placeholder:text-[var(--text-subtle)] hover:border-[var(--border-strong)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
        bind:value={joinCode}
        onkeydowncapture={handleCodeKeydown}
      />
      <button
        class="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-sm font-semibold whitespace-nowrap text-[var(--text)] shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
        type="submit"
        disabled={!canAct || !trimmedCode}
      >
        Join
      </button>
    </div>
  </form>
</section>
