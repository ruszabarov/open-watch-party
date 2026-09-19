import { z } from 'zod';

export const NETFLIX_PLAYER_REQUEST_SOURCE = 'open-watch-party:netflix-player-request';

const netflixPlayerCommandSchema = z.object({
  positionMs: z.number().optional(),
  playing: z.boolean(),
});

const netflixRpcRequestSchema = z.object({
  source: z.literal(NETFLIX_PLAYER_REQUEST_SOURCE),
  command: netflixPlayerCommandSchema,
});

export type NetflixPlayerCommand = z.output<typeof netflixPlayerCommandSchema>;
export type NetflixRpcRequest = z.output<typeof netflixRpcRequestSchema>;

export function parseNetflixRpcRequest(event: MessageEvent): NetflixRpcRequest | null {
  const parsed = netflixRpcRequestSchema.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}
