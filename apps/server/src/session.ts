import { normalizeRoomCode } from '@open-watch-party/shared';

import { createPlaybackUpdateTokenConsumer } from './rate-limiter';

export type SessionRecord = {
  readonly socketId: string;
  readonly roomCode: string;
  readonly memberId: string;
  allowPlaybackUpdate: () => boolean;
};

export class SessionRegistry {
  private readonly sessionsBySocket = new Map<string, SessionRecord>();
  private readonly activeSocketByMember = new Map<string, string>();

  get(socketId: string): SessionRecord | undefined {
    return this.sessionsBySocket.get(socketId);
  }

  remove(socketId: string): SessionRecord | undefined {
    const session = this.sessionsBySocket.get(socketId);
    if (!session) {
      return undefined;
    }

    const key = memberKey(session.roomCode, session.memberId);
    if (this.activeSocketByMember.get(key) === socketId) {
      this.activeSocketByMember.delete(key);
    }

    this.sessionsBySocket.delete(socketId);
    return session;
  }

  removeRoom(roomCodeValue: string): void {
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

  canBindMember(socketId: string, roomCodeValue: string, memberId: string): boolean {
    const roomCode = normalizeRoomCode(roomCodeValue);
    const socketSession = this.sessionsBySocket.get(socketId);

    if (
      socketSession &&
      (socketSession.roomCode !== roomCode || socketSession.memberId !== memberId)
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

  bind(
    socketId: string,
    roomCodeValue: string,
    memberId: string,
  ): { roomCode: string; replacedSocketId?: string } {
    const roomCode = normalizeRoomCode(roomCodeValue);
    const key = memberKey(roomCode, memberId);
    const replacedSocketId = this.activeSocketByMember.get(key);
    const allowPlaybackUpdate =
      this.sessionsBySocket.get(socketId)?.allowPlaybackUpdate ??
      createPlaybackUpdateTokenConsumer();

    if (replacedSocketId && replacedSocketId !== socketId) {
      this.sessionsBySocket.delete(replacedSocketId);
    }

    this.sessionsBySocket.set(socketId, {
      socketId,
      roomCode,
      memberId,
      allowPlaybackUpdate,
    });
    this.activeSocketByMember.set(key, socketId);

    return replacedSocketId && replacedSocketId !== socketId
      ? { roomCode, replacedSocketId }
      : { roomCode };
  }

  isActiveSocket(session: SessionRecord): boolean {
    return (
      this.activeSocketByMember.get(memberKey(session.roomCode, session.memberId)) ===
      session.socketId
    );
  }
}

function memberKey(roomCode: string, memberId: string): string {
  return `${roomCode}:${memberId}`;
}
