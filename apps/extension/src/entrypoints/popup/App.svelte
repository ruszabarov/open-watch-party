<script lang="ts">
  import { onMount } from 'svelte';
  import {
    queryActiveTabSummary,
    type ActiveTabSummary,
  } from './active-tab.js';
  import { failureMessage, thrownErrorSchema } from '@open-watch-party/shared';
  import Notice from '~/components/popup/Notice.svelte';
  import PopupContent from './PopupContent.svelte';
  import {
    useBackgroundState,
    useSettingsState,
  } from '../../storage/extension-state.svelte.js';

  const backgroundState = useBackgroundState();
  const settings = useSettingsState();

  let activeTab: ActiveTabSummary | null = $state(null);
  let activeTabError: string | null = $state(null);

  onMount(() => {
    let mounted = true;

    queryActiveTabSummary()
      .then((summary) => {
        if (!mounted) return;
        activeTab = summary;
      })
      .catch((error) => {
        if (!mounted) return;
        activeTabError = failureMessage(
          thrownErrorSchema.safeParse(error),
          'Could not read the active tab.',
        );
      });

    return () => {
      mounted = false;
    };
  });
</script>

<div class="flex max-h-[560px] w-[360px] flex-col bg-background text-sm text-foreground">
  {#if activeTab}
    <PopupContent
      backgroundState={backgroundState.current}
      settings={settings.current}
      {activeTab}
    />
  {:else if activeTabError}
    <main class="p-3">
      <Notice kind="error" message={activeTabError} />
    </main>
  {:else}
    <div class="flex flex-col gap-3 p-3" aria-hidden="true">
      <div class="h-5 w-2/3 animate-pulse rounded-md bg-muted"></div>
      <div class="h-4 w-full animate-pulse rounded-md bg-muted"></div>
      <div class="h-9 w-full animate-pulse rounded-md bg-muted"></div>
    </div>
  {/if}
</div>
