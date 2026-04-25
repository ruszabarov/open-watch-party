import { browser } from 'wxt/browser';
import { findPluginByUrl } from '../services/registry';
import { createEmptyActiveTabSummary, syncBackgroundState, type BackgroundState } from './state';

type BrowserTab = Parameters<Parameters<typeof browser.tabs.onUpdated.addListener>[0]>[2];

export class ActiveTabTracker {
  constructor(private readonly state: BackgroundState) {}

  registerEventHandlers(): void {
    browser.tabs.onActivated.addListener(async () => {
      await this.refreshActiveTab();
    });

    browser.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        await this.refreshActiveTab();
      }
    });
  }

  async refreshActiveTab(notify = true): Promise<void> {
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab?.id) {
      this.state.activeTab = createEmptyActiveTabSummary();
      if (notify) {
        syncBackgroundState(this.state);
      }
      return;
    }

    this.state.activeTab = summarizeTab(activeTab);

    if (notify) {
      syncBackgroundState(this.state);
    }
  }

  async requireActiveTabId(): Promise<number> {
    await this.refreshActiveTab(false);
    const tabId = this.state.activeTab.tabId;
    if (tabId == null) {
      throw new Error('Open a browser tab before joining a room.');
    }

    return tabId;
  }
}

function summarizeTab(tab: BrowserTab) {
  const url = tab.url ?? '';
  const classification = findPluginByUrl(url);

  return {
    tabId: tab.id ?? null,
    title: tab.title ?? '',
    url,
    activeServiceId: classification?.plugin.id ?? null,
    isWatchPage: classification?.isWatchPage ?? false,
  };
}
