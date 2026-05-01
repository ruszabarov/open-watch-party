import { Server, type Socket } from "socket.io";
import {
  applyPlaybackUpdate,
  createRoomRequestSchema,
  createRoomState,
  joinRoomRequestSchema,
  leaveRoomRequestSchema,
  normalizeRoomCode,
  playbackUpdateRequestSchema,
  removeRoomMember,
  type ClientToServerEvents,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type OperationResult,
  type PlaybackUpdateRequest,
  type RoomResponse,
  type RoomState,
  type ServerToClientEvents,
  toPartySnapshot,
  upsertRoomMember,
} from "@open-watch-party/shared";

import { logger } from "./logger";
import { createPlaybackUpdateTokenConsumer } from "./rate-limiter";
import {
  createInMemoryRoomStore,
  type RoomStore,
  type RoomStoreRemovalReason,
} from "./room";
import {
  acknowledge as acknowledgeResult,
  failure,
  invalidPayload,
  success,
} from "./utils";
import {
  ACTIVE_ROOM_EXISTS_ERROR,
  PLAYBACK_UPDATE_RATE_LIMIT_ERROR,
  SOCKET_SESSION_REQUIRED_ERROR,
} from "./error";

type ConnectionSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

export type SessionRecord = {
  readonly socketId: string;
  readonly roomCode: string;
  readonly memberId: string;
  allowPlaybackUpdate: () => boolean;
};

const DEFAULT_MAX_ROOMS = 1_000;
const DEFAULT_ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1_000;
const log = logger.child({ scope: "socket" });

export class RealtimeSocketService {
  private readonly roomStore: RoomStore;
  private readonly sessionsBySocket = new Map<string, SessionRecord>();
  private readonly activeSocketByMember = new Map<string, string>();

  constructor(private readonly io: RealtimeServer) {
    this.roomStore = createInMemoryRoomStore({
      maxRooms: DEFAULT_MAX_ROOMS,
      roomIdleTtlMs: DEFAULT_ROOM_IDLE_TTL_MS,
      onRoomRemoved: this.handleRoomRemoved,
    });
  }

  private removeSocketSession(socketId: string): void {
    const session = this.sessionsBySocket.get(socketId);
    if (!session) {
      return;
    }

    this.activeSocketByMember.delete(
      memberKey(session.roomCode, session.memberId),
    );
    this.sessionsBySocket.delete(socketId);
  }

  private readonly handleRoomRemoved = (
    room: RoomState,
    reason: RoomStoreRemovalReason,
  ): void => {
    log.info(
      {
        roomCode: room.roomCode,
        reason,
        memberCount: room.members.size,
      },
      "room:removed",
    );
    this.cleanupRemovedRoom(room.roomCode);
    this.io.socketsLeave(room.roomCode);
  };

  private cleanupRemovedRoom(roomCodeValue: string): void {
    const roomCode = normalizeRoomCode(roomCodeValue);

    for (const [socketId, session] of this.sessionsBySocket.entries()) {
      if (session.roomCode === roomCode) {
        this.sessionsBySocket.delete(socketId);
      }
    }

    for (const key of this.activeSocketByMember.keys()) {
      if (key.startsWith(`${roomCode}:`)) {
        this.activeSocketByMember.delete(key);
      }
    }
  }

  register(): void {
    this.io.on("connection", this.handleConnection);
  }

