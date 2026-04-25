import type { ServiceId } from '@open-watch-party/shared';

export interface ActiveTabSummary {
  tabId: number | null;
  title: string;
  url: string;
  activeServiceId: ServiceId | null;
  isWatchPage: boolean;
}

export interface ServiceContentContext {
  serviceId: ServiceId;
  href: string;
  title: string;
  mediaId?: string;
  mediaTitle: string;
  playbackReady: boolean;
  issue?: string;
}

export interface ApplySnapshotResult {
  applied: boolean;
  reason?: string;
  context: ServiceContentContext | null;
}
