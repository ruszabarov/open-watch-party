import { z } from 'zod';
import { isServiceId, type ServiceId } from './streaming-services';
export type { ServiceId } from './streaming-services';

export const MAX_MEMBER_NAME_LENGTH = 64;
export const MAX_TITLE_LENGTH = 256;
export const MAX_PLAYBACK_POSITION_SEC = 48 * 60 * 60;

// Shared so the server and the extension cannot drift on the wording.
export const ACTIVE_ROOM_EXISTS_ERROR =
  'Leave your current room before joining or creating another room.';

// Raised when a freshly generated room code is already taken. Extremely rare;
// the client transparently regenerates and retries when it sees this.
export const ROOM_CODE_TAKEN_ERROR = 'Room code already in use.';

const CONTROL_CHARACTERS_PATTERN = /\p{Cc}+/gu;

export interface PartyMember {
  id: string;
  name: string;
  joinedAt: number;
}

export interface PlaybackState {
  serviceId: ServiceId;
  mediaId: string;
  title?: string;
  playing: boolean;
  positionSec: number;
  updatedAt: number;
  sourceMemberId: string;
}

export interface PartySnapshot {
  roomCode: string;
  serviceId: ServiceId;
  watchUrl: string;
  members: PartyMember[];
  playback: PlaybackState;
  createdAt: number;
}

export type OperationResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type Acknowledge<T> = (response: OperationResult<T>) => void;

export interface RoomResponse {
  memberId: string;
  snapshot: PartySnapshot;
}

export function sanitizeMemberName(value: string): string {
  return sanitizeText(value, MAX_MEMBER_NAME_LENGTH) || 'Guest';
}

export function sanitizeOptionalTitle(value: string | undefined): string {
  if (value == null) {
    return '';
  }

  return sanitizeText(value, MAX_TITLE_LENGTH) || '';
}

const roomCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().min(1));
const memberIdSchema = z.string().trim().min(1);
const mediaIdSchema = z.string().trim().min(1);
const serviceIdSchema = z.custom<ServiceId>(
  (value) => typeof value === 'string' && isServiceId(value),
  { message: 'Unsupported streaming service id' },
);
const positionSchema = z.number().min(0).max(MAX_PLAYBACK_POSITION_SEC);
const memberNameSchema = z.string().transform(sanitizeMemberName);
const titleSchema = z
  .string()
  .optional()
  .transform((value) => sanitizeOptionalTitle(value));

export const playbackDraftSchema = z.object({
  mediaId: mediaIdSchema,
  title: titleSchema,
  positionSec: positionSchema,
  playing: z.boolean(),
});

export const createRoomRequestSchema = z.object({
  memberId: memberIdSchema,
  memberName: memberNameSchema,
  serviceId: serviceIdSchema,
  initialPlayback: playbackDraftSchema,
});

export const joinRoomRequestSchema = z.object({
  roomCode: roomCodeSchema,
  memberId: memberIdSchema,
  memberName: memberNameSchema,
});

export const playbackUpdateRequestSchema = playbackDraftSchema.strict();

export type PlaybackUpdate = z.output<typeof playbackUpdateRequestSchema>;
export type CreateRoomRequest = z.output<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.output<typeof joinRoomRequestSchema>;

export type RoomClosedReason = 'evicted' | 'expired';

export interface RoomClosedEvent {
  roomCode: string;
  reason: RoomClosedReason;
}

// Realtime transport is a JSON message envelope over a raw WebSocket. Every
// request from the client carries an `rid` the server echoes back in its `ack`,
// giving us request/response semantics without socket.io.
const ridSchema = z.string().min(1);

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room:create'), rid: ridSchema, payload: createRoomRequestSchema }),
  z.object({ type: z.literal('room:join'), rid: ridSchema, payload: joinRoomRequestSchema }),
  z.object({ type: z.literal('room:leave'), rid: ridSchema }),
  z.object({
    type: z.literal('playback:update'),
    rid: ridSchema,
    payload: playbackUpdateRequestSchema,
  }),
]);

export type ClientMessage = z.output<typeof clientMessageSchema>;

export interface RoomLeaveResponse {
  roomCode: string;
}

export type ServerMessage =
  | { type: 'ack'; rid: string; result: OperationResult<unknown> }
  | { type: 'room:state'; snapshot: PartySnapshot }
  | { type: 'playback:state'; snapshot: PartySnapshot }
  | { type: 'room:closed'; event: RoomClosedEvent };

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(CONTROL_CHARACTERS_PATTERN, '').trim().slice(0, maxLength);
}