  readonly handleConnection = (socket: ConnectionSocket): void => {
    log.info({ socketId: socket.id }, "socket:connected");

    socket.on("room:create", (payload, acknowledge) => {
      const result = createRoomRequestSchema.safeParse(payload);
      if (!result.success) {
        acknowledgeResult(acknowledge, invalidPayload);
        return;
      }

      acknowledgeResult(
        acknowledge,
        () => this.createRoom(socket, result.data),
      );
    });

    socket.on("room:join", (payload, acknowledge) => {
      const result = joinRoomRequestSchema.safeParse(payload);
      if (!result.success) {
        acknowledgeResult(acknowledge, invalidPayload);
        return;
      }

      acknowledgeResult(
        acknowledge,
        () => this.joinRoom(socket, result.data),
      );
    });

    socket.on("room:leave", (payload, acknowledge) => {
      const result = leaveRoomRequestSchema.safeParse(payload);
      if (!result.success) {
        acknowledgeResult(acknowledge, invalidPayload);
        return;
      }

      acknowledgeResult(
        acknowledge,
        () => this.leaveCurrentRoom(socket),
      );
    });

    socket.on("playback:update", (payload, acknowledge) => {
      const result = playbackUpdateRequestSchema.safeParse(payload);
      if (!result.success) {
        acknowledgeResult(
          acknowledge,
          invalidPayload,
        );
        return;
      }

      acknowledgeResult(
        acknowledge,
        () => this.updatePlayback(socket, result.data),
      );
    });

    socket.on("disconnect", () => {
      const session = this.sessionsBySocket.get(socket.id);
      if (!session) {
        log.info(
          { socketId: socket.id },
          "socket:disconnected_without_session",
        );
        return;
      }

      log.info(
        {
          socketId: socket.id,
          roomCode: session.roomCode,
          memberId: session.memberId,
        },
        "socket:disconnected",
      );
      const activeSocketId = this.activeSocketByMember.get(
        memberKey(session.roomCode, session.memberId),
      );
      if (activeSocketId !== socket.id) {
        this.sessionsBySocket.delete(socket.id);
        return;
      }

      this.removeSocketSession(socket.id);
      this.leaveRoom(session.roomCode, session.memberId);
    });
  };

  private createRoom(
    socket: ConnectionSocket,
    payload: CreateRoomRequest,
  ): OperationResult<RoomResponse> {
    const roomCode = this.roomStore.generateUniqueRoomCode();
    if (!this.canBindMember(socket.id, roomCode, payload.memberId)) {
      return failure(ACTIVE_ROOM_EXISTS_ERROR);
    }

    const room = createRoomState(roomCode, payload);
    upsertRoomMember(room, payload.memberId, payload.memberName);
    this.roomStore.set(room);

    this.bindSocketSession(socket, room.roomCode, payload.memberId);

    const snapshot = toPartySnapshot(room);
    socket.to(room.roomCode).emit("room:state", snapshot);
    log.info(
      {
        socketId: socket.id,
        roomCode: room.roomCode,
        memberId: payload.memberId,
        memberCount: room.members.size,
        roomCount: this.roomStore.size(),
      },
      "room:create_ok",
    );
    return success({ memberId: payload.memberId, snapshot });
  }

  private joinRoom(
    socket: ConnectionSocket,
    payload: JoinRoomRequest,
  ): OperationResult<RoomResponse> {
    const room = this.roomStore.get(normalizeRoomCode(payload.roomCode));
    if (!room) {
      return failure("Room not found.");
    }

    if (!this.canBindMember(socket.id, payload.roomCode, payload.memberId)) {
      return failure(ACTIVE_ROOM_EXISTS_ERROR);
    }

    upsertRoomMember(room, payload.memberId, payload.memberName);
    this.roomStore.set(room);

    this.bindSocketSession(socket, payload.roomCode, payload.memberId);

    const snapshot = toPartySnapshot(room);
    socket.to(payload.roomCode).emit("room:state", snapshot);
    log.info(
      {
        socketId: socket.id,
        roomCode: payload.roomCode,
        memberId: payload.memberId,
        memberCount: room.members.size,
        roomCount: this.roomStore.size(),
      },
      "room:join_ok",
    );
    return success({ memberId: payload.memberId, snapshot });
  }

  private leaveCurrentRoom(socket: ConnectionSocket): OperationResult<{
    roomCode: string;
  }> {
    const session = this.sessionsBySocket.get(socket.id);
    if (!session) {
      return failure(SOCKET_SESSION_REQUIRED_ERROR);
    }

    this.removeSocketSession(socket.id);
    this.leaveRoom(session.roomCode, session.memberId);
    log.info(
      {
        socketId: socket.id,
        roomCode: session.roomCode,
        memberId: session.memberId,
        roomCount: this.roomStore.size(),
      },
      "room:leave_ok",
    );
    return success({ roomCode: session.roomCode });
  }

