import { storage } from 'wxt/utils/storage';
import type { PartySnapshot, ServiceId } from '@open-watch-party/shared';

export type SessionInfo = {
  readonly roomCode: string;
  readonly memberId: string;
  readonly serviceId: ServiceId;
};

export type ControlledTabInfo = {
  readonly tabId: number;
  readonly mediaId: string;
};

export type BackgroundState = {
  readonly connectionStatus: 'idle' | 'reconnecting' | 'connected';
  readonly lastInfo: string | null;
  readonly lastInfoSeq: number;
  readonly session: SessionInfo | null;
  readonly room: PartySnapshot | null;
  readonly controlledTab: ControlledTabInfo | null;
  readonly lastError: string | null;
  // Bumped on every reported error so the popup can tell two identical
  // messages apart and re-show one the user already dismissed.
  readonly lastErrorSeq: number;
  readonly lastWarning: string | null;
  readonly lastWarningSeq: number;
};

export const initialBackgroundState: BackgroundState = {
  connectionStatus: 'idle',
  lastInfo: null,
  lastInfoSeq: 0,
  session: null,
  room: null,
  controlledTab: null,
  lastError: null,
  lastErrorSeq: 0,
  lastWarning: null,
  lastWarningSeq: 0,
};

export const backgroundStateItem = storage.defineItem<BackgroundState>('session:watch-party', {
  fallback: initialBackgroundState,
});

export async function getBackgroundState(): Promise<BackgroundState> {
  return backgroundStateItem.getValue();
}

export async function setControlledTab(tab: ControlledTabInfo): Promise<void> {
  return updateBackgroundState((state) => ({
    ...state,
    controlledTab: tab,
  }));
}

export async function clearControlledTab(): Promise<void> {
  return updateBackgroundState((state) => ({
    ...state,
    controlledTab: null,
  }));
}

export async function setJoinedSession(session: SessionInfo, room: PartySnapshot): Promise<void> {
  return updateBackgroundState((state) => ({
    ...state,
    session,
    room,
    connectionStatus: 'connected',
    lastInfo: null,
    lastError: null,
  }));
}

export async function leaveRoomState(message: string | null = null): Promise<void> {
  return updateBackgroundState((state) => ({
    ...initialBackgroundState,
    lastErrorSeq: state.lastErrorSeq,
    lastWarningSeq: state.lastWarningSeq,
    lastInfo: message,
    lastInfoSeq: state.lastInfoSeq + (message === null ? 0 : 1),
  }));
}

export async function markSessionReconnecting(roomCode: string): Promise<void> {
  return updateBackgroundState((state) =>
    state.session?.roomCode === roomCode
      ? {
          ...state,
          connectionStatus: 'reconnecting',
          lastError: null,
        }
      : state,
  );
}

export async function updateSessionRoom(room: PartySnapshot): Promise<void> {
  return updateBackgroundState((state) => {
    if (state.session?.roomCode !== room.roomCode || state.connectionStatus !== 'connected') {
      return state;
    }

    return {
      ...state,
      session: {
        ...state.session,
        roomCode: room.roomCode,
        serviceId: room.serviceId,
      },
      room,
      lastWarning: null,
    };
  });
}

export async function reportBackgroundError(message: string): Promise<void> {
  return updateBackgroundState((state) => ({
    ...state,
    lastError: message,
    lastErrorSeq: state.lastErrorSeq + 1,
  }));
}

export async function setLastWarning(message: string | null): Promise<void> {
  return updateBackgroundState((state) => ({
    ...state,
    lastWarning: message,
    lastWarningSeq: message === null ? state.lastWarningSeq : state.lastWarningSeq + 1,
  }));
}

let backgroundStateWriteQueue = Promise.resolve();

async function updateBackgroundState(
  updater: (state: BackgroundState) => BackgroundState,
): Promise<void> {
  return enqueueBackgroundStateWrite(async () => {
    const current = await getBackgroundState();
    await backgroundStateItem.setValue(updater(current));
  });
}

async function enqueueBackgroundStateWrite(write: () => Promise<void>): Promise<void> {
  const nextWrite = backgroundStateWriteQueue.then(write, write);
  backgroundStateWriteQueue = nextWrite.catch(() => undefined);
  return nextWrite;
}
