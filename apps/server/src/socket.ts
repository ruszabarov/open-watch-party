import { Server, type Socket } from 'socket.io';
import {
  applyPlaybackUpdate,
  createRoomRequestSchema,
  createRoomState,
  joinRoomRequestSchema,
  normalizeRoomCode,
  playbackUpdateRequestSchema,
  removeRoomMember,
  toPartySnapshot,
  upsertRoomMember,
  type Acknowledge,
  type ClientToServerEvents,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type OperationResult,
  type PartySnapshot,
  type PlaybackUpdate,
  type RoomClosedReason,
  type RoomResponse,
  type ServerToClientEvents,
} from '@open-watch-party/shared';

import {
  ACTIVE_ROOM_EXISTS_ERROR,
  PLAYBACK_UPDATE_RATE_LIMIT_ERROR,
  SOCKET_SESSION_REQUIRED_ERROR,
} from './error';
import { logger } from './logger';
import { createInMemoryRoomStore, type RoomStore, type RoomStoreRemovalReason } from './room.store';
import { SessionRegistry } from './session';
import { acknowledge as acknowledgeResult, failure, invalidPayload, success } from './utils';

type ConnectionSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
type PayloadSchema<TPayload> = {
  safeParse: (payload: unknown) =>
    | {
        success: true;
        data: TPayload;
      }
    | {
        success: false;
      };
};

export type JoinedRoomResult = RoomResponse & {
  readonly roomCode: string;
  readonly replacedSocket?: {
    readonly socketId: string;
    readonly memberId: string;
  };
};

type RoomLeaveResult = {
  readonly roomCode: string;
  readonly remainingSnapshot: PartySnapshot | null;
};

type PlaybackUpdateResult = {
  readonly roomCode: string;
  readonly snapshot: PartySnapshot;
};

const DEFAULT_MAX_ROOMS = 1_000;
const DEFAULT_ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1_000;

const log = logger.child({ scope: 'socket' });

export class RealtimeSocketService {
  private readonly sessions = new SessionRegistry();
  private readonly store: RoomStore;

  constructor(private readonly io: RealtimeServer) {
    this.store = createInMemoryRoomStore({
      maxRooms: DEFAULT_MAX_ROOMS,
      roomIdleTtlMs: DEFAULT_ROOM_IDLE_TTL_MS,
      onRoomRemoved: (room, reason) => {
        log.info(
          { roomCode: room.roomCode, reason, memberCount: room.members.size },
          'room:removed',
        );

        const closedReason = toRoomClosedReason(reason);
        if (closedReason) {
          this.io.to(room.roomCode).emit('room:closed', {
            roomCode: room.roomCode,
            reason: closedReason,
          });
        }
        this.sessions.removeRoom(room.roomCode);
        this.io.socketsLeave(room.roomCode);
      },
    });
  }

  register(): void {
    this.io.on('connection', this.handleConnection);
  }

  readonly handleConnection = (socket: ConnectionSocket): void => {
    log.info({ socketId: socket.id }, 'socket:connected');

    socket.on('room:create', (payload, acknowledge) => {
      this.handleAcknowledgedRequest(payload, acknowledge, createRoomRequestSchema, (request) =>
        this.createRoom(socket, request),
      );
    });

    socket.on('room:join', (payload, acknowledge) => {
      this.handleAcknowledgedRequest(payload, acknowledge, joinRoomRequestSchema, (request) =>
        this.joinRoom(socket, request),
      );
    });

    socket.on('room:leave', (acknowledge) => {
      acknowledgeResult(acknowledge, () => this.leaveCurrentRoom(socket));
    });

    socket.on('playback:update', (payload, acknowledge) => {
      this.handleAcknowledgedRequest(payload, acknowledge, playbackUpdateRequestSchema, (request) =>
        this.updatePlayback(socket, request),
      );
    });

    socket.on('disconnect', () => {
      const session = this.sessions.get(socket.id);
      if (!session) {
        log.info({ socketId: socket.id }, 'socket:disconnected_without_session');
        return;
      }

      log.info(
        {
          socketId: socket.id,
          roomCode: session.roomCode,
          memberId: session.memberId,
        },
        'socket:disconnected',
      );

      if (!this.sessions.isActiveSocket(session)) {
        this.sessions.remove(socket.id);
        return;
      }

      this.sessions.remove(socket.id);
      const result = this.removeMemberFromRoom(session.roomCode, session.memberId);
      this.broadcastRoomState(result);
    });
  };

