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

<section class="room">
  <div class="code-card">
    <div class="code-card__meta">
      <p class="label">Room code</p>
      <p class="code" aria-live="polite">{room.roomCode}</p>
    </div>
    <div class="code-card__actions">
      <button
        class="btn btn-ghost btn-icon"
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
      <button class="btn btn-danger" type="button" onclickcapture={onLeave} disabled={isBusy}>
        Leave
      </button>
    </div>
  </div>

  <div class="card playback">
    <div class="playback__meta">
      <ServiceBadge serviceId={playback.serviceId} size="sm" />
      <div class="stack-sm playback__text">
        <p class="title playback__title" title={title}>{title}</p>
        <p class="hint">
          <span class="status status--{playback.playing ? 'playing' : 'paused'}">
            {playback.playing ? 'Playing' : 'Paused'}
          </span>
          <span aria-hidden="true">·</span>
          <span class="tabular">{formatPosition(positionSec)}</span>
        </p>
      </div>
    </div>

    <div class="playback__controls" role="group" aria-label="Playback controls">
      <button
        class="btn btn-secondary"
        type="button"
        aria-label="Rewind 10 seconds"
        onclickcapture={() => sendUpdate({ positionDeltaSec: -10 })}
        disabled={!canControl}
      >
        −10s
      </button>
      {#if playback.playing}
        <button
          class="btn btn-primary"
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
          class="btn btn-primary"
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
        class="btn btn-secondary"
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
    <div class="members">
      <p class="label members__heading">
        {room.members.length} {room.members.length === 1 ? 'member' : 'members'}
      </p>
      <ul class="members__list">
        {#each room.members as member (member.id)}
          <li
            class="chip"
            class:chip--me={member.id === popup.roomMemberId}
            title={member.name}
          >
            <span class="chip__avatar" aria-hidden="true">
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <span class="chip__name">
              {member.name}{member.id === popup.roomMemberId ? ' (you)' : ''}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .room {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .code-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 14px 14px 16px;
    border-radius: var(--radius-lg);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--primary) 6%, var(--surface-1)) 0%,
      var(--surface-1) 100%
    );
    border: 1px solid var(--border);
  }

  .code-card__meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .code {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.6rem;
    letter-spacing: 0.08em;
    line-height: 1.1;
    font-variation-settings: 'SOFT' 80, 'opsz' 108;
  }

  .code-card__actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .playback__meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    align-items: center;
  }

  .playback__text {
    min-width: 0;
  }

  .playback__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .playback__controls {
    display: grid;
    grid-template-columns: 1fr 1.3fr 1fr;
    gap: 6px;
  }

  .playback__controls .btn {
    padding: 0 8px;
  }

  .tabular {
    font-variant-numeric: tabular-nums;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
  }

  .status::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .status--playing {
    color: var(--success);
  }

  .status--paused {
    color: var(--text-muted);
  }

  .members__heading {
    margin: 0 0 8px;
  }

  .members__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px 4px 4px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: 0.78rem;
    max-width: 100%;
  }

  .chip__avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--surface-1);
    color: var(--text);
    font-weight: 700;
    font-size: 0.72rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .chip__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 180px;
  }

  .chip--me {
    background: var(--primary);
    color: var(--primary-contrast);
    border-color: var(--primary);
  }

  .chip--me .chip__avatar {
    background: color-mix(in srgb, var(--primary-contrast) 20%, transparent);
    color: var(--primary-contrast);
  }
</style>
