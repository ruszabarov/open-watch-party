import { PartySocket } from 'partysocket';
import type {
  CreateRoomRequest,
  JoinRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdate,
  RoomClosedEvent,
  RoomResponse,
  ServerMessage,
} from '@open-watch-party/shared';

const ACK_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;
// WebSocket.OPEN
const SOCKET_OPEN = 1;

type PendingRequest = {
  resolve: (result: OperationResult<unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Wraps a PartySocket bound to a single room (the PartyKit party id) and layers
 * a request/response protocol on top of the raw WebSocket: each request carries
 * a correlation id the server echoes back in its `ack`.
 */
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

    this.socket.addEventListener('message', (event: MessageEvent) => {
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
    return this.request<RoomResponse>('room:create', payload);
  }

  joinRoom(payload: JoinRoomRequest): Promise<OperationResult<RoomResponse>> {
    return this.request<RoomResponse>('room:join', payload);
  }

  leaveRoom(): Promise<OperationResult<{ roomCode: string }>> {
    return this.request<{ roomCode: string }>('room:leave');
  }

  updatePlayback(payload: PlaybackUpdate): Promise<OperationResult<PartySnapshot>> {
    return this.request<PartySnapshot>('playback:update', payload);
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

  private async request<T>(type: string, payload?: unknown): Promise<OperationResult<T>> {
    await this.waitForOpen();

    const rid = `r${(this.requestSeq += 1)}`;
    return new Promise<OperationResult<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error('The server did not respond in time.'));
      }, ACK_TIMEOUT_MS);

      this.pending.set(rid, {
        resolve: resolve as (result: OperationResult<unknown>) => void,
        reject,
        timer,
      });

      const frame = payload === undefined ? { type, rid } : { type, rid, payload };
      this.socket.send(JSON.stringify(frame));
    });
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') {
      return;
    }

    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
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
