import { defineExtensionMessaging } from '@webext-core/messaging';

import type { PartySnapshot, PlaybackUpdate } from '@watch-party/shared';

import type {
  ApplySnapshotResult,
  PopupState,
  ServiceContentContext,
} from './extension';

export interface ExtensionProtocolMap {
  'content:context': (payload: ServiceContentContext) => void;
  'content:playback-update': (payload: PlaybackUpdate) => void;
  'content:request-sync': () => void;
  'party:request-context': () => ServiceContentContext;
  'party:apply-snapshot': (payload: { snapshot: PartySnapshot }) => ApplySnapshotResult;
  'party:state-updated': (payload: PopupState) => void;
}

export const extensionMessaging = defineExtensionMessaging<ExtensionProtocolMap>();
export const { onMessage, sendMessage } = extensionMessaging;