  private handleAcknowledgedRequest<TPayload, TResponse>(
    payload: unknown,
    acknowledge: Acknowledge<TResponse>,
    schema: PayloadSchema<TPayload>,
    operation: (payload: TPayload) => OperationResult<TResponse>,
  ): void {
    const result = schema.safeParse(payload);
    if (!result.success) {
      acknowledgeResult(acknowledge, invalidPayload);
      return;
    }

    acknowledgeResult(acknowledge, () => operation(result.data));
  }

  private createRoom(
    socket: ConnectionSocket,
    payload: CreateRoomRequest,
  ): OperationResult<RoomResponse> {
    const roomResult = this.openRoom(payload);
    if (!roomResult.ok) {
      return roomResult;
    }

    const roomCode = roomResult.data.snapshot.roomCode;
    if (!this.sessions.canBindMember(socket.id, roomCode, payload.memberId)) {
      this.removeMemberFromRoom(roomCode, payload.memberId);
      return failure(ACTIVE_ROOM_EXISTS_ERROR);
    }

    const binding = this.sessions.bind(socket.id, roomCode, payload.memberId);
    const joined = mergeJoinedRoom(roomResult.data, binding, payload.memberId);
    this.joinSocketToRoom(socket, joined);

    return success({
      memberId: joined.memberId,
      snapshot: joined.snapshot,
    });
  }

  private joinRoom(
    socket: ConnectionSocket,
    payload: JoinRoomRequest,
  ): OperationResult<RoomResponse> {
    if (!this.sessions.canBindMember(socket.id, payload.roomCode, payload.memberId)) {
      return failure(ACTIVE_ROOM_EXISTS_ERROR);
    }

    const roomResult = this.addMemberToRoom(payload);
    if (!roomResult.ok) {
      return roomResult;
    }

    const binding = this.sessions.bind(socket.id, payload.roomCode, payload.memberId);
    const joined = mergeJoinedRoom(roomResult.data, binding, payload.memberId);
    this.joinSocketToRoom(socket, joined);

    return success({
      memberId: joined.memberId,
      snapshot: joined.snapshot,
    });
  }

  private leaveCurrentRoom(socket: ConnectionSocket): OperationResult<{ roomCode: string }> {
    const session = this.sessions.remove(socket.id);
    if (!session) {
      return failure(SOCKET_SESSION_REQUIRED_ERROR);
    }

    const result = this.removeMemberFromRoom(session.roomCode, session.memberId);
    log.info(
      {
        socketId: socket.id,
        roomCode: session.roomCode,
        memberId: session.memberId,
      },
      'room:leave_ok',
    );

    this.broadcastRoomState(result);
    return success({ roomCode: result.roomCode });
  }

  private updatePlayback(
    socket: ConnectionSocket,
    payload: PlaybackUpdate,
  ): OperationResult<PartySnapshot> {
    const session = this.sessions.get(socket.id);
    if (!session) {
      return failure(SOCKET_SESSION_REQUIRED_ERROR);
    }

    if (!session.allowPlaybackUpdate()) {
      return failure(PLAYBACK_UPDATE_RATE_LIMIT_ERROR);
    }

    const result = this.applyRoomPlayback(session.roomCode, session.memberId, payload);
    if (!result.ok) {
      return result;
    }

    socket.to(result.data.roomCode).emit('playback:state', result.data.snapshot);

    return success(result.data.snapshot);
  }

  // --- Room state (formerly RoomService) -----------------------------------

