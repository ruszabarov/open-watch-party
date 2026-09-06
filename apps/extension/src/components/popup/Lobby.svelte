<script lang="ts">
  import { Clapperboard, LoaderCircle, X } from '@lucide/svelte';
  import { Button } from '~/components/ui/button/index.js';
  import { Input } from '~/components/ui/input/index.js';
  import type { ActiveTabSummary } from '~/entrypoints/popup/active-tab.js';
  import { getServiceDescriptor } from '~/streaming-services/catalog.js';
  import { resolveMediaTitle } from './room-state-format.js';
  import StreamingServiceBadge from './StreamingServiceBadge.svelte';

  interface Props {
    activeTab: ActiveTabSummary;
    isBusy: boolean;
    createError: string | null;
    joinError: string | null;
    showHint: boolean;
    onCreateRoom: () => void;
    onJoinRoom: (code: string) => void;
    onDismissHint: () => void;
  }

  const {
    activeTab,
    isBusy,
    createError,
    joinError,
    showHint,
    onCreateRoom,
    onJoinRoom,
    onDismissHint,
  }: Props = $props();

  let joinCode = $state('');

  const activeDescriptor = $derived(getServiceDescriptor(activeTab.activeServiceId));
  const heroTitle = $derived(
    activeTab.title
      ? resolveMediaTitle(activeTab.title, activeTab.title, activeTab.activeServiceId)
      : (activeDescriptor?.label ?? 'Ready to start'),
  );
  const isReady = $derived(activeTab.isWatchPage);
  const trimmedCode = $derived(joinCode.trim().toUpperCase());
  const codeValid = $derived(/^[A-HJ-NP-Z2-9]{6}$/.test(trimmedCode));
  const validationError = $derived(
    trimmedCode && !codeValid ? 'Enter the 6-character code.' : null,
  );
  const inlineError = $derived(validationError ?? joinError);

  function handleJoin(event: SubmitEvent): void {
    event.preventDefault();
    if (!codeValid || isBusy) return;
    onJoinRoom(trimmedCode);
  }
</script>

<div class="flex flex-col gap-4">
  {#if isReady}
    <section aria-label="This video">
      <div class="flex items-center gap-2.5">
        {#if activeDescriptor}
          <StreamingServiceBadge serviceId={activeTab.activeServiceId} size="sm" />
        {/if}
        <div class="min-w-0 flex-1 leading-snug">
          <p class="m-0 truncate text-sm font-semibold">
            {heroTitle}
          </p>
          <p class="m-0 truncate text-xs text-muted-foreground">
            {activeDescriptor ? `${activeDescriptor.label} · this video` : 'This video'}
          </p>
        </div>
      </div>
      <div class="mt-2">
        {#if createError}
          <p class="m-0 mb-1.5 text-xs leading-5 text-destructive" role="alert">{createError}</p>
        {/if}
        <Button class="w-full font-semibold" onclick={onCreateRoom} disabled={isBusy}>
          {#if isBusy}
            <LoaderCircle size={14} strokeWidth={2} class="animate-spin" aria-hidden="true" />
            Creating…
          {:else}
            Create room for this video
          {/if}
        </Button>
      </div>
    </section>

    <div class="border-t border-border" role="separator"></div>
  {:else}
    <div class="flex items-start gap-2.5">
      {#if activeDescriptor}
        <StreamingServiceBadge serviceId={activeTab.activeServiceId} size="sm" />
      {:else}
        <span
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Clapperboard size={14} strokeWidth={1.75} />
        </span>
      {/if}
      <div class="min-w-0 flex-1 leading-snug">
        <p class="m-0 text-sm font-semibold">Open a video to start</p>
        <p class="m-0 text-xs leading-5 text-muted-foreground">
          {#if activeDescriptor}
            You're on {activeDescriptor.label} — open a video, then create a room.
          {:else}
            Open a Netflix or YouTube video, then create a room.
          {/if}
        </p>
      </div>
    </div>
  {/if}

  {#if showHint}
    <div class="flex items-start gap-2 rounded-md bg-muted px-3 py-2">
      <p class="m-0 min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
        <span class="font-medium text-foreground">How it works:</span>
        create a room on a video page, then share the code with friends.
      </p>
      <Button
        variant="ghost"
        size="icon-xs"
        class="shrink-0 text-muted-foreground"
        aria-label="Dismiss tip"
        onclick={onDismissHint}
      >
        <X size={12} strokeWidth={1.75} aria-hidden="true" />
      </Button>
    </div>
  {/if}

  <section aria-label="Have a code? Join">
    <p class="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      Have a code? Join
    </p>
    <form class="flex flex-col gap-1.5" onsubmit={handleJoin}>
      <div class="flex gap-2">
        <Input
          id="join-code"
          type="text"
          maxlength={6}
          autocomplete="off"
          spellcheck="false"
          placeholder="ABC123"
          aria-label="Room code"
          aria-invalid={inlineError ? true : undefined}
          aria-describedby={inlineError ? 'join-code-error' : undefined}
          class="h-9 flex-1 font-mono font-semibold uppercase tracking-widest"
          bind:value={joinCode}
        />
        <Button type="submit" variant="outline" disabled={isBusy || !codeValid}>
          {#if isBusy}
            <LoaderCircle size={14} strokeWidth={2} class="animate-spin" aria-hidden="true" />
            Joining…
          {:else}
            Join
          {/if}
        </Button>
      </div>
      {#if inlineError}
        <p id="join-code-error" class="m-0 text-xs leading-5 text-destructive" role="alert">
          {inlineError}
        </p>
      {/if}
    </form>
  </section>
</div>
