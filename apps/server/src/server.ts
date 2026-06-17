import { routePartykitRequest, Server, type Connection } from 'partyserver';
import {
  applyPlaybackUpdate,
  clientMessageSchema,
  createRoomState,
  removeRoomMember,
  ROOM_CODE_TAKEN_ERROR,
  toPartySnapshot,
  upsertRoomMember,
  type ClientMessage,
  type OperationResult,
  type RoomState,
  type ServerMessage,
} from '@open-watch-party/shared';

const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1_000;
const PLAYBACK_TOKENS_PER_SECOND = 10;
const PLAYBACK_BURST_CAPACITY = 20;

const STORAGE_KEY = 'room';

const INVALID_PAYLOAD_ERROR = 'Invalid request payload.';
const SESSION_REQUIRED_ERROR = 'Socket session not found.';
const ROOM_NOT_FOUND_ERROR = 'Room not found.';
const NOT_A_MEMBER_ERROR = 'Member is not part of this room.';
const PLAYBACK_RATE_LIMIT_ERROR = 'Playback update rate limit exceeded.';

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

interface ConnectionState {
  memberId: string;
}

export interface Env {
  main: DurableObjectNamespace<WatchPartyServer>;
}

export class WatchPartyServer extends Server<Env> {
  /** The whole room lives in one Party; rebuilt from storage in onStart. */
  private state: RoomState | null = null;
  /** memberId → id of the connection currently representing that member. */
  private readonly memberConnections = new Map<string, string>();
  /** memberId → playback-update token bucket (survives reconnects). */
  private readonly buckets = new Map<string, TokenBucket>();

  override async onStart(): Promise<void> {
    this.state = (await this.ctx.storage.get<RoomState>(STORAGE_KEY)) ?? null;
  }

  override async onMessage(
    sender: Connection<ConnectionState>,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      if (parsed.rid) {
        this.ack(sender, parsed.rid, failure(INVALID_PAYLOAD_ERROR));
      }
      return;
    }

