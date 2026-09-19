import {
  ACTIVE_ROOM_EXISTS_ERROR,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  errorMessage,
  normalizeRoomCode,
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

import { getSettings } from '../storage/settings';
import { RealtimeConnection } from './connection.service';
import type { PlaybackUpdateResult } from './playback-sync';
import { SessionLifecycle } from './session-lifecycle';
import {
  clearControlledTab,
  getBackgroundState,
  leaveRoomState,
  markSessionReconnecting,
  reportBackgroundError,
  setControlledTab,
  setJoinedSession,
  updateSessionRoom,
} from './state';

const PARTYKIT_HOST = __DEFAULT_SERVER_URL__;
const ROOM_CODE_ATTEMPTS = 5;

export class PartySessionService {
  private readonly lifecycle = new SessionLifecycle();
  private connection: RealtimeConnection | null = null;
  private sessionVersion = 0;
  private rejoinTask: Promise<void> | null = null;
  private needsRejoin = false;

  constructor(
    private readonly options: {
      onRoomSnapshotChanged: (snapshot: PartySnapshot, receivedAtMs: number) => void;
      onSessionEnded: () => void;
    },
  ) {}

  async updateRoomPlaybackFromControlledTab(update: PlaybackUpdate): Promise<PlaybackUpdateResult> {
    const connection = this.connection;
    try {
      return await this.sendPlaybackUpdate(connection, update);
    } catch (error) {
      if (this.connection !== connection) return { status: 'ignored' };
      const state = await getBackgroundState();
      if (!state.session) return { status: 'ignored' };
      if (state.connectionStatus === 'connected' && connection?.isOpen) {
        await reportBackgroundError(errorMessage(error, 'Unexpected error.'));
      }
      return { status: 'retry' };
    }
  }

  /** Keeps the room socket active so the browser does not suspend it. */
  async heartbeat(): Promise<void> {
    const state = await getBackgroundState();
    if (!state.session || state.connectionStatus !== 'connected') return;

    const connection = this.connection;
    if (!connection?.isOpen) return;

    try {
      await connection.ping();
    } catch {
      // The reconnect handler owns recovery; heartbeat failures are expected.
    }
  }

  resumeStoredSession(): Promise<void> {
    return this.lifecycle.run(() => this.rejoinRoom());
  }

  createRoom(tabId: number, serviceId: ServiceId, playback: PlaybackUpdate): Promise<void> {
    return this.lifecycle.run(async () => {
      await this.assertNoActiveSession();
      await setControlledTab({ tabId });

      try {
        const settings = await getSettings();
        const response = await this.createRoomWithUniqueCode({
          memberName: settings.memberName,
          serviceId,
          initialPlayback: playback,
        });
        await this.applyRoomResponse(response);
      } catch (error) {
        this.closeConnection();
        await clearControlledTab();
        throw error;
      }
    });
  }

  joinRoom(roomCode: string, tabId: number): Promise<void> {
    return this.lifecycle.run(async () => {
      await this.assertNoActiveSession();
      await setControlledTab({ tabId });

      try {
        const settings = await getSettings();
        const normalized = normalizeRoomCode(roomCode);
        const response = this.unwrapAckResponse(
          await this.ensureConnection(normalized).joinRoom({
            roomCode: normalized,
            memberName: settings.memberName,
          }),
        );

        await this.applyRoomResponse(response);
      } catch (error) {
        this.closeConnection();
        await clearControlledTab();
        throw error;
      }
    });
  }

  leaveRoom(): Promise<void> {
    return this.lifecycle.run(async () => {
      this.sessionVersion += 1;
      this.rejoinTask = null;
      this.needsRejoin = false;
      const connection = this.connection;
      this.connection = null;
      this.options.onSessionEnded();
      await leaveRoomState();

      try {
        if (connection?.isOpen) await connection.leaveRoom();
      } catch {
        // Best effort; local departure must not depend on the network.
      } finally {
        connection?.disconnect();
      }
    });
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

  private async sendPlaybackUpdate(
    connection: RealtimeConnection | null,
    update: PlaybackUpdate,
  ): Promise<PlaybackUpdateResult> {
    const state = await getBackgroundState();
    if (!state.session || this.connection !== connection) {
      return { status: 'ignored' };
    }

    if (!connection || state.connectionStatus !== 'connected') {
      return { status: 'retry' };
    }

    const response = await connection.updatePlayback(update);
    const receivedAtMs = performance.now();
    const snapshot = await this.readSessionResponse(connection, response);
    if (!snapshot) return { status: 'ignored' };
    await updateSessionRoom(snapshot);
    return { status: 'accepted', snapshot, receivedAtMs };
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
      if (this.connection !== connection) return;
      this.needsRejoin = true;
      void markSessionReconnecting(roomCode);
    });

    connection.onOpen(() => {
      if (this.connection === connection && this.needsRejoin) void this.resumeStoredSession();
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
    if (!session || this.sessionVersion !== version || this.connection !== previousConnection) {
      return;
    }

    const connection = this.ensureConnection(session.roomCode);
    await markSessionReconnecting(session.roomCode);

    try {
      const settings = await getSettings();
      if (this.connection !== connection) return;
      const response = await this.readSessionResponse(
        connection,
        await connection.joinRoom({
          roomCode: session.roomCode,
          memberName: settings.memberName,
        }),
      );

      if (response && this.connection === connection && connection.isOpen) {
        await this.applyRoomResponse(response);
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
    this.options.onSessionEnded();
    await leaveRoomState(message);
  }

  private async applyRoomResponse(response: RoomResponse): Promise<void> {
    const receivedAtMs = performance.now();
    const connection = this.connection;
    this.needsRejoin = false;

    const nextSession = {
      roomCode: response.snapshot.roomCode,
      memberId: response.memberId,
      serviceId: response.snapshot.serviceId,
    };
    await setJoinedSession(nextSession, response.snapshot);

    if (this.connection === connection) {
      this.options.onRoomSnapshotChanged(response.snapshot, receivedAtMs);
    }
  }

  private async applyIncomingPlaybackSnapshot(snapshot: PartySnapshot): Promise<void> {
    this.options.onRoomSnapshotChanged(snapshot, performance.now());
    await updateSessionRoom(snapshot);
  }

  private closeConnection(): void {
    this.sessionVersion += 1;
    this.rejoinTask = null;
    this.needsRejoin = false;
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

function createRoomCode(): string {
  const values = crypto.getRandomValues(new Uint32Array(ROOM_CODE_LENGTH));
  return Array.from(values, (value) =>
    ROOM_CODE_ALPHABET.charAt(value % ROOM_CODE_ALPHABET.length),
  ).join('');
}
