import { defineExtensionMessaging } from '@webext-core/messaging';

import type { PartySnapshot, PlaybackUpdateDraft } from '@open-watch-party/shared';

import type { ApplySnapshotResult, WatchPageContext } from './extension';

export interface ExtensionProtocolMap {
  'content:context': (payload: WatchPageContext | null) => void;
  'content:playback-update': (payload: PlaybackUpdateDraft) => void;
  'party:request-context': () => WatchPageContext | null;
  'party:request-playback': () => PlaybackUpdateDraft | null;
  'party:apply-snapshot': (payload: { snapshot: PartySnapshot }) => ApplySnapshotResult;
  'popup:create-room': (payload: { tabId: number }) => void;
  'popup:join-room': (payload: { roomCode: string; tabId: number }) => void;
  'popup:leave-room': () => void;
  'popup:update-settings': (payload: { memberName: string }) => void;
}

export const { onMessage, sendMessage } = defineExtensionMessaging<ExtensionProtocolMap>();
