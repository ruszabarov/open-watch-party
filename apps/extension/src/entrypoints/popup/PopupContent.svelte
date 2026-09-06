<script lang="ts">
  import type { BackgroundState } from '../../background/state';
  import { sendMessage } from '../../messaging';
  import { updateSettings, type Settings as StoredSettings } from '../../storage/settings';
  import type { ActiveTabSummary } from './active-tab.js';
  import { failureMessage, thrownErrorSchema } from '@open-watch-party/shared';

  import Header, { type HeaderStatus } from '~/components/popup/Header.svelte';
  import StreamingServiceBadge from '~/components/popup/StreamingServiceBadge.svelte';
  import Lobby from '~/components/popup/Lobby.svelte';
  import Room from '~/components/popup/Room.svelte';
  import Settings from '~/components/popup/Settings.svelte';
  import Notice from '~/components/popup/Notice.svelte';
  import { Button } from '~/components/ui/button/index.js';
  import * as Tooltip from '~/components/ui/tooltip/index.js';
  import { Check, Copy, LoaderCircle, LogOut } from '@lucide/svelte';
  import { resolveMediaTitle } from '~/components/popup/room-state-format.js';

  interface Props {
    backgroundState: BackgroundState;
    settings: StoredSettings;
    activeTab: ActiveTabSummary;
  }

  const { backgroundState, settings, activeTab }: Props = $props();

  let commandError: string | null = $state(null);
  let settingsError: string | null = $state(null);
  let lastAction: 'create' | 'join' | 'leave' | null = $state(null);
  let dismissedErrorSeq = $state(0);
  let dismissedWarningSeq = $state(0);
  let isBusy = $state(false);
  let settingsOpen = $state(false);
  let copied = $state(false);
  let copyFailed = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = $state(null);

  const room = $derived(backgroundState.room);
  const session = $derived(backgroundState.session);
  const isActiveRoomOnCurrentTab = $derived(
    backgroundState.controlledTab != null &&
      backgroundState.controlledTab.tabId === activeTab.tabId,
  );
  const backgroundError = $derived(
    backgroundState.lastErrorSeq !== dismissedErrorSeq ? backgroundState.lastError : null,
  );
  const backgroundWarning = $derived(
    backgroundState.lastWarningSeq !== dismissedWarningSeq ? backgroundState.lastWarning : null,
  );
  const createError = $derived(lastAction === 'create' ? commandError : null);
  const joinError = $derived(lastAction === 'join' ? commandError : null);
  const leaveError = $derived(lastAction === 'leave' ? commandError : null);
  const leaveFirstMessage =
    'This tab is not controlling your active room. Leave it before starting or joining a room here.';

  const headerStatus: HeaderStatus | null = $derived(
    room || settingsOpen ? null : session ? 'reconnecting' : 'idle',
  );
  const headerTitle = $derived(
    settingsOpen
      ? 'Settings'
      : room
        ? resolveMediaTitle(room.playback.title, room.playback.mediaId, room.playback.serviceId)
        : session
          ? `Room ${session.roomCode}`
          : 'Open Watch Party',
  );
  const headerDetail = $derived.by(() => {
    if (settingsOpen || room) return null;
    if (session) return 'Reconnecting…';
    return null;
  });

  async function perform(
    action: 'create' | 'join' | 'leave',
    work: () => Promise<void>,
    onSuccess?: () => void,
  ): Promise<void> {
    isBusy = true;
    lastAction = action;
    try {
      await work();
      commandError = null;
      lastAction = null;
      onSuccess?.();
    } catch (error) {
      commandError = failureMessage(
        thrownErrorSchema.safeParse(error),
        'Unexpected popup error.',
      );
    } finally {
      isBusy = false;
    }
  }

  function handleCreateRoom(): void {
    void perform('create', () =>
      sendMessage('popup:create-room', { tabId: activeTab.tabId }),
    );
  }

  function handleJoinRoom(roomCode: string): void {
    void perform('join', () =>
      sendMessage('popup:join-room', { roomCode, tabId: activeTab.tabId }),
    );
  }

  function handleLeaveRoom(): void {
    void perform('leave', () => sendMessage('popup:leave-room', undefined));
  }

  async function handleSaveSettings(next: StoredSettings): Promise<void> {
    isBusy = true;
    settingsError = null;
    try {
      await updateSettings(next);
      closeSettings();
    } catch (error) {
      settingsError = failureMessage(
        thrownErrorSchema.safeParse(error),
        'Unexpected popup error.',
      );
    } finally {
      isBusy = false;
    }
  }

  async function handleCopyInvite(): Promise<void> {
    if (!room) return;
    copyFailed = false;
    try {
      await navigator.clipboard.writeText(room.roomCode);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      copied = false;
      copyFailed = true;
    }
  }

  function handleDismissHint(): void {
    void updateSettings({ ...settings, hideHint: true }).catch(() => undefined);
  }

  function dismissBackgroundError(): void {
    dismissedErrorSeq = backgroundState.lastErrorSeq;
  }

  function dismissBackgroundWarning(): void {
    dismissedWarningSeq = backgroundState.lastWarningSeq;
  }

  function toggleSettings(): void {
    settingsOpen = !settingsOpen;
  }

  function closeSettings(): void {
    settingsOpen = false;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && settingsOpen) {
      closeSettings();
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<Header
  status={headerStatus}
  title={headerTitle}
  detail={headerDetail}
  {settingsOpen}
  onToggleSettings={toggleSettings}
>
  {#snippet leading()}
    {#if room && !settingsOpen}
      <StreamingServiceBadge serviceId={room.serviceId} size="sm" />
    {/if}
  {/snippet}
</Header>

<main class="min-h-0 flex-1 overflow-y-auto p-3">
  {#if settingsOpen}
    <Settings {settings} {isBusy} onSave={handleSaveSettings} />
    {#if settingsError}
      <p class="m-0 mt-3 text-xs leading-5 text-destructive" role="alert">{settingsError}</p>
    {/if}
  {:else if room}
    <div class="flex flex-col gap-3">
      <Room popup={backgroundState} />
      {#if !isActiveRoomOnCurrentTab}
        <Notice kind="warning" message={leaveFirstMessage} />
      {/if}
    </div>
  {:else if session}
    <div class="flex items-start gap-2.5">
      <LoaderCircle
        size={16}
        strokeWidth={2}
        class="mt-0.5 shrink-0 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1 leading-snug">
        <p class="m-0 text-sm font-semibold">Reconnecting to room {session.roomCode}</p>
        <p class="m-0 text-xs leading-5 text-muted-foreground">{leaveFirstMessage}</p>
      </div>
    </div>
  {:else}
    <Lobby
      {activeTab}
      {isBusy}
      {createError}
      {joinError}
      showHint={!settings.hideHint}
      onCreateRoom={handleCreateRoom}
      onJoinRoom={handleJoinRoom}
      onDismissHint={handleDismissHint}
    />
  {/if}

  {#if !settingsOpen && backgroundError}
    <div class="mt-3">
      <Notice kind="error" message={backgroundError} onDismiss={dismissBackgroundError} />
    </div>
  {/if}
  {#if !settingsOpen && backgroundWarning}
    <div class="mt-3">
      <Notice kind="warning" message={backgroundWarning} onDismiss={dismissBackgroundWarning} />
    </div>
  {/if}
</main>

{#if !settingsOpen}
  {#if room}
    <footer class="shrink-0 border-t border-border p-3">
      <div class="flex gap-2">
        <Tooltip.Provider delayDuration={300}>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button class="min-w-0 flex-1 font-semibold" onclick={handleCopyInvite} {...props}>
                  {#if copied}
                    <Check size={14} strokeWidth={2} aria-hidden="true" />
                    <span aria-live="polite">Copied</span>
                  {:else}
                    <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
                    <span aria-live="polite">Copy invite</span>
                  {/if}
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">
              <span class="font-mono tracking-widest">{room.roomCode}</span>
            </Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  variant="ghost"
                  size="icon"
                  class="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Leave room"
                  onclick={handleLeaveRoom}
                  disabled={isBusy}
                  {...props}
                >
                  <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">Leave room</Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
      {#if copyFailed}
        <p class="m-0 mt-1.5 text-xs leading-5 text-destructive" role="alert">
          Couldn't copy — the code is {room.roomCode}.
        </p>
      {/if}
      {#if leaveError}
        <p class="m-0 mt-1.5 text-xs leading-5 text-destructive" role="alert">{leaveError}</p>
      {/if}
    </footer>
  {:else if session}
    <footer class="shrink-0 border-t border-border p-3">
      <Button
        variant="destructive"
        class="w-full font-semibold"
        onclick={handleLeaveRoom}
        disabled={isBusy}
      >
        {#if isBusy}
          <LoaderCircle size={14} strokeWidth={2} class="animate-spin" aria-hidden="true" />
          Leaving…
        {:else}
          Leave room
        {/if}
      </Button>
      {#if leaveError}
        <p class="m-0 mt-1.5 text-xs leading-5 text-destructive" role="alert">{leaveError}</p>
      {/if}
    </footer>
  {/if}
{/if}
