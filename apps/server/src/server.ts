import { routePartykitRequest, Server, type Connection } from 'partyserver';
import {
  applyPlaybackUpdate,
  createRoomState,
  errorMessage,
  isValidRoomCode,
  parseClientSocketMessage,
  removeRoomMember,
  ROOM_CODE_TAKEN_ERROR,
  ROOM_IDLE_TTL_MS,
  roomStateSchema,
  toPartySnapshot,
  upsertRoomMember,
  MAX_CLIENT_MESSAGE_LENGTH,
  type ClientMessage,
  type OperationResult,
  type OperationFailure,
  type PartySnapshot,
  type RoomLeaveResponse,
  type RoomResponse,
  type RoomState,
  type ServerEvent,
} from '@open-watch-party/shared';
import {
  canReceiveRoomEvent,
  createSessionState,
  MAX_JOIN_ATTEMPTS,
  MAX_ROOM_MEMBERS,
  nextRoomAlarm,
  ROOM_DEPARTURE_TTL_MS,
  type SessionState,
} from './limits';

const STORAGE_KEY = 'room';

const INVALID_PAYLOAD_ERROR = 'Invalid request payload.';
const MESSAGE_TOO_LARGE_ERROR = 'Message too large.';
const SESSION_REQUIRED_ERROR = 'Socket session not found.';
const ROOM_NOT_FOUND_ERROR = 'Room not found.';
const NOT_A_MEMBER_ERROR = 'Member is not part of this room.';
const ROOM_FULL_ERROR = 'This watch party is full.';
const TOO_MANY_JOINS_ERROR = 'Too many join attempts.';

export interface Env {
  main: DurableObjectNamespace<WatchPartyServer>;
}

export class WatchPartyServer extends Server<Env> {
  // Cloudflare recommends WebSocket hibernation for idle-capable objects. All
  // per-connection state lives in the connection attachment and the room is
  // reloaded from storage in onStart, so nothing depends on in-memory maps.
  static override options = { hibernate: true };

  private state: RoomState | null = null;

  override async onStart(): Promise<void> {
    this.state = await this.readStoredRoom();
  }

  override async onConnect(connection: Connection<SessionState>): Promise<void> {
    const now = Date.now();
    connection.setState(createSessionState(now));

    if (this.connectionCount() > MAX_ROOM_MEMBERS) {
      logEvent('connection_rejected', { reason: 'room_full' });
      connection.close(1013, ROOM_FULL_ERROR);
      return;
    }

    await this.scheduleAlarm();
    logEvent('connection_opened');
  }

  override async onMessage(
    sender: Connection<SessionState>,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const size = typeof raw === 'string' ? raw.length : raw.byteLength;
    if (size > MAX_CLIENT_MESSAGE_LENGTH) {
      logEvent('message_rejected', { reason: 'too_large', size });
      sender.close(1009, MESSAGE_TOO_LARGE_ERROR);
      return;
    }

    const parsed = parseClientSocketMessage(raw);
    if (!parsed.ok) {
      logEvent('message_rejected', { reason: 'unparsable' });
      if (parsed.rid) {
        this.ack(sender, parsed.rid, failure(INVALID_PAYLOAD_ERROR));
      }
      return;
    }

    const message = parsed.message;
    try {
      if (this.state && this.state.expiresAt <= Date.now()) {
        await this.expireRoom();
      }

      switch (message.type) {
        case 'room:create':
          await this.handleCreate(message, sender);
          return;
        case 'room:join':
          await this.handleJoin(message, sender);
          return;
        case 'room:leave':
          await this.handleLeave(message, sender);
          return;
        case 'room:heartbeat':
          this.handleHeartbeat(message, sender);
          return;
        case 'playback:update':
          await this.handlePlayback(message, sender);
          return;
      }
    } catch (error) {
      logEvent('message_failed', { type: message.type, error: errorMessage(error, 'unknown') });
      this.ack(sender, message.rid, failure(errorMessage(error, 'Unexpected server error.')));
    }
  }

  override async onClose(connection: Connection<SessionState>): Promise<void> {
    await this.handleDisconnect(connection);
  }

  override async onError(connection: Connection<SessionState>): Promise<void> {
    await this.handleDisconnect(connection);
  }

