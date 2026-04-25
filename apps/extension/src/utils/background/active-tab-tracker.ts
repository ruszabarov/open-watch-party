import { browser } from 'wxt/browser';
import { createLogger } from '../logger';
import { findPluginByUrl } from '../services/registry';
import { syncPopupState } from './popup-state-item';
import type { BackgroundState } from './state';
import { createEmptyActiveTabSummary } from './state';

type BrowserTab = Parameters<Parameters<typeof browser.tabs.onUpdated.addListener>[0]>[2];
const log = createLogger('background:active-tab');

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
    log.trace({ notify }, 'active_tab:refresh_started');
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab?.id) {
      log.trace('active_tab:missing');
      this.state.activeTab = createEmptyActiveTabSummary();
      if (notify) {
        syncPopupState(this.state);
      }
      return;
    }

    this.state.activeTab = summarizeTab(activeTab);
    log.trace(
      {
        tabId: this.state.activeTab.tabId,
        activeServiceId: this.state.activeTab.activeServiceId,
        isWatchPage: this.state.activeTab.isWatchPage,
        url: this.state.activeTab.url,
      },
      'active_tab:summarized',
    );

    if (notify) {
      syncPopupState(this.state);
    }
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
