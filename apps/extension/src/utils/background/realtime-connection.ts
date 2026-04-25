import { io, type Socket } from 'socket.io-client';
import { match, P } from 'ts-pattern';
import type {
  ClientToServerEvents,
  ConnectionStatus,
  CreateRoomRequest,
  JoinRoomRequest,
  LeaveRoomRequest,
  OperationResult,
  PartySnapshot,
  PlaybackUpdateRequest,
  RoomResponse,
  ServerToClientEvents,
} from '@open-watch-party/shared';

const ACK_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;

type RequestArgs =
  | [event: 'room:create', payload: CreateRoomRequest]
  | [event: 'room:join', payload: JoinRoomRequest]
  | [event: 'room:leave', payload: LeaveRoomRequest]
  | [event: 'playback:update', payload: PlaybackUpdateRequest];

type RequestResult =
  | OperationResult<RoomResponse>
  | OperationResult<{ roomCode: string }>
  | OperationResult<PartySnapshot>;

export class RealtimeConnection {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private readonly reconnectHandlers = new Set<() => void | Promise<void>>();
  private readonly statusChangeHandlers = new Set<
    (status: ConnectionStatus, errorMessage?: string) => void
  >();

  private currentStatus: ConnectionStatus = 'connecting';
  private currentErrorMessage: string | undefined;
  private hasConnectedBefore = false;
  private manuallyDisconnected = false;

  constructor(readonly serverUrl: string) {
    this.socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      const isReconnect = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.setStatus('connected');

      if (isReconnect) {
        for (const handler of this.reconnectHandlers) {
          void handler();
        }
      }
    });

    this.socket.on('disconnect', () => {
      this.setStatus(this.manuallyDisconnected ? 'disconnected' : 'reconnecting');
    });

    this.socket.on('connect_error', (error) => {
      this.setStatus('error', error.message);
    });
  }

  async request(
    event: 'room:create',
    payload: CreateRoomRequest,
  ): Promise<OperationResult<RoomResponse>>;
  async request(
    event: 'room:join',
    payload: JoinRoomRequest,
  ): Promise<OperationResult<RoomResponse>>;
  async request(
    event: 'room:leave',
    payload: LeaveRoomRequest,
  ): Promise<OperationResult<{ roomCode: string }>>;
  async request(
    event: 'playback:update',
    payload: PlaybackUpdateRequest,
  ): Promise<OperationResult<PartySnapshot>>;
  async request(...args: RequestArgs): Promise<RequestResult> {
    await this.waitForConnect();
    return this.dispatchRequest(args);
  }

  on(event: 'room:state', handler: ServerToClientEvents['room:state']): () => void;
  on(event: 'playback:state', handler: ServerToClientEvents['playback:state']): () => void;
  on(event: keyof ServerToClientEvents, handler: (snapshot: PartySnapshot) => void): () => void {
    this.socket.on(event, handler);
    return () => {
      this.socket.off(event, handler);
    };
  }

  onReconnect(handler: () => void | Promise<void>): () => void {
    this.reconnectHandlers.add(handler);
    return () => {
      this.reconnectHandlers.delete(handler);
    };
  }

  onStatusChange(handler: (status: ConnectionStatus, errorMessage?: string) => void): () => void {
    handler(this.currentStatus, this.currentErrorMessage);
    this.statusChangeHandlers.add(handler);
    return () => {
      this.statusChangeHandlers.delete(handler);
    };
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.socket.disconnect();
  }

  private dispatchRequest(args: RequestArgs): Promise<RequestResult> {
    return match(args)
      .returnType<Promise<RequestResult>>()
      .with(['room:create', P.select()], (p) =>
        this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:create', p),
      )
      .with(['room:join', P.select()], (p) =>
        this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:join', p),
      )
      .with(['room:leave', P.select()], (p) =>
        this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:leave', p),
      )
      .with(['playback:update', P.select()], (p) =>
        this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('playback:update', p),
      )
      .exhaustive();
  }

  private waitForConnect(): Promise<void> {
    if (this.socket.connected) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutId);
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
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out connecting to the realtime server.'));
      }, CONNECT_TIMEOUT_MS);

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