  override async onAlarm(): Promise<void> {
    const now = Date.now();

    if (this.state && this.state.expiresAt <= now) {
      await this.expireRoom();
      return;
    }

    let closedUnjoined = false;
    for (const connection of this.getConnections<SessionState>()) {
      const session = connection.state;
      if (session && session.memberId === null && session.joinDeadline <= now) {
        connection.close(1008, 'Join timed out');
        closedUnjoined = true;
      }
    }

    if (closedUnjoined) logEvent('connections_timed_out');
    await this.scheduleAlarm();
  }

  private async expireRoom(): Promise<void> {
    const room = this.state;
    if (room) {
      logEvent('room_expired', { roomCode: room.roomCode });
      this.broadcastMessage({
        type: 'room:closed',
        event: { roomCode: room.roomCode, reason: 'expired' },
      });
    }

    await this.clearRoom();
    this.state = null;

    for (const connection of this.getConnections<SessionState>()) {
      connection.close(1001, 'Room expired');
    }
  }

  private async handleCreate(
    message: Extract<ClientMessage, { type: 'room:create' }>,
    sender: Connection<SessionState>,
  ): Promise<void> {
    if (this.state) {
      this.ack(sender, message.rid, failure(ROOM_CODE_TAKEN_ERROR, 'ROOM_CODE_TAKEN'));
      return;
    }

    const memberId = crypto.randomUUID();
    const room = createRoomState(this.name, message.payload, memberId);
    upsertRoomMember(room, memberId, message.payload.memberName);
    this.state = room;
    await this.saveRoom();
    this.markJoined(sender, memberId);
    logEvent('room_created', { roomCode: room.roomCode });

    this.ack(sender, message.rid, success({ memberId, snapshot: toPartySnapshot(room) }));
  }

  private async handleJoin(
    message: Extract<ClientMessage, { type: 'room:join' }>,
    sender: Connection<SessionState>,
  ): Promise<void> {
    if (!this.state) {
      this.ack(sender, message.rid, failure(ROOM_NOT_FOUND_ERROR, 'ROOM_NOT_FOUND'));
      return;
    }

    const session = sender.state ?? createSessionState(Date.now());
    const joinAttempts = session.joinAttempts + 1;
    sender.setState({ ...session, joinAttempts });

    if (joinAttempts > MAX_JOIN_ATTEMPTS) {
      logEvent('join_rejected', { reason: 'too_many_attempts' });
      sender.close(1008, TOO_MANY_JOINS_ERROR);
      return;
    }

    // A connection owns exactly one identity. A repeated join replaces the
    // previous membership instead of leaving a phantom behind, so it does not
    // consume an extra member slot.
    const isReplacing = session.memberId != null && this.state.members.has(session.memberId);
    if (!isReplacing && this.state.members.size >= MAX_ROOM_MEMBERS) {
      this.ack(sender, message.rid, failure(ROOM_FULL_ERROR));
      return;
    }
    if (session.memberId) {
      removeRoomMember(this.state, session.memberId);
    }

    const memberId = crypto.randomUUID();
    upsertRoomMember(this.state, memberId, message.payload.memberName);
    await this.saveRoom();
    this.markJoined(sender, memberId);

    const snapshot = toPartySnapshot(this.state);
    this.ack(sender, message.rid, success({ memberId, snapshot }));
    this.broadcastMessage({ type: 'room:state', snapshot }, sender.id);
  }

  private async handleLeave(
    message: Extract<ClientMessage, { type: 'room:leave' }>,
    sender: Connection<SessionState>,
  ): Promise<void> {
    const session = sender.state;
    if (!session?.memberId || !this.state) {
      this.ack(sender, message.rid, failure(SESSION_REQUIRED_ERROR));
      return;
    }

    const roomCode = this.state.roomCode;
    await this.removeMember(session.memberId);
    sender.setState({ ...session, memberId: null });

    this.ack(sender, message.rid, success({ roomCode }));
  }

  private handleHeartbeat(
    message: Extract<ClientMessage, { type: 'room:heartbeat' }>,
    sender: Connection<SessionState>,
  ): void {
    const session = sender.state;
    if (!session?.memberId || !this.state?.members.has(session.memberId)) {
      this.ack(sender, message.rid, failure(SESSION_REQUIRED_ERROR));
      return;
    }

    this.ack(sender, message.rid, success(null));
  }

