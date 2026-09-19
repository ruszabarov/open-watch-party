# Self-hosting

The realtime backend is a PartyServer Worker. Each room is one Durable Object
addressed by its room code, and room state is persisted in Durable Object
storage.

## Requirements

- A Cloudflare account with Workers and Durable Objects enabled.
- Node.js 24 and pnpm 11.
- After `pnpm install`, work from `apps/server`.

## Deploy

1. Edit `apps/server/wrangler.jsonc`:

   - Set `name` to your Worker name.
   - Replace the `routes` entry with your own custom domain, or delete it to use
     the `*.workers.dev` route.
   - Keep the `main` Durable Object binding and the `v1` SQLite migration. The
     server class enables WebSocket hibernation; no extra migration is needed.

2. Authenticate and deploy:

   ```bash
   pnpm --filter @open-watch-party/server exec wrangler login
   pnpm --filter @open-watch-party/server exec wrangler deploy
   ```

3. Point the extension at the deployed host and rebuild:

   ```bash
   SERVER_URL=watch.example.com pnpm --filter @open-watch-party/extension build
   ```

   `SERVER_URL` is baked into the extension's Content Security Policy, so only
   the configured host is allowed to connect.

## Configuration

`wrangler.jsonc` enables Cloudflare observability. The server emits structured
connection, rejection, and room-closure events. It does not log room contents,
media titles, or tokens.

Connection limits live in `apps/server/src/limits.ts`:

- `MAX_ROOM_MEMBERS` — maximum members a room accepts.
- `MAX_JOIN_ATTEMPTS` — join attempts allowed per connection.
- `UNJOINED_TIMEOUT_MS` — how long a socket may stay connected without joining.

`ROOM_DEPARTURE_TTL_MS` and `ROOM_IDLE_TTL_MS` in `packages/shared/src/room.ts`
set the empty and idle room lifetimes.

Room-code validation runs before a request reaches a Durable Object. The object
enforces message size (`MAX_CLIENT_MESSAGE_LENGTH`) before parsing. There is no per-connection
playback rate limit; each room is an isolated Durable Object, so a busy room
degrades itself rather than other rooms.

## Releases

Server and extension releases are independent. The server release tag is
`server-v*` and the extension tag is `extension-v*`. Deploying a server version
that the installed extension cannot talk to produces an explicit
invalid-server-response error in the popup rather than silently applying partial
state.

## Reproducible builds

The Firefox submission source archive is produced by:

```bash
SERVER_URL=watch.example.com pnpm --filter @open-watch-party/extension exec \
  wxt zip -b firefox --sources
```

The archive contains the whole pnpm workspace (root `package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `apps/extension`, and
`packages/shared`) and a `SOURCE_BUILD.md` with exact rebuild steps. Verify a
clean extraction before submitting:

```bash
unzip open-watch-party*-sources.zip -d /tmp/owp-src
cd /tmp/owp-src
pnpm install --frozen-lockfile
SERVER_URL=watch.example.com pnpm --filter @open-watch-party/extension build:firefox
```
