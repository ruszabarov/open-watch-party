import type { ConnectionStatus, PartySnapshot } from '@open-watch-party/shared';
import { sanitizeMemberName, type ServiceId } from '@open-watch-party/shared';

import {
  DEFAULT_SERVER_URL,
  type ActiveTabSummary,
  type PopupState,
  type ServiceContentContext,
} from '../protocol/extension';

export type SessionInfo = {
  roomCode: string;
  memberId: string;
  serviceId: ServiceId;
  playbackClientSequence: number;
};

export type StoredSettings = {
  memberName: string;
  serverUrl: string;
  session: SessionInfo | null;
};

export type BackgroundState = {
  settings: {
    serverUrl: string;
    memberName: string;
  };
  connectionStatus: ConnectionStatus;
  room: PartySnapshot | null;
  activeTab: ActiveTabSummary;
  controlledTabId: number | null;
  contentContext: ServiceContentContext | null;
  lastError: string | null;
  lastWarning: string | null;
  session: SessionInfo | null;
};

export function createBackgroundState(): BackgroundState {
  return {
    settings: {
      serverUrl: DEFAULT_SERVER_URL,
      memberName: createGuestName(),
    },
    connectionStatus: 'disconnected',
    room: null,
    activeTab: createEmptyActiveTabSummary(),
    controlledTabId: null,
    contentContext: null,
    lastError: null,
    lastWarning: null,
    session: null,
  };
}

export function selectPopupView(state: BackgroundState): PopupState {
  return {
    settings: { ...state.settings },
    connectionStatus: state.connectionStatus,
    room: state.room,
    roomMemberId: state.session?.memberId ?? null,
    activeTab: state.activeTab,
    controlledTabId: state.controlledTabId,
    contentContext: state.contentContext,
    lastError: state.lastError,
    lastWarning: state.lastWarning,
  };
}

export function createEmptyActiveTabSummary(): ActiveTabSummary {
  return {
    tabId: null,
    title: '',
    url: '',
    activeServiceId: null,
    isWatchPage: false,
  };
}

export function normalizeServerUrl(value: string): string {
  return (value || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '') || DEFAULT_SERVER_URL;
}

export function normalizeMemberName(value: string): string {
  return sanitizeMemberName(value);
}

export function createGuestName(): string {
  return `Guest ${Math.floor(Math.random() * 900 + 100)}`;
}