  private async handlePlayback(
    message: Extract<ClientMessage, { type: 'playback:update' }>,
    sender: Connection<SessionState>,
  ): Promise<void> {
    const session = sender.state;
    if (!session?.memberId) {
      this.ack(sender, message.rid, failure(SESSION_REQUIRED_ERROR));
      return;
    }

    if (!this.state) {
      this.ack(sender, message.rid, failure(ROOM_NOT_FOUND_ERROR, 'ROOM_NOT_FOUND'));
      return;
    }

    const memberId = session.memberId;
    if (!this.state.members.has(memberId)) {
      this.ack(sender, message.rid, failure(NOT_A_MEMBER_ERROR));
      return;
    }

    applyPlaybackUpdate(this.state, message.payload, memberId);
    await this.saveRoom();

    const snapshot = toPartySnapshot(this.state);
    this.ack(sender, message.rid, success(snapshot));
    this.broadcastMessage({ type: 'playback:state', snapshot }, sender.id);
  }

  private async handleDisconnect(connection: Connection<SessionState>): Promise<void> {
    const session = connection.state;
    if (session?.memberId) {
      await this.removeMember(session.memberId);
    }

    logEvent('connection_closed', { joined: session?.memberId != null });
    await this.scheduleAlarm();
  }

  private async removeMember(memberId: string): Promise<void> {
    if (!this.state) {
      return;
    }

    removeRoomMember(this.state, memberId);
    await this.saveRoom();
    this.broadcastMessage({ type: 'room:state', snapshot: toPartySnapshot(this.state) });
  }

  private markJoined(connection: Connection<SessionState>, memberId: string): void {
    connection.setState((previous) => ({
      ...(previous ?? createSessionState(Date.now())),
      memberId,
    }));
  }

  private connectionCount(): number {
    let count = 0;
    for (const _ of this.getConnections<SessionState>()) count += 1;
    return count;
  }

  private async readStoredRoom(): Promise<RoomState | null> {
    const parsed = roomStateSchema.safeParse(await this.ctx.storage.get(STORAGE_KEY));
    return parsed.success ? parsed.data : null;
  }

  private async saveRoom(): Promise<void> {
    if (!this.state) {
      return;
    }

    const room = this.state;
    room.expiresAt =
      Date.now() + (room.members.size === 0 ? ROOM_DEPARTURE_TTL_MS : ROOM_IDLE_TTL_MS);
    await this.ctx.storage.transaction(async (storage) => {
      await storage.put(STORAGE_KEY, room);
    });
    await this.scheduleAlarm();
  }

  private async clearRoom(): Promise<void> {
    await this.ctx.storage.transaction(async (storage) => {
      await storage.delete(STORAGE_KEY);
      await storage.deleteAlarm();
    });
  }

  private async scheduleAlarm(): Promise<void> {
    const joinDeadlines: number[] = [];
    for (const connection of this.getConnections<SessionState>()) {
      const session = connection.state;
      if (session && session.memberId === null) joinDeadlines.push(session.joinDeadline);
    }

    const next = nextRoomAlarm(this.state?.expiresAt, joinDeadlines);
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(next);
  }

  private ack(
    connection: Connection<SessionState>,
    rid: string,
    result: OperationResult<RoomResponse | PartySnapshot | RoomLeaveResponse | null>,
  ): void {
    connection.send(JSON.stringify({ type: 'ack', rid, result }));
  }

  private broadcastMessage(message: ServerEvent, ...without: string[]): void {
    const text = JSON.stringify(message);
    for (const connection of this.getConnections<SessionState>()) {
      const session = connection.state;
      const isMember =
        session?.memberId != null && (this.state?.members.has(session.memberId) ?? false);
      if (!canReceiveRoomEvent(session, isMember, connection.id, without)) continue;
      connection.send(text);
    }
  }
}

function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export default {
  async fetch(request, env): Promise<Response> {
    const roomCode = roomCodeFromPath(new URL(request.url).pathname);
    if (roomCode !== null && !isValidRoomCode(roomCode)) {
      return new Response('Invalid room code', { status: 400 });
    }

    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function roomCodeFromPath(pathname: string): string | null {
  return pathname.match(/^\/parties\/[^/]+\/([^/]+)\/?$/)?.[1] ?? null;
}

function success<T>(data: T): OperationResult<T> {
  return { ok: true, data };
}

function failure(
  error: string,
  code: OperationFailure['code'] = 'REQUEST_FAILED',
): OperationResult<never> {
  return { ok: false, code, error };
}
