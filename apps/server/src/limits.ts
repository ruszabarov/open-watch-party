export const MAX_ROOM_MEMBERS = 32;
export const MAX_JOIN_ATTEMPTS = 4;
export const UNJOINED_TIMEOUT_MS = 15_000;

export interface SessionState {
  // null until this connection has been admitted to a room. A connection can
  // exist without an identity (tracked for the join timeout and attempt cap).
  memberId: string | null;
  joinAttempts: number;
  joinDeadline: number;
}

export function createSessionState(now: number): SessionState {
  return {
    memberId: null,
    joinAttempts: 0,
    joinDeadline: now + UNJOINED_TIMEOUT_MS,
  };
}

export function nextRoomAlarm(
  expiresAt: number | undefined,
  joinDeadlines: Iterable<number>,
): number | null {
  let next = expiresAt ?? Infinity;
  for (const deadline of joinDeadlines) next = Math.min(next, deadline);
  return Number.isFinite(next) ? next : null;
}

/** A room event is delivered only to a joined, current member's own connection. */
export function canReceiveRoomEvent(
  session: Readonly<SessionState> | null | undefined,
  isMember: boolean,
  connectionId: string,
  without: readonly string[],
): boolean {
  return session?.memberId != null && isMember && !without.includes(connectionId);
}
