import { io, type Socket } from 'socket.io-client';
import type {
  Acknowledge,
  ClientToServerEvents,
  ConnectionStatus,
  OperationResult,
  PartySnapshot,
  ServerToClientEvents,
} from '@open-watch-party/shared';

const ACK_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;

type RequestEvent = keyof ClientToServerEvents;
type RequestPayload<TEvent extends RequestEvent> = ClientToServerEvents[TEvent] extends (
  payload: infer TPayload,
  acknowledge: Acknowledge<unknown>,
) => void
  ? TPayload
  : never;
type RequestResponse<TEvent extends RequestEvent> = ClientToServerEvents[TEvent] extends (
  payload: unknown,
  acknowledge: Acknowledge<infer TResponse>,
) => void
  ? OperationResult<TResponse>
  : never;
type AckEmitter = {
  emitWithAck<TEvent extends RequestEvent>(
    event: TEvent,
    payload: RequestPayload<TEvent>,
  ): Promise<RequestResponse<TEvent>>;
};

export class RealtimeConnection {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private readonly reconnectHandlers = new Set<() => void | Promise<void>>();
  private readonly statusChangeHandlers = new Set<
    (status: ConnectionStatus, errorMessage?: string) => void
  >();

  private currentStatus: ConnectionStatus = 'connecting';
  private currentErrorMessage: string | undefined;

  constructor(readonly serverUrl: string) {
    this.socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      transports: ['websocket'],
      timeout: CONNECT_TIMEOUT_MS,
    });

    this.socket.on('connect', () => {
      this.setStatus('connected');
    });

    this.socket.io.on('reconnect', () => {
      for (const handler of this.reconnectHandlers) {
        void handler();
      }
    });

    this.socket.on('disconnect', () => {
      this.setStatus(this.socket.active ? 'reconnecting' : 'disconnected');
    });

    this.socket.on('connect_error', (error) => {
      this.setStatus('error', error.message);
    });
  }

  async request<TEvent extends RequestEvent>(
    event: TEvent,
    payload: RequestPayload<TEvent>,
  ): Promise<RequestResponse<TEvent>> {
    await this.waitForConnect();
    const emitter = this.socket.timeout(ACK_TIMEOUT_MS) as AckEmitter;
    return emitter.emitWithAck(event, payload);
  }

  on(event: 'room:state', handler: ServerToClientEvents['room:state']): void;
  on(event: 'playback:state', handler: ServerToClientEvents['playback:state']): void;
  on(event: keyof ServerToClientEvents, handler: (snapshot: PartySnapshot) => void): void {
    this.socket.on(event, handler);
  }

  onReconnect(handler: () => void | Promise<void>): void {
    this.reconnectHandlers.add(handler);
  }

  onStatusChange(handler: (status: ConnectionStatus, errorMessage?: string) => void): void {
    handler(this.currentStatus, this.currentErrorMessage);
    this.statusChangeHandlers.add(handler);
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  private waitForConnect(): Promise<void> {
    if (this.socket.connected) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.socket.off('connect', handleConnect);
        this.socket.off('connect_error', handleConnectError);
      };
      const handleConnect = () => {
        cleanup();
        resolve();
      };
      const handleConnectError = (error: Error) => {
        cleanup();
        reject(error);
      };

      this.socket.once('connect', handleConnect);
      this.socket.once('connect_error', handleConnectError);
    });
  }

  private setStatus(status: ConnectionStatus, errorMessage?: string): void {
    this.currentStatus = status;
    this.currentErrorMessage = errorMessage;
    for (const handler of this.statusChangeHandlers) {
      handler(status, errorMessage);
    }
  }
}
