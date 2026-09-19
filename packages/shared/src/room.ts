import type {
  CreateRoomRequest,
  PartyMember,
  PartySnapshot,
  PlaybackState,
  PlaybackUpdate,
  RoomState,
  ServiceId,
} from './protocol';
import {
  sanitizeMemberName,
  sanitizeOptionalTitle,
  MAX_PLAYBACK_POSITION_SEC as maxPlaybackPositionSec,
} from './protocol';
import { SERVICE_BY_ID } from './streaming-services';

export type { RoomState } from './protocol';

export const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1_000;

export const ROOM_DEPARTURE_TTL_MS = 2 * 60 * 1_000;

export function createRoomState(
  roomCode: string,
  request: CreateRoomRequest,
  memberId: string,
  now: number,
): RoomState {
  assertValidMediaId(request.serviceId, request.initialPlayback.mediaId);

  const playback: PlaybackState = {
    ...request.initialPlayback,
    serviceId: request.serviceId,
    title: sanitizeOptionalTitle(request.initialPlayback.title),
    updatedAt: now,
    sourceMemberId: memberId,
  };

  return {
    roomCode,
    expiresAt: now + ROOM_IDLE_TTL_MS,
    serviceId: request.serviceId,
    members: new Map<string, PartyMember>(),
    playback,
    createdAt: now,
  };
}

export function upsertRoomMember(
  room: RoomState,
  memberId: string,
  memberName: string,
  now: number,
): RoomState {
  const existing = room.members.get(memberId);
  const nextMember: PartyMember = {
    id: memberId,
    name: sanitizeMemberName(memberName),
    joinedAt: existing?.joinedAt ?? now,
  };

  const members = new Map(room.members);
  members.set(memberId, nextMember);
  return { ...room, members, expiresAt: now + ROOM_IDLE_TTL_MS };
}

export function removeRoomMember(room: RoomState, memberId: string, now: number): RoomState {
  if (!room.members.has(memberId)) return room;
  const members = new Map(room.members);
  members.delete(memberId);
  return {
    ...room,
    members,
    expiresAt: now + (members.size === 0 ? ROOM_DEPARTURE_TTL_MS : ROOM_IDLE_TTL_MS),
  };
}

export function applyPlaybackUpdate(
  room: RoomState,
  update: PlaybackUpdate,
  memberId: string,
  now: number,
): RoomState {
  assertValidMediaId(room.serviceId, update.mediaId);

  const playback: PlaybackState = {
    serviceId: room.serviceId,
    mediaId: update.mediaId,
    playing: update.playing,
    positionSec: normalizePosition(update.positionSec),
    updatedAt: now,
    sourceMemberId: memberId,
  };

  if (update.title !== undefined) {
    playback.title = sanitizeOptionalTitle(update.title);
  }

  return { ...room, playback, expiresAt: now + ROOM_IDLE_TTL_MS };
}

// Invariant: `positionSec` is the playback position at `updatedAt`. Projecting
// a playing state forward moves both fields together so the result can be
// projected again without double-counting elapsed time.
export function resolvePlaybackState(playback: PlaybackState, now: number): PlaybackState {
  if (!playback.playing) {
    return playback.updatedAt === now ? playback : { ...playback, updatedAt: now };
  }

  const elapsedSec = Math.max(0, (now - playback.updatedAt) / 1000);
  return {
    ...playback,
    positionSec: normalizePosition(playback.positionSec + elapsedSec),
    updatedAt: now,
  };
}

export function toPartySnapshot(room: RoomState, now: number): PartySnapshot {
  const watchUrl = SERVICE_BY_ID[room.serviceId].buildCanonicalWatchUrl(room.playback.mediaId);

  return {
    roomCode: room.roomCode,
    serviceId: room.serviceId,
    watchUrl,
    members: [...room.members.values()].toSorted((left, right) => {
      return left.joinedAt - right.joinedAt;
    }),
    playback: resolvePlaybackState(room.playback, now),
    createdAt: room.createdAt,
  };
}

function normalizePosition(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(maxPlaybackPositionSec, Math.max(0, Number(value.toFixed(3))));
}

function assertValidMediaId(serviceId: ServiceId, mediaId: string): void {
  if (!SERVICE_BY_ID[serviceId].isMediaIdValid(mediaId)) {
    throw new Error('Invalid media id for streaming service.');
  }
}
