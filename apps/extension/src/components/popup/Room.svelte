<script lang="ts">
  import { Check, Copy } from '@lucide/svelte';
  import { Badge } from '~/components/ui/badge/index.js';
  import { Button } from '~/components/ui/button/index.js';
  import { Card, CardContent } from '~/components/ui/card/index.js';
  import * as Tooltip from '~/components/ui/tooltip/index.js';
  import type { BackgroundState } from '~/background/state';
  import {
    formatPlaybackPosition,
    resolveMediaTitle,
    resolveSourceMemberName,
  } from './room-state-format.js';

  interface Props {
    popup: BackgroundState;
    isBusy: boolean;
    onLeave: () => void;
  }

  const { popup, isBusy, onLeave }: Props = $props();

  const room = $derived(popup.room!);
  const roomMemberId = $derived(popup.session?.memberId ?? null);

  const playback = $derived(room.playback);
  const mediaTitle = $derived(resolveMediaTitle(playback.title, playback.mediaId));
  const positionLabel = $derived(formatPlaybackPosition(playback.positionSec));
  const sourceMemberName = $derived(resolveSourceMemberName(room.members, playback.sourceMemberId));
  const updatedAtLabel = $derived(
    new Date(playback.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  );

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
</script>

<section class="flex flex-col gap-3">
  <Card size="sm">
    <CardContent class="flex items-center justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <p class="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Room code</p>
        <p class="m-0 text-2xl font-bold tracking-wider" aria-live="polite">
          {room.roomCode}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label={copied ? 'Copied' : 'Copy room code'}
        onclick={copyCode}
      >
        {#if copied}
          <Check size={14} strokeWidth={1.75} aria-hidden="true" />
        {:else}
          <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
        {/if}
      </Button>
      <Button
        variant="destructive"
        class="font-semibold"
        onclick={onLeave}
        disabled={isBusy}
      >
        Leave
      </Button>
      </div>
    </CardContent>
  </Card>

  <Card size="sm">
    <CardContent class="space-y-3">
      <div class="flex items-center gap-2">
        <Tooltip.Provider delayDuration={150}>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <p
                  {...props}
                  class="m-0 min-w-0 flex-1 cursor-default truncate text-left text-sm font-semibold leading-5"
                >
                  {mediaTitle}
                </p>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content class="max-w-64 break-all">
              {room.watchUrl}
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
        <Badge variant={playback.playing ? 'default' : 'outline'} class="shrink-0">
          {playback.playing ? 'Playing' : 'Paused'}
        </Badge>
      </div>

      <p class="m-0 flex items-center gap-2 text-xs text-muted-foreground">
        <span class="font-mono tabular-nums">{positionLabel}</span>
        <span aria-hidden="true">·</span>
        <span>Updated {updatedAtLabel}</span>
      </p>

      <p class="m-0 text-xs text-muted-foreground">
        Last change by
        <span class="font-medium text-foreground">{sourceMemberName}</span>
      </p>
    </CardContent>
  </Card>

  {#if room.members.length}
    <div>
      <p class="mb-2 mt-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {room.members.length} {room.members.length === 1 ? 'member' : 'members'}
      </p>
      <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
        {#each room.members as member (member.id)}
          {@const isMe = member.id === roomMemberId}
          <li>
            <Badge
              variant={isMe ? 'default' : 'outline'}
              class="h-7 max-w-full gap-2 py-1 pl-1 pr-3 text-sm"
              title={member.name}
            >
              <span
                class={[
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  isMe ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-foreground',
                ]}
                aria-hidden="true"
              >
                {member.name.slice(0, 1).toUpperCase()}
              </span>
              <span class="max-w-44 truncate">
                {member.name}{isMe ? ' (you)' : ''}
              </span>
            </Badge>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
