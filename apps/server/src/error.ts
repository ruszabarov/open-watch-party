export const INVALID_PAYLOAD_ERROR = 'Invalid request payload.';
export const SOCKET_SESSION_REQUIRED_ERROR = 'Socket session not found.';
export const PLAYBACK_UPDATE_RATE_LIMIT_ERROR = 'Playback update rate limit exceeded.';
export const ACTIVE_ROOM_EXISTS_ERROR =
  'Leave your current room before joining or creating another room.';

export class SocketDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocketDomainError';
  }
}

export class InvalidPayloadError extends SocketDomainError {
  constructor() {
    super(INVALID_PAYLOAD_ERROR);
  }
}

export class SocketSessionRequiredError extends SocketDomainError {
  constructor() {
    super(SOCKET_SESSION_REQUIRED_ERROR);
  }
}

export class RoomNotFoundError extends SocketDomainError {
  constructor() {
    super('Room not found.');
  }
}

export class RoomServiceMismatchError extends SocketDomainError {
  constructor() {
    super('This room is using a different service.');
  }
}

export class RoomMemberRequiredError extends SocketDomainError {
  constructor() {
    super('Member is not part of this room.');
  }
}

export class PlaybackServiceMismatchError extends SocketDomainError {
  constructor() {
    super('Service mismatch.');
  }
}

export class PlaybackUpdateRateLimitedError extends SocketDomainError {
  constructor() {
    super(PLAYBACK_UPDATE_RATE_LIMIT_ERROR);
  }
}

export class ActiveRoomExistsError extends SocketDomainError {
  constructor() {
    super(ACTIVE_ROOM_EXISTS_ERROR);
  }
}
