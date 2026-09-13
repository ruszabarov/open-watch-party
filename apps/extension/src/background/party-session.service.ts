import { browser } from 'wxt/browser';
import {
  ACTIVE_ROOM_EXISTS_ERROR,
  createRoomCode,
  failureMessage,
  normalizeRoomCode,
  thrownErrorSchema,
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

import type { WatchReportResult } from '../messaging';
import { getSettings } from '../storage/settings';
import { RealtimeConnection } from './connection.service';
import {
  getBackgroundState,
  leaveRoomState,
  markSessionReconnecting,
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
  private sessionVersion = 0;
  private rejoinTask: Promise<void> | null = null;

  constructor(
    private readonly options: {
      onRoomSnapshotChanged: () => void;
    },
  ) {}

  async updateRoomPlaybackFromControlledTab(update: PlaybackUpdate): Promise<WatchReportResult> {
    const connection = this.connection;
    try {
      return await this.sendPlaybackUpdate(update);
    } catch (error) {
      if (this.connection !== connection) return 'ignored';
      const state = await getBackgroundState();
      if (!state.session) return 'ignored';
      if (state.connectionStatus === 'connected' && connection?.isOpen) {
        await reportBackgroundError(
          failureMessage(thrownErrorSchema.safeParse(error), 'Unexpected error.'),
        );
      }
      return 'retry';
    }
  }

  resumeStoredSession(): Promise<void> {
    return this.rejoinRoom();
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
    this.sessionVersion += 1;
    this.rejoinTask = null;
    const connection = this.connection;
    this.connection = null;
    await leaveRoomState();

    try {
      if (connection?.isOpen) await connection.leaveRoom();
    } catch {
      // Best effort; local departure must not depend on the network.
    } finally {
      connection?.disconnect();
    }
  }

  // The room code is the PartyKit party id, so it is generated client-side. A
  // collision is astronomically unlikely; if it happens the server rejects the
  // create and we retry with a fresh code.
  private async createRoomWithUniqueCode(payload: CreateRoomRequest): Promise<RoomResponse> {
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt += 1) {
      const result = await this.ensureConnection(createRoomCode()).createRoom(payload);
      if (result.ok || result.code !== 'ROOM_CODE_TAKEN') {
        return this.unwrapAckResponse(result);
      }
    }

    throw new Error('Could not find an available room code. Please try again.');
  }

  private async sendPlaybackUpdate(update: PlaybackUpdate): Promise<WatchReportResult> {
    const state = await getBackgroundState();
    if (!state.session) {
      return 'ignored';
    }

    const connection = this.connection;
    if (!connection || state.connectionStatus !== 'connected') {
      return 'retry';
    }

    const controlledMediaId = state.controlledTab?.mediaId ?? null;
    if (controlledMediaId !== null && controlledMediaId !== update.mediaId) {
      await setLastWarning('Local media no longer matches the active room.');
      return 'ignored';
    }

    const snapshot = await this.readSessionResponse(
      connection,
      await connection.updatePlayback(update),
    );
    if (!snapshot) return 'ignored';
    await updateSessionRoom(snapshot);
    return 'accepted';
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

    connection.onDisconnected(() => {
      if (this.connection === connection) void markSessionReconnecting(roomCode);
    });

    connection.onOpen(() => {
      if (this.connection === connection) return this.rejoinRoom();
    });

    connection.onRoomState((snapshot) => {
      if (this.connection === connection) void updateSessionRoom(snapshot);
    });

    connection.onPlaybackState((snapshot) => {
      if (this.connection === connection) void this.applyIncomingPlaybackSnapshot(snapshot);
    });

    connection.onRoomClosed((event) => {
      void this.handleRoomClosed(connection, event);
    });

    return connection;
  }

  private rejoinRoom(): Promise<void> {
    if (this.rejoinTask) return this.rejoinTask;
    const task = this.restoreSession().finally(() => {
      if (this.rejoinTask === task) this.rejoinTask = null;
    });
    this.rejoinTask = task;
    return task;
  }

  private async restoreSession(): Promise<void> {
    const version = this.sessionVersion;
    const previousConnection = this.connection;
    const session = (await getBackgroundState()).session;
    if (!session || this.sessionVersion !== version || this.connection !== previousConnection)
      return;

    const connection = this.ensureConnection(session.roomCode);
    await markSessionReconnecting(session.roomCode);

    try {
      const settings = await getSettings();
      if (this.connection !== connection) return;
      const response = await this.readSessionResponse(
        connection,
        await connection.joinRoom({
          roomCode: session.roomCode,
          memberId: session.memberId,
          memberName: settings.memberName,
        }),
      );

      if (response && this.connection === connection && connection.isOpen) {
        await this.applyRoomResponse(response, true);
      }
    } catch {
      // PartySocket retries transport failures. An open socket with a failed
      // join also needs a fresh connection so session recovery cannot stall.
      if (this.connection === connection) connection.reconnect();
    }
  }

  private async readSessionResponse<T>(
    connection: RealtimeConnection,
    response: OperationResult<T>,
  ): Promise<T | null> {
    if (this.connection !== connection) return null;
    if (!response.ok && response.code === 'ROOM_NOT_FOUND') {
      await this.endSession(connection, 'Your previous watch party has ended.');
      return null;
    }
    return this.unwrapAckResponse(response);
  }

  private async handleRoomClosed(
    connection: RealtimeConnection,
    event: RoomClosedEvent,
  ): Promise<void> {
    if (event.roomCode === connection.room) {
      await this.endSession(connection, roomClosedMessage(event.reason));
    }
  }

  private async endSession(connection: RealtimeConnection, message: string): Promise<void> {
    const session = (await getBackgroundState()).session;
    if (this.connection !== connection || session?.roomCode !== connection.room) return;

    this.closeConnection();
    await leaveRoomState(message);
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
    this.sessionVersion += 1;
    this.rejoinTask = null;
    const connection = this.connection;
    this.connection = null;
    connection?.disconnect();
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
      return 'Your previous watch party has ended due to inactivity.';
  }
}