    const message = parsed.message;
    try {
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
        case 'playback:update':
          await this.handlePlayback(message, sender);
          return;
      }
    } catch (error) {
      this.ack(sender, message.rid, failure(errorMessage(error)));
    }
  }

  override async onClose(
    connection: Connection<ConnectionState>,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.handleDisconnect(connection);
  }

  override async onError(connection: Connection<ConnectionState>, _error: unknown): Promise<void> {
    await this.handleDisconnect(connection);
  }

  override async onAlarm(): Promise<void> {
    const room = this.state ?? (await this.ctx.storage.get<RoomState>(STORAGE_KEY)) ?? null;
    if (room) {
      this.broadcastMessage({
        type: 'room:closed',
        event: { roomCode: room.roomCode, reason: 'expired' },
      });
    }

    for (const connection of this.getConnections()) {
      connection.close();
    }

    this.state = null;
    this.memberConnections.clear();
    this.buckets.clear();
    await this.clearRoom();
  }

  private async handleCreate(
    message: Extract<ClientMessage, { type: 'room:create' }>,
    sender: Connection<ConnectionState>,
  ): Promise<void> {
    if (this.state) {
      this.ack(sender, message.rid, failure(ROOM_CODE_TAKEN_ERROR));
      return;
    }

    const room = createRoomState(this.name, message.payload);
    upsertRoomMember(room, message.payload.memberId, message.payload.memberName);
    this.state = room;
    await this.saveRoom();
    this.trackMember(sender, message.payload.memberId);

    this.ack(
      sender,
      message.rid,
      success({ memberId: message.payload.memberId, snapshot: toPartySnapshot(room) }),
    );
  }

  private async handleJoin(
    message: Extract<ClientMessage, { type: 'room:join' }>,
    sender: Connection<ConnectionState>,
  ): Promise<void> {
    if (!this.state) {
      this.ack(sender, message.rid, failure(ROOM_NOT_FOUND_ERROR));
      return;
    }

    upsertRoomMember(this.state, message.payload.memberId, message.payload.memberName);
    await this.saveRoom();
    this.trackMember(sender, message.payload.memberId);

    const snapshot = toPartySnapshot(this.state);
    this.ack(sender, message.rid, success({ memberId: message.payload.memberId, snapshot }));
    this.broadcastMessage({ type: 'room:state', snapshot }, sender.id);
  }

  private async handleLeave(
    message: Extract<ClientMessage, { type: 'room:leave' }>,
    sender: Connection<ConnectionState>,
  ): Promise<void> {
    const memberId = connectionMemberId(sender);
    if (!memberId || !this.state) {
      this.ack(sender, message.rid, failure(SESSION_REQUIRED_ERROR));
      return;
    }

    const roomCode = this.state.roomCode;
    this.forgetMember(memberId);
    await this.removeMember(memberId);

    this.ack(sender, message.rid, success({ roomCode }));
  }

  private async handlePlayback(
    message: Extract<ClientMessage, { type: 'playback:update' }>,
    sender: Connection<ConnectionState>,
  ): Promise<void> {
    const memberId = connectionMemberId(sender);
    if (!memberId) {
      this.ack(sender, message.rid, failure(SESSION_REQUIRED_ERROR));
      return;
    }

    if (!this.consumeToken(memberId)) {
      this.ack(sender, message.rid, failure(PLAYBACK_RATE_LIMIT_ERROR));
      return;
    }

    if (!this.state) {
      this.ack(sender, message.rid, failure(ROOM_NOT_FOUND_ERROR));
      return;
    }

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

  private async handleDisconnect(connection: Connection<ConnectionState>): Promise<void> {
    const memberId = connectionMemberId(connection);
    if (!memberId) {
      return;
    }

    // A stale disconnect from a connection that was already replaced by a newer
    // one for the same member must not remove the member from the room.
    if (this.memberConnections.get(memberId) !== connection.id) {
      return;
    }

    this.forgetMember(memberId);
    await this.removeMember(memberId);
  }

  private async removeMember(memberId: string): Promise<void> {
    if (!this.state) {
      return;
    }

    removeRoomMember(this.state, memberId);

    if (this.state.members.size === 0) {
      this.state = null;
      await this.clearRoom();
      return;
    }

    await this.saveRoom();
    this.broadcastMessage({ type: 'room:state', snapshot: toPartySnapshot(this.state) });
  }

  private trackMember(connection: Connection<ConnectionState>, memberId: string): void {
    const previousConnectionId = this.memberConnections.get(memberId);
    if (previousConnectionId && previousConnectionId !== connection.id) {
      this.getConnection(previousConnectionId)?.close();
    }

    this.memberConnections.set(memberId, connection.id);
    connection.setState({ memberId } satisfies ConnectionState);

    if (!this.buckets.has(memberId)) {
      this.buckets.set(memberId, { tokens: PLAYBACK_BURST_CAPACITY, updatedAt: Date.now() });
    }
  }

  private forgetMember(memberId: string): void {
    this.memberConnections.delete(memberId);
    this.buckets.delete(memberId);
  }

  private consumeToken(memberId: string): boolean {
    const bucket = this.buckets.get(memberId);
    if (!bucket) {
      return true;
    }

    const now = Date.now();
    const elapsedSec = Math.max(0, (now - bucket.updatedAt) / 1_000);
    bucket.tokens = Math.min(
      PLAYBACK_BURST_CAPACITY,
      bucket.tokens + elapsedSec * PLAYBACK_TOKENS_PER_SECOND,
    );
    bucket.updatedAt = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  private async saveRoom(): Promise<void> {
    if (!this.state) {
      return;
    }

    await this.ctx.storage.put(STORAGE_KEY, this.state);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
  }

  private async clearRoom(): Promise<void> {
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }

  private ack(
    connection: Connection<ConnectionState>,
    rid: string,
    result: OperationResult<unknown>,
  ): void {
    connection.send(JSON.stringify({ type: 'ack', rid, result } satisfies ServerMessage));
  }

  private broadcastMessage(message: ServerMessage, ...without: string[]): void {
    this.broadcast(JSON.stringify(message), without);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

type ParseResult = { ok: true; message: ClientMessage } | { ok: false; rid: string | null };

function parseClientMessage(raw: string | ArrayBuffer): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
  } catch {
    return { ok: false, rid: null };
  }

  const result = clientMessageSchema.safeParse(json);
  if (result.success) {
    return { ok: true, message: result.data };
  }

  return { ok: false, rid: extractRid(json) };
}

function extractRid(json: unknown): string | null {
  if (typeof json === 'object' && json !== null && 'rid' in json) {
    const rid = (json as { rid: unknown }).rid;
    if (typeof rid === 'string') {
      return rid;
    }
  }

  return null;
}

function connectionMemberId(connection: Connection<ConnectionState>): string | null {
  return connection.state?.memberId ?? null;
}

function success<T>(data: T): OperationResult<T> {
  return { ok: true, data };
}

function failure(error: string): OperationResult<never> {
  return { ok: false, error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected server error.';
}
