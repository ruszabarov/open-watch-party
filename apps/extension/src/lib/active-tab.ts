import { browser, type Browser } from 'wxt/browser';
import type { ServiceId } from '@open-watch-party/shared';
import { findServiceByUrl } from './services/registry';

type BrowserTab = Browser.tabs.Tab | undefined;

export interface ActiveTabSummary {
  tabId: number | null;
  title: string;
  activeServiceId: ServiceId | null;
  isWatchPage: boolean;
}

export async function queryActiveTabSummary(): Promise<ActiveTabSummary> {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  return summarizeActiveTab(activeTab);
}

export function createEmptyActiveTabSummary(): ActiveTabSummary {
  return {
    tabId: null,
    title: '',
    activeServiceId: null,
    isWatchPage: false,
  };
}

function summarizeActiveTab(tab: BrowserTab): ActiveTabSummary {
  if (!tab?.id) {
    return createEmptyActiveTabSummary();
  }

  const url = tab.url ?? '';
  const classification = findServiceByUrl(url);

  return {
    tabId: tab.id,
    title: tab.title ?? '',
    activeServiceId: classification?.serviceId ?? null,
    isWatchPage: classification?.isWatchPage ?? false,
  };
}
