<script lang="ts">
    import { onMount } from "svelte";
    import {
        queryActiveTabSummary,
        type ActiveTabSummary,
    } from "./active-tab.js";
    import { failureMessage, thrownErrorSchema } from "@open-watch-party/shared";
    import Notice from "~/components/popup/Notice.svelte";
    import PopupContent from "./PopupContent.svelte";
    import {
        useBackgroundState,
        useSettingsState,
    } from "../../storage/extension-state.svelte.js";

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
                    "Could not read the active tab.",
                );
            });

        return () => {
            mounted = false;
        };
    });
</script>

<div class="flex w-90 flex-col overflow-hidden bg-muted/40 text-foreground">
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
    {/if}
</div>
