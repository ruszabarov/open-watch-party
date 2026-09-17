import { defineExtensionMessaging } from '@webext-core/messaging';

import type { PlaybackUpdate, ServiceId } from '@open-watch-party/shared';

export interface CreateRoomRequest {
  tabId: number;
}

export interface JoinRoomRequest {
  roomCode: string;
  tabId: number;
}

export type WatchReportReason = 'snapshot' | 'play' | 'pause' | 'seek';

export type WatchReport = {
  serviceId: ServiceId;
  mediaId: string;
  title?: string;
  positionSec: number;
  playing: boolean;
  reason: WatchReportReason;
};

export type PlaybackApplyTarget = {
  commandId: string;
  serviceId: ServiceId;
  playback: PlaybackUpdate;
};

export interface ExtensionProtocolMap {
  'content:watch-report': (payload: WatchReport) => void;
  'party:request-watch-report': () => WatchReport | null;
  'party:apply-playback-target': (payload: PlaybackApplyTarget) => void;
  'popup:create-room': (payload: CreateRoomRequest) => void;
  'popup:join-room': (payload: JoinRoomRequest) => void;
  'popup:leave-room': () => void;
}

export const { onMessage, sendMessage } = defineExtensionMessaging<ExtensionProtocolMap>();
