import { browser } from 'wxt/browser';
import {
  ACTIVE_ROOM_EXISTS_ERROR,
  createRoomCode,
  normalizeRoomCode,
  ROOM_CODE_TAKEN_ERROR,
} from '@open-watch-party/shared';

import type {
  CreateRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdate,
  RoomClosedEvent,
  RoomClosedReason,
  RoomResponse,
  ServiceId,
} from '@open-watch-party/shared';

import { getErrorMessage } from '~/utils/errors.js';
import { getSettings } from '../storage/settings';
import { RealtimeConnection } from './connection.service';
import {
  getBackgroundState,
  leaveRoomState,
  reportBackgroundError,
  setControlledTab,
  setJoinedSession,
  setLastWarning,
  updateSessionRoom,
} from './state';

const PARTYKIT_HOST = __DEFAULT_SERVER_URL__;
const ROOM_CODE_ATTEMPTS = 5;

export class PartySessionService {
  private connection: RealtimeConnection | null = null;

  constructor(
    private readonly options: {
      onRoomSnapshotChanged: () => void;
    },
  ) {}

  updateRoomPlaybackFromControlledTab(update: PlaybackUpdate): void {
    void this.sendPlaybackUpdate(update).catch((error) => {
      void reportBackgroundError(getErrorMessage(error));
    });
  }

  async resumeStoredSession(): Promise<void> {
    if (!(await getBackgroundState()).session) {
      return;
    }

    await this.rejoinRoom();
  }

  async createRoom(tabId: number, serviceId: ServiceId, playback: PlaybackUpdate): Promise<void> {
    await this.assertNoActiveSession();

    const settings = await getSettings();

    const response = await this.createRoomWithUniqueCode({
      memberId: await this.ensureMemberId(),
      memberName: settings.memberName,
      serviceId,
      initialPlayback: playback,
    });

    await setControlledTab({ tabId, mediaId: playback.mediaId });
    await this.applyRoomResponse(response, true);
  }

  async joinRoom(roomCode: string): Promise<RoomResponse> {
    await this.assertNoActiveSession();
    const settings = await getSettings();

    const normalized = normalizeRoomCode(roomCode);
    const response = this.unwrapAckResponse(
      await this.ensureConnection(normalized).joinRoom({
        roomCode: normalized,
        memberId: await this.ensureMemberId(),
        memberName: settings.memberName,
      }),
    );

    await this.applyRoomResponse(response);
    return response;
  }

  async leaveRoom(): Promise<void> {
    if ((await getBackgroundState()).session && this.connection) {
      try {
        await this.connection.leaveRoom();
      } catch {
        // Best effort.
      }
    }

    this.closeConnection();
    await leaveRoomState();
  }

  // The room code is the PartyKit party id, so it is generated client-side. A
  // collision is astronomically unlikely; if it happens the server rejects the
  // create and we retry with a fresh code.
  private async createRoomWithUniqueCode(payload: CreateRoomRequest): Promise<RoomResponse> {
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt += 1) {
      const result = await this.ensureConnection(createRoomCode()).createRoom(payload);
      if (result.ok || result.error !== ROOM_CODE_TAKEN_ERROR) {
        return this.unwrapAckResponse(result);
      }
    }

    throw new Error('Could not find an available room code. Please try again.');
  }

  private async sendPlaybackUpdate(update: PlaybackUpdate): Promise<void> {
    const state = await getBackgroundState();
    if (!state.session || !this.connection) {
      return;
    }

    const controlledMediaId = state.controlledTab?.mediaId ?? null;
    if (controlledMediaId !== null && controlledMediaId !== update.mediaId) {
      await setLastWarning('Local media no longer matches the active room.');
      return;
    }

    const snapshot = this.unwrapAckResponse(await this.connection.updatePlayback(update));
    await updateSessionRoom(snapshot);
  }

  private async ensureMemberId(): Promise<string> {
    return (
      (await getBackgroundState()).session?.memberId ??
      `${browser.runtime.id}:${crypto.randomUUID()}`
    );
  }

  private async assertNoActiveSession(): Promise<void> {
    if ((await getBackgroundState()).session) {
      throw new Error(ACTIVE_ROOM_EXISTS_ERROR);
    }
  }

  private ensureConnection(roomCode: string): RealtimeConnection {
    if (this.connection?.room === roomCode) {
      return this.connection;
    }

    this.connection?.disconnect();

    const connection = new RealtimeConnection({ host: PARTYKIT_HOST, room: roomCode });
    this.connection = connection;

    connection.onConnectionError((error) => {
      void reportBackgroundError(getErrorMessage(error));
    });

    connection.onReconnect(() => this.rejoinRoom());

    connection.onRoomState((snapshot) => {
      void updateSessionRoom(snapshot);
    });

    connection.onPlaybackState((snapshot) => {
      void this.applyIncomingPlaybackSnapshot(snapshot);
    });

    connection.onRoomClosed((event) => {
      void this.handleRoomClosed(connection, event);
    });

    return connection;
  }

  private async rejoinRoom(): Promise<void> {
    const session = (await getBackgroundState()).session;
    if (!session) {
      return;
    }

    try {
      const settings = await getSettings();
      const response = this.unwrapAckResponse(
        await this.ensureConnection(session.roomCode).joinRoom({
          roomCode: session.roomCode,
          memberId: session.memberId,
          memberName: settings.memberName,
        }),
      );

      await this.applyRoomResponse(response, true);
    } catch (error) {
      await reportBackgroundError(getErrorMessage(error));
    }
  }

  private async handleRoomClosed(
    connection: RealtimeConnection,
    event: RoomClosedEvent,
  ): Promise<void> {
    if (this.connection !== connection) {
      return;
    }

    const session = (await getBackgroundState()).session;
    if (!session || session.roomCode !== event.roomCode) {
      return;
    }

    this.closeConnection();
    await leaveRoomState();
    await reportBackgroundError(roomClosedMessage(event.reason));
  }

  private async applyRoomResponse(
    response: RoomResponse,
    applySnapshotToControlledTab = false,
  ): Promise<void> {
    const nextSession = {
      roomCode: response.snapshot.roomCode,
      memberId: response.memberId,
      serviceId: response.snapshot.serviceId,
    };
    await setJoinedSession(nextSession, response.snapshot);

    if (applySnapshotToControlledTab) {
      this.options.onRoomSnapshotChanged();
    }
  }

  private async applyIncomingPlaybackSnapshot(snapshot: PartySnapshot): Promise<void> {
    await updateSessionRoom(snapshot);
    this.options.onRoomSnapshotChanged();
  }

  private closeConnection(): void {
    this.connection?.disconnect();
    this.connection = null;
  }

  private unwrapAckResponse<T>(response: OperationResult<T>): T {
    if (!response.ok) {
      throw new Error(response.error);
    }
    if (response.data == null) {
      throw new Error('Server returned an empty payload.');
    }

    return response.data;
  }
}

function roomClosedMessage(reason: RoomClosedReason): string {
  switch (reason) {
    case 'evicted':
      return 'The server is at capacity and this room was closed. Please create or join a new one.';
    case 'expired':
      return 'This room was closed due to inactivity.';
  }
}
