<script lang="ts">
  import {
    backgroundStateItem,
    createBackgroundState,
    selectConnectionStatus,
    selectRoom,
    type BackgroundState,
  } from '../../utils/background/state';
  import { sendMessage } from '../../utils/protocol/messaging';
  import { getErrorMessage } from '../../utils/errors';

  import Header from '../../components/popup/Header.svelte';
  import Lobby from '../../components/popup/Lobby.svelte';
  import Room from '../../components/popup/Room.svelte';
  import Settings from '../../components/popup/Settings.svelte';
  import Notice from '../../components/popup/Notice.svelte';

  let popup: BackgroundState = $state(createBackgroundState());
  let isBusy = $state(false);
  let settingsOpen = $state(false);

  const connectionStatus = $derived(selectConnectionStatus(popup));
  const room = $derived(selectRoom(popup));

  function setLastError(error: unknown): void {
    popup = { ...popup, lastError: getErrorMessage(error, 'Unexpected popup error.') };
  }

  async function perform(action: () => Promise<void>): Promise<void> {
    isBusy = true;
    try {
      await action();
    } catch (error) {
      setLastError(error);
    } finally {
      isBusy = false;
    }
  }

  function handleCreateRoom(): void {
    void perform(() => sendMessage('popup:create-room', undefined));
  }

  function handleJoinRoom(roomCode: string): void {
    void perform(() => sendMessage('popup:join-room', { roomCode }));
  }

  function handleLeaveRoom(): void {
    void perform(() => sendMessage('popup:leave-room', undefined));
  }

  function handleSaveSettings(next: BackgroundState['settings']): void {
    void perform(() => sendMessage('popup:update-settings', next)).then(closeSettings);
  }

  function dismissError(): void {
    popup = { ...popup, lastError: null };
  }

  function dismissWarning(): void {
    popup = { ...popup, lastWarning: null };
  }

  function toggleSettings(): void {
    settingsOpen = !settingsOpen;
  }

  function closeSettings(): void {
    settingsOpen = false;
  }

  $effect(() => {
    backgroundStateItem.getValue().then((v) => { popup = v; });

    const unwatch = backgroundStateItem.watch((newValue) => {
      popup = newValue;
    });

    return () => unwatch();
  });
</script>

<div class="flex flex-col overflow-hidden bg-stone-50 text-stone-900">
  <Header
    status={connectionStatus}
    settingsOpen={settingsOpen}
    onToggleSettings={toggleSettings}
  />

  <main class="p-3">
    {#if settingsOpen}
      <div class="flex flex-col gap-3">
        <Settings
          settings={popup.settings}
          {isBusy}
          onSave={handleSaveSettings}
        />
      </div>
    {:else}
      <div class="flex flex-col gap-3">
        {#if room}
          <Room
            popup={popup}
            {isBusy}
            onLeave={handleLeaveRoom}
          />
        {:else}
          <Lobby
            popup={popup}
            {isBusy}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
          />
        {/if}

        {#if popup.lastError}
          <Notice kind="error" message={popup.lastError} onDismiss={dismissError} />
        {/if}

        {#if popup.lastWarning}
          <Notice kind="warning" message={popup.lastWarning} onDismiss={dismissWarning} />
        {/if}
      </div>
    {/if}
  </main>
</div>
