import { PartySocket } from 'partysocket';
import {
  decodeAckPayload,
  parseServerSocketData,
  partySnapshotSchema,
  roomLeaveResponseSchema,
  roomResponseSchema,
  type ClientMessage,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type OperationResult,
  type PartySnapshot,
  type PlaybackUpdate,
  type RoomClosedEvent,
  type RoomLeaveResponse,
  type RoomResponse,
  type ServerMessage,
} from '@open-watch-party/shared';

const ACK_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;
const SOCKET_OPEN = 1;

type ClientRequest =
  | { type: 'room:create'; payload: CreateRoomRequest }
  | { type: 'room:join'; payload: JoinRoomRequest }
  | { type: 'room:leave' }
  | { type: 'playback:update'; payload: PlaybackUpdate };

type AckResult = Extract<ServerMessage, { type: 'ack' }>['result'];

type PendingRequest = {
  resolve: (result: AckResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class RealtimeConnection {
  readonly room: string;

  private readonly socket: PartySocket;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly reconnectHandlers = new Set<() => void | Promise<void>>();
  private readonly connectionErrorHandlers = new Set<(error: Error) => void>();
  private roomStateHandler: ((snapshot: PartySnapshot) => void) | null = null;
  private playbackStateHandler: ((snapshot: PartySnapshot) => void) | null = null;
  private roomClosedHandler: ((event: RoomClosedEvent) => void) | null = null;
  private hasOpened = false;
  private requestSeq = 0;

  constructor(options: { host: string; room: string }) {
    this.room = options.room;
    this.socket = new PartySocket({ host: options.host, room: options.room });

    this.socket.addEventListener('open', () => {
      if (this.hasOpened) {
        for (const handler of this.reconnectHandlers) {
          void handler();
        }
      } else {
        this.hasOpened = true;
      }
    });

    this.socket.addEventListener('message', (event: MessageEvent<string | ArrayBuffer | Blob>) => {
      this.handleMessage(event.data);
    });

    this.socket.addEventListener('error', () => {
      const error = new Error('Lost connection to the watch party server.');
      for (const handler of this.connectionErrorHandlers) {
        handler(error);
      }
    });
  }

  createRoom(payload: CreateRoomRequest): Promise<OperationResult<RoomResponse>> {
    return this.request({ type: 'room:create', payload }).then((result) =>
      decodeAckPayload(result, roomResponseSchema),
    );
  }

  joinRoom(payload: JoinRoomRequest): Promise<OperationResult<RoomResponse>> {
    return this.request({ type: 'room:join', payload }).then((result) =>
      decodeAckPayload(result, roomResponseSchema),
    );
  }

  leaveRoom(): Promise<OperationResult<RoomLeaveResponse>> {
    return this.request({ type: 'room:leave' }).then((result) =>
      decodeAckPayload(result, roomLeaveResponseSchema),
    );
  }

  updatePlayback(payload: PlaybackUpdate): Promise<OperationResult<PartySnapshot>> {
    return this.request({ type: 'playback:update', payload }).then((result) =>
      decodeAckPayload(result, partySnapshotSchema),
    );
  }

  onRoomState(handler: (snapshot: PartySnapshot) => void): void {
    this.roomStateHandler = handler;
  }

  onPlaybackState(handler: (snapshot: PartySnapshot) => void): void {
    this.playbackStateHandler = handler;
  }

  onRoomClosed(handler: (event: RoomClosedEvent) => void): void {
    this.roomClosedHandler = handler;
  }

  onReconnect(handler: () => void | Promise<void>): void {
    this.reconnectHandlers.add(handler);
  }

  onConnectionError(handler: (error: Error) => void): void {
    this.connectionErrorHandlers.add(handler);
  }

  disconnect(): void {
    this.socket.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed.'));
    }
    this.pending.clear();
  }

  private async request(body: ClientRequest): Promise<AckResult> {
    await this.waitForOpen();

    const rid = `r${(this.requestSeq += 1)}`;
    const envelope: ClientMessage =
      body.type === 'room:leave' ? { type: 'room:leave', rid } : { ...body, rid };

    return new Promise<AckResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error('The server did not respond in time.'));
      }, ACK_TIMEOUT_MS);

      this.pending.set(rid, { resolve, reject, timer });
      this.socket.send(JSON.stringify(envelope));
    });
  }

  private handleMessage(data: string | ArrayBuffer | Blob): void {
    const message = parseServerSocketData(data);
    if (message === null) {
      return;
    }

    switch (message.type) {
      case 'ack': {
        const pending = this.pending.get(message.rid);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(message.rid);
        pending.resolve(message.result);
        return;
      }
      case 'room:state':
        this.roomStateHandler?.(message.snapshot);
        return;
      case 'playback:state':
        this.playbackStateHandler?.(message.snapshot);
        return;
      case 'room:closed':
        this.roomClosedHandler?.(message.event);
        return;
    }
  }

  private waitForOpen(): Promise<void> {
    if (this.socket.readyState === SOCKET_OPEN) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.removeEventListener('open', handleOpen);
        this.socket.removeEventListener('error', handleError);
      };
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('Failed to connect to the watch party server.'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out connecting to the watch party server.'));
      }, CONNECT_TIMEOUT_MS);

      this.socket.addEventListener('open', handleOpen);
      this.socket.addEventListener('error', handleError);
    });
  }
}