  private updatePlayback(
    socket: ConnectionSocket,
    payload: PlaybackUpdateRequest,
  ): OperationResult<ReturnType<typeof toPartySnapshot>> {
    const session = this.sessionsBySocket.get(socket.id);
    if (!session) {
      return failure(SOCKET_SESSION_REQUIRED_ERROR);
    }

    const room = this.roomStore.get(normalizeRoomCode(session.roomCode));
    if (!room) {
      return failure("Room not found.");
    }

    if (!room.members.has(session.memberId)) {
      return failure("Member is not part of this room.");
    }

    if (payload.serviceId !== room.serviceId) {
      return failure("Service mismatch.");
    }

    if (!session.allowPlaybackUpdate()) {
      return failure(PLAYBACK_UPDATE_RATE_LIMIT_ERROR);
    }

    const previousPlayback = room.playback;
    const playback = applyPlaybackUpdate(room, payload, session.memberId);
    const snapshot = toPartySnapshot(room);

    if (playback === previousPlayback) {
      log.debug(
        {
          socketId: socket.id,
          roomCode: room.roomCode,
          memberId: session.memberId,
          mediaId: payload.mediaId,
          clientSequence: payload.clientSequence,
          roomSequence: room.sequence,
        },
        "playback:update_noop",
      );
      return success(snapshot);
    }

    this.roomStore.set(room);
    socket.to(room.roomCode).emit("playback:state", snapshot);
    log.debug(
      {
        socketId: socket.id,
        roomCode: room.roomCode,
        memberId: session.memberId,
        mediaId: playback.mediaId,
        playing: playback.playing,
        positionSec: playback.positionSec,
        playbackSequence: playback.sequence,
        clientSequence: payload.clientSequence,
      },
      "playback:update_ok",
    );
    return success(snapshot);
  }

  private canBindMember(
    socketId: string,
    roomCodeValue: string,
    memberId: string,
  ): boolean {
    const roomCode = normalizeRoomCode(roomCodeValue);
    const socketSession = this.sessionsBySocket.get(socketId);

    if (
      socketSession &&
      (socketSession.roomCode !== roomCode ||
        socketSession.memberId !== memberId)
    ) {
      return false;
    }

    for (const session of this.sessionsBySocket.values()) {
      if (session.memberId === memberId && session.roomCode !== roomCode) {
        return false;
      }
    }

    return true;
  }

  private bindSocketSession(
    socket: ConnectionSocket,
    roomCodeValue: string,
    memberId: string,
  ): void {
    const roomCode = normalizeRoomCode(roomCodeValue);
    const socketId = socket.id;
    const priorSocketId = this.activeSocketByMember.get(
      memberKey(roomCode, memberId),
    );
    const allowPlaybackUpdate =
      this.sessionsBySocket.get(socketId)?.allowPlaybackUpdate ??
      createPlaybackUpdateTokenConsumer();

    if (priorSocketId && priorSocketId !== socketId) {
      log.info(
        {
          roomCode,
          memberId,
          previousSocketId: priorSocketId,
          nextSocketId: socketId,
        },
        "session:duplicate_socket_replaced",
      );
      this.io.sockets.sockets.get(priorSocketId)?.disconnect(true);
      this.sessionsBySocket.delete(priorSocketId);
    }

    this.sessionsBySocket.set(socketId, {
      socketId,
      roomCode,
      memberId,
      allowPlaybackUpdate,
    });
    this.activeSocketByMember.set(memberKey(roomCode, memberId), socketId);
    socket.join(roomCode);
  }

  private leaveRoom(roomCodeValue: string, memberId: string): void {
    const roomCode = normalizeRoomCode(roomCodeValue);
    const room = this.roomStore.get(roomCode);

    if (!room) {
      return;
    }

    removeRoomMember(room, memberId);

    if (room.members.size === 0) {
      log.info({ roomCode, memberId }, "room:remove_empty");
      this.roomStore.delete(roomCode);
      return;
    }

    this.roomStore.set(room);
    this.io.to(roomCode).emit("room:state", toPartySnapshot(room));
    log.info(
      {
        roomCode,
        memberId,
        memberCount: room.members.size,
      },
      "room:member_left",
    );
  }
}

function memberKey(roomCode: string, memberId: string): string {
  return `${roomCode}:${memberId}`;
}
