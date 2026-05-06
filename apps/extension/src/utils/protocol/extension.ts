import type { ServiceId } from '@open-watch-party/shared';

export interface WatchPageContext {
  serviceId: ServiceId;
  mediaId: string;
  title?: string;
}

export type ApplySnapshotResult = { applied: true } | { applied: false; reason?: string };
