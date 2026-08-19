import { z } from 'zod';

export const NETFLIX_PLAYER_REQUEST_SOURCE = 'open-watch-party:netflix-player-request';
export const NETFLIX_PLAYER_RESPONSE_SOURCE = 'open-watch-party:netflix-player-response';

const netflixPlayerCommandSchema = z.object({
  positionMs: z.number().optional(),
  playing: z.boolean(),
});

const netflixRpcRequestSchema = z.union([
  z.object({
    source: z.literal(NETFLIX_PLAYER_REQUEST_SOURCE),
    command: netflixPlayerCommandSchema,
  }),
  z.object({
    source: z.literal(NETFLIX_PLAYER_REQUEST_SOURCE),
    requestId: z.string().min(1),
    query: z.literal('status'),
  }),
]);

const netflixPlayerStatusResponseSchema = z.object({
  source: z.literal(NETFLIX_PLAYER_RESPONSE_SOURCE),
  requestId: z.string().min(1),
  hasPlayer: z.boolean(),
});

export type NetflixPlayerCommand = z.output<typeof netflixPlayerCommandSchema>;
export type NetflixRpcRequest = z.output<typeof netflixRpcRequestSchema>;
export type NetflixPlayerStatusResponse = z.output<typeof netflixPlayerStatusResponseSchema>;

export function parseNetflixRpcRequest(event: MessageEvent): NetflixRpcRequest | null {
  const parsed = netflixRpcRequestSchema.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}

export function parseNetflixPlayerStatusResponse(
  event: MessageEvent,
): NetflixPlayerStatusResponse | null {
  const parsed = netflixPlayerStatusResponseSchema.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}
