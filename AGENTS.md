# AGENTS.md

## Cursor Cloud specific instructions

Open Watch Party is a pnpm workspace (Node 26, pnpm 11 pinned via `packageManager`; `.nvmrc` pins Node 26).
The Cloud Agent base image is defined in `.cursor/Dockerfile` (`node:26-bookworm-slim`); `.cursor/environment.json`
selects that Dockerfile and runs `pnpm install --frozen-lockfile` on startup.
Dependencies are refreshed automatically on startup by the update script (`pnpm install --frozen-lockfile`),
whose `postinstall` runs `wxt prepare` to generate extension types. Standard commands
live in the root `package.json` and `README.md`; prefer those over duplicating them.

Services / packages:
- `apps/server`: PartyServer realtime backend on Cloudflare Workers. Run with `pnpm dev:server`
  (`wrangler dev`). Non-obvious: `wrangler dev` serves on `http://localhost:8787` by default,
  NOT the `localhost:1999` mentioned in `apps/extension/.env.example` (that default only matters
  for how the packaged extension addresses a deployed host). It runs fully local with a local
  Durable Object; no Cloudflare account/login is needed for local dev.
- `apps/extension`: WXT + Svelte browser extension. Run with `pnpm dev:extension`; the WXT dev
  server listens on `localhost:3000` and writes an unpacked build to
  `apps/extension/.output/chrome-mv3-dev`. In this headless VM the auto-launched browser has no
  display, so drive/load the unpacked extension manually if GUI testing is needed.

Checks (from repo root): `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`
(chrome production build), and per-package tests via `pnpm --filter <pkg> test`. `pnpm check`
runs the full lint + format + typecheck + all tests gauntlet.

Testing the realtime protocol end-to-end without a browser: connect with the `partysocket`
client (Node provides a global `WebSocket`) to `localhost:8787` and exchange the JSON
envelope messages defined in `packages/shared/src/protocol.ts` (`room:create`, `room:join`,
`playback:update`), asserting `playback:state` broadcasts propagate between clients.

Note: `wrangler dev` writes local state to `apps/server/.wrangler/` (untracked, safe to delete).
