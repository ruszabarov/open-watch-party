import { z } from 'zod';
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

export const INVALID_SERVER_RESPONSE_ERROR = 'Invalid server response.';

const CONTROL_CHARACTERS_PATTERN = /\p{Cc}+/gu;

export function sanitizeMemberName(value: string): string {
  return sanitizeText(value, MAX_MEMBER_NAME_LENGTH) || 'Guest';
}

export function sanitizeOptionalTitle(value: string | undefined): string {
  if (value == null) {
    return '';
  }

  return sanitizeText(value, MAX_TITLE_LENGTH) || '';
}

export const thrownErrorSchema = z.instanceof(Error);

export function failureMessage(
  parsed: ReturnType<typeof thrownErrorSchema.safeParse>,
  fallback: string,
): string {
  return parsed.success ? parsed.data.message || fallback : fallback;
}

const roomCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().min(1));
const memberIdSchema = z.string().trim().min(1);
const mediaIdSchema = z.string().trim().min(1);
const serviceIdSchema = z.enum(['netflix', 'youtube']);
const positionSchema = z.number().min(0).max(MAX_PLAYBACK_POSITION_SEC);
const memberNameSchema = z.string().transform(sanitizeMemberName);
const titleSchema = z
  .string()
  .optional()
  .transform((value) => sanitizeOptionalTitle(value));
const ridSchema = z.string().min(1);
const requestIdEnvelopeSchema = z.object({ rid: ridSchema });

const playbackDraftSchema = z.object({
  mediaId: mediaIdSchema,
  title: titleSchema,
  positionSec: positionSchema,
  playing: z.boolean(),
});

const createRoomRequestSchema = z.object({
  memberId: memberIdSchema,
  memberName: memberNameSchema,
  serviceId: serviceIdSchema,
  initialPlayback: playbackDraftSchema,
});

const joinRoomRequestSchema = z.object({
  roomCode: roomCodeSchema,
  memberId: memberIdSchema,
  memberName: memberNameSchema,
});

const playbackUpdateRequestSchema = playbackDraftSchema.strict();

const partyMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  joinedAt: z.number(),
});

const playbackStateSchema = z.object({
  serviceId: serviceIdSchema,
  mediaId: mediaIdSchema,
  title: z.string().optional(),
  playing: z.boolean(),
  positionSec: z.number(),
  updatedAt: z.number(),
  sourceMemberId: z.string().min(1),
});

export const partySnapshotSchema = z.object({
  roomCode: z.string().min(1),
  serviceId: serviceIdSchema,
  watchUrl: z.string().min(1),
  members: z.array(partyMemberSchema),
  playback: playbackStateSchema,
  createdAt: z.number(),
});

export const roomResponseSchema = z.object({
  memberId: z.string().min(1),
  snapshot: partySnapshotSchema,
});

export const roomLeaveResponseSchema = z.object({
  roomCode: z.string().min(1),
});

const roomClosedEventSchema = z.object({
  roomCode: z.string().min(1),
  reason: z.enum(['evicted', 'expired']),
});

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room:create'), rid: ridSchema, payload: createRoomRequestSchema }),
  z.object({ type: z.literal('room:join'), rid: ridSchema, payload: joinRoomRequestSchema }),
  z.object({ type: z.literal('room:leave'), rid: ridSchema }),
  z.object({
    type: z.literal('playback:update'),
    rid: ridSchema,
    payload: playbackUpdateRequestSchema,
  }),
]);

const ackEnvelopeSchema = z.object({
  type: z.literal('ack'),
  rid: ridSchema,
  result: z.json().optional(),
});

const ackResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.json() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room:state'), snapshot: partySnapshotSchema }),
  z.object({ type: z.literal('playback:state'), snapshot: partySnapshotSchema }),
  z.object({ type: z.literal('room:closed'), event: roomClosedEventSchema }),
]);

export const roomStateSchema = z.object({
  roomCode: z.string().min(1),
  serviceId: serviceIdSchema,
  members: z.map(z.string(), partyMemberSchema),
  playback: playbackStateSchema,
  createdAt: z.number(),
});

export type PlaybackUpdate = z.output<typeof playbackUpdateRequestSchema>;
export type CreateRoomRequest = z.output<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.output<typeof joinRoomRequestSchema>;
export type PartyMember = z.output<typeof partyMemberSchema>;
export type PlaybackState = z.output<typeof playbackStateSchema>;
export type PartySnapshot = z.output<typeof partySnapshotSchema>;
export type RoomResponse = z.output<typeof roomResponseSchema>;
export type RoomLeaveResponse = z.output<typeof roomLeaveResponseSchema>;
export type RoomClosedEvent = z.output<typeof roomClosedEventSchema>;
export type RoomClosedReason = RoomClosedEvent['reason'];
export type ClientMessage = z.output<typeof clientMessageSchema>;
export type ServerEvent = z.output<typeof serverEventSchema>;
export type ServerMessage =
  | { type: 'ack'; rid: string; result: z.output<typeof ackResultSchema> }
  | ServerEvent;
export type RoomState = z.output<typeof roomStateSchema>;

export type OperationResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function decodeAckPayload<T>(
  result: Extract<ServerMessage, { type: 'ack' }>['result'],
  schema: z.ZodType<T>,
): OperationResult<T> {
  if (!result.ok) {
    return result;
  }

  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    return { ok: false, error: INVALID_SERVER_RESPONSE_ERROR };
  }

  return { ok: true, data: parsed.data };
}

export function parseClientSocketMessage(
  raw: string | ArrayBuffer,
): { ok: true; message: ClientMessage } | { ok: false; rid: string | null } {
  const text = raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : raw;

  try {
    const json = JSON.parse(text);
    const message = clientMessageSchema.safeParse(json);
    if (message.success) {
      return { ok: true, message: message.data };
    }

    const envelope = requestIdEnvelopeSchema.safeParse(json);
    return { ok: false, rid: envelope.success ? envelope.data.rid : null };
  } catch {
    return { ok: false, rid: null };
  }
}

export function parseServerSocketData(data: string | ArrayBuffer | Blob): ServerMessage | null {
  const text = z.string().safeParse(data);
  if (!text.success) {
    return null;
  }

  try {
    const json = JSON.parse(text.data);
    const ackEnvelope = ackEnvelopeSchema.safeParse(json);
    if (ackEnvelope.success) {
      const result = ackResultSchema.safeParse(ackEnvelope.data.result);
      return {
        type: 'ack',
        rid: ackEnvelope.data.rid,
        result: result.success ? result.data : { ok: false, error: INVALID_SERVER_RESPONSE_ERROR },
      };
    }

    const event = serverEventSchema.safeParse(json);
    return event.success ? event.data : null;
  } catch {
    return null;
  }
}

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(CONTROL_CHARACTERS_PATTERN, '').trim().slice(0, maxLength);
}