  private openRoom(payload: CreateRoomRequest): OperationResult<RoomResponse> {
    const roomCode = this.store.generateUniqueRoomCode();
    const room = createRoomState(roomCode, payload);
    upsertRoomMember(room, payload.memberId, payload.memberName);
    this.store.set(room);

    const snapshot = toPartySnapshot(room);
    log.info(
      { roomCode, memberId: payload.memberId, roomCount: this.store.size() },
      'room:create_ok',
    );

    return success({ memberId: payload.memberId, snapshot });
  }

  private addMemberToRoom(payload: JoinRoomRequest): OperationResult<RoomResponse> {
    const room = this.store.get(normalizeRoomCode(payload.roomCode));
    if (!room) {
      return failure('Room not found.');
    }

    upsertRoomMember(room, payload.memberId, payload.memberName);
    this.store.set(room);

    const snapshot = toPartySnapshot(room);
    log.info(
      { roomCode: payload.roomCode, memberId: payload.memberId, memberCount: room.members.size },
      'room:join_ok',
    );

    return success({ memberId: payload.memberId, snapshot });
  }

  private removeMemberFromRoom(roomCodeValue: string, memberId: string): RoomLeaveResult {
    const roomCode = normalizeRoomCode(roomCodeValue);
    const room = this.store.get(roomCode);
    if (!room) {
      return { roomCode, remainingSnapshot: null };
    }

    removeRoomMember(room, memberId);

    if (room.members.size === 0) {
      log.info({ roomCode, memberId }, 'room:remove_empty');
      this.store.delete(roomCode);
      return { roomCode, remainingSnapshot: null };
    }

    this.store.set(room);
    log.info({ roomCode, memberId, memberCount: room.members.size }, 'room:member_left');

    return { roomCode, remainingSnapshot: toPartySnapshot(room) };
  }

  private applyRoomPlayback(
    roomCodeValue: string,
    memberId: string,
    payload: PlaybackUpdate,
  ): OperationResult<PlaybackUpdateResult> {
    const room = this.store.get(normalizeRoomCode(roomCodeValue));
    if (!room) {
      return failure('Room not found.');
    }

    if (!room.members.has(memberId)) {
      return failure('Member is not part of this room.');
    }

    applyPlaybackUpdate(room, payload, memberId);
    this.store.set(room);

    return success({ roomCode: room.roomCode, snapshot: toPartySnapshot(room) });
  }

  // --- Socket plumbing ------------------------------------------------------

  private joinSocketToRoom(socket: ConnectionSocket, result: JoinedRoomResult): void {
    if (result.replacedSocket) {
      this.disconnectReplacedSocket(socket.id, result.roomCode, result.replacedSocket);
    }

    socket.join(result.roomCode);
    socket.to(result.roomCode).emit('room:state', result.snapshot);
  }

  private broadcastRoomState(result: RoomLeaveResult): void {
    if (result.remainingSnapshot) {
      this.io.to(result.roomCode).emit('room:state', result.remainingSnapshot);
    }
  }

  private disconnectReplacedSocket(
    nextSocketId: string,
    roomCode: string,
    replacedSocket: NonNullable<JoinedRoomResult['replacedSocket']>,
  ): void {
    log.info(
      {
        roomCode,
        memberId: replacedSocket.memberId,
        previousSocketId: replacedSocket.socketId,
        nextSocketId,
      },
      'session:duplicate_socket_replaced',
    );
    this.io.sockets.sockets.get(replacedSocket.socketId)?.disconnect(true);
  }
}

function toRoomClosedReason(reason: RoomStoreRemovalReason): RoomClosedReason | null {
  switch (reason) {
    case 'evict':
      return 'evicted';
    case 'expire':
      return 'expired';
    default:
      return null;
  }
}

function mergeJoinedRoom(
  response: RoomResponse,
  binding: { readonly roomCode: string; readonly replacedSocketId?: string },
  memberId: string,
): JoinedRoomResult {
  if (!binding.replacedSocketId) {
    return {
      memberId: response.memberId,
      roomCode: binding.roomCode,
      snapshot: response.snapshot,
    };
  }

  return {
    memberId: response.memberId,
    roomCode: binding.roomCode,
    snapshot: response.snapshot,
    replacedSocket: {
      socketId: binding.replacedSocketId,
      memberId,
    },
  };
}
