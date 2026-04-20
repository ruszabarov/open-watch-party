<script lang="ts">
  import type { PlaybackUpdate } from '@watch-party/shared';
  import type { PopupState } from '../../../lib/protocol/extension';
  import ServiceBadge from './ServiceBadge.svelte';

  interface Props {
    popup: PopupState;
    isBusy: boolean;
    onLeave: () => void;
    onPlaybackUpdate: (update: PlaybackUpdate) => void;
  }

  const { popup, isBusy, onLeave, onPlaybackUpdate }: Props = $props();

  const room = $derived(popup.room!);
  const playback = $derived(room.playback);
  const title = $derived(
    playback.title ?? popup.contentContext?.mediaTitle ?? 'Untitled',
  );
  const positionSec = $derived(playback.positionSec ?? 0);
  const canControl = $derived(Boolean(popup.contentContext?.mediaId) && !isBusy);

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(room.roomCode);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1600);
    } catch {
      // Clipboard may be unavailable — silently ignore.
    }
  }

  function sendUpdate(overrides: { playing?: boolean; positionDeltaSec?: number }): void {
    if (!popup.contentContext?.mediaId) return;

    const update: PlaybackUpdate = {
      serviceId: 'netflix',
      mediaId: popup.contentContext.mediaId,
      title: popup.contentContext.mediaTitle,
      positionSec: Math.max(0, positionSec + (overrides.positionDeltaSec ?? 0)),
      playing: overrides.playing ?? playback.playing,
      issuedAt: Date.now(),
    };

    onPlaybackUpdate(update);
  }

  function formatPosition(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<section class="flex flex-col gap-3">
  <div class="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_6%,var(--surface-1))_0%,var(--surface-1)_100%)] px-4 py-4">
    <div class="min-w-0 space-y-1">
      <p class="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Room code</p>
      <p
        class="m-0 text-2xl font-bold tracking-wider [font-family:var(--font-display)] [font-variation-settings:'SOFT'_80,'opsz'_108]"
        aria-live="polite"
      >
        {room.roomCode}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button
        class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text)] shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
        type="button"
        aria-label={copied ? 'Copied' : 'Copy room code'}
        onclickcapture={copyCode}
      >
        {#if copied}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4" />
            <path d="M11 5V4a1.5 1.5 0 00-1.5-1.5h-5A1.5 1.5 0 003 4v5A1.5 1.5 0 004.5 10.5H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        {/if}
      </button>
      <button
        class="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 text-sm font-semibold whitespace-nowrap text-[var(--danger)] shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
        type="button"
        onclickcapture={onLeave}
        disabled={isBusy}
      >
        Leave
      </button>
    </div>
  </div>

  <div class="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-sm)]">
    <div class="flex items-center gap-3">
      <ServiceBadge serviceId={playback.serviceId} size="sm" />
      <div class="min-w-0 space-y-1">
        <p
          class="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold leading-5"
          title={title}
        >
          {title}
        </p>
        <p class="m-0 text-sm leading-5 text-[var(--text-muted)]">
          <span
            class:text-[var(--success)]={playback.playing}
            class:text-[var(--text-muted)]={!playback.playing}
            class="inline-flex items-center gap-1 font-semibold"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
            {playback.playing ? 'Playing' : 'Paused'}
          </span>
          <span aria-hidden="true">·</span>
          <span class="tabular-nums">{formatPosition(positionSec)}</span>
        </p>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-2" role="group" aria-label="Playback controls">
      <button
        class="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 text-sm font-semibold text-[var(--text)] shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
        type="button"
        aria-label="Rewind 10 seconds"
        onclickcapture={() => sendUpdate({ positionDeltaSec: -10 })}
        disabled={!canControl}
      >
        −10s
      </button>
      {#if playback.playing}
        <button
          class="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-2 text-sm font-bold text-[var(--primary-contrast)] shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
          type="button"
          onclickcapture={() => sendUpdate({ playing: false })}
          disabled={!canControl}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <rect x="2" y="1.5" width="2.75" height="9" rx="0.6" />
            <rect x="7.25" y="1.5" width="2.75" height="9" rx="0.6" />
          </svg>
          Pause
        </button>
      {:else}
        <button
          class="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-2 text-sm font-bold text-[var(--primary-contrast)] shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
          type="button"
          onclickcapture={() => sendUpdate({ playing: true })}
          disabled={!canControl}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M3 1.8v8.4a.6.6 0 00.92.5l6.6-4.2a.6.6 0 000-1L3.92 1.3A.6.6 0 003 1.8z" />
          </svg>
          Play
        </button>
      {/if}
      <button
        class="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 text-sm font-semibold text-[var(--text)] shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--surface-0)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring)]"
        type="button"
        aria-label="Skip 10 seconds"
        onclickcapture={() => sendUpdate({ positionDeltaSec: 10 })}
        disabled={!canControl}
      >
        +10s
      </button>
    </div>
  </div>

  {#if room.members.length}
    <div>
      <p class="mb-2 mt-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
        {room.members.length} {room.members.length === 1 ? 'member' : 'members'}
      </p>
      <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
        {#each room.members as member (member.id)}
          <li
            class:bg-[var(--primary)]={member.id === popup.roomMemberId}
            class:border-[var(--primary)]={member.id === popup.roomMemberId}
            class:text-[var(--primary-contrast)]={member.id === popup.roomMemberId}
            class:bg-[var(--surface-2)]={member.id !== popup.roomMemberId}
            class:border-[var(--border)]={member.id !== popup.roomMemberId}
            class:text-[var(--text)]={member.id !== popup.roomMemberId}
            class="inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 pl-1 text-sm"
            title={member.name}
          >
            <span
              class:bg-[color-mix(in_srgb,var(--primary-contrast)_20%,transparent)]={member.id === popup.roomMemberId}
              class:text-[var(--primary-contrast)]={member.id === popup.roomMemberId}
              class:bg-[var(--surface-1)]={member.id !== popup.roomMemberId}
              class:text-[var(--text)]={member.id !== popup.roomMemberId}
              class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
              aria-hidden="true"
            >
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <span class="max-w-44 overflow-hidden text-ellipsis whitespace-nowrap">
              {member.name}{member.id === popup.roomMemberId ? ' (you)' : ''}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
