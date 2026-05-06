import * as z from 'zod/mini';
import type { ApplySnapshotResult } from '../protocol/extension';

export const NETFLIX_PLAYER_REQUEST_EVENT = 'open-watch-party:netflix-player-request';
export const NETFLIX_PLAYER_RESPONSE_EVENT = 'open-watch-party:netflix-player-response';

const NETFLIX_PLAYER_RESPONSE_TIMEOUT_MS = 1500;

declare global {
  interface WindowEventMap {
    [NETFLIX_PLAYER_REQUEST_EVENT]: CustomEvent<string>;
    [NETFLIX_PLAYER_RESPONSE_EVENT]: CustomEvent<string>;
  }
}

function parseEventDetail(detail: unknown): unknown {
  if (typeof detail !== 'string') {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(detail);
    return parsed;
  } catch {
    return undefined;
  }
}

const netflixPlayerCommandSchema = z.object({
  id: z.string(),
  positionMs: z.optional(z.number().check(z.nonnegative())),
  playing: z.boolean(),
});

export type NetflixPlayerCommand = z.infer<typeof netflixPlayerCommandSchema>;

function serializeNetflixPlayerCommand(command: NetflixPlayerCommand): string {
  return JSON.stringify(command);
}

export function parseNetflixPlayerCommandDetail(detail: unknown) {
  return netflixPlayerCommandSchema.safeParse(parseEventDetail(detail));
}

const netflixPlayerResponseSchema = z.object({
  id: z.string(),
  applied: z.boolean(),
  reason: z.optional(z.string()),
});

export type NetflixPlayerResponse = z.infer<typeof netflixPlayerResponseSchema>;

export function serializeNetflixPlayerResponse(response: NetflixPlayerResponse): string {
  return JSON.stringify(response);
}

function parseNetflixPlayerResponseDetail(detail: unknown) {
  return netflixPlayerResponseSchema.safeParse(parseEventDetail(detail));
}

export function applyNetflixPlayerSnapshot(
  command: Omit<NetflixPlayerCommand, 'id'>,
): Promise<ApplySnapshotResult> {
  const id = crypto.randomUUID();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener(NETFLIX_PLAYER_RESPONSE_EVENT, handleResponse);
      resolve({ applied: false, reason: 'Netflix player API is not ready yet.' });
    }, NETFLIX_PLAYER_RESPONSE_TIMEOUT_MS);

    function handleResponse(event: WindowEventMap[typeof NETFLIX_PLAYER_RESPONSE_EVENT]) {
      const response = parseNetflixPlayerResponseDetail(event.detail);
      if (!response.success || response.data.id !== id) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener(NETFLIX_PLAYER_RESPONSE_EVENT, handleResponse);
      resolve(
        response.data.applied
          ? { applied: true }
          : { applied: false, reason: response.data.reason },
      );
    }

    window.addEventListener(NETFLIX_PLAYER_RESPONSE_EVENT, handleResponse);
    window.dispatchEvent(
      new CustomEvent<string>(NETFLIX_PLAYER_REQUEST_EVENT, {
        detail: serializeNetflixPlayerCommand({
          id,
          ...command,
        }),
      }),
    );
  });
}
