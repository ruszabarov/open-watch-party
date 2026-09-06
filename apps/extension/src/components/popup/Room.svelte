<script lang="ts">
  import type { BackgroundState } from '~/background/state';

  interface Props {
    popup: BackgroundState;
  }

  const { popup }: Props = $props();

  const room = $derived(popup.room!);
  const roomMemberId = $derived(popup.session?.memberId ?? null);
</script>

{#if room.members.length}
  <section aria-label="Members">
    <p class="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      Members
    </p>
    <div class="flex flex-wrap gap-1.5">
      {#each room.members as member (member.id)}
        {@const isMe = member.id === roomMemberId}
        <span
          class="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted py-1 pr-3 pl-1 text-xs font-medium text-foreground"
        >
          <span
            class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-[10px] font-bold"
            aria-hidden="true"
          >
            {(isMe ? 'You' : member.name).slice(0, 1).toUpperCase()}
          </span>
          <span class="truncate">{isMe ? 'You' : member.name}</span>
        </span>
      {/each}
    </div>
  </section>
{/if}
