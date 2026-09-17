# Building Open Watch Party from source

This archive contains the complete pnpm workspace needed to rebuild the
submitted extension artifact. It is not a single-package checkout.

## Requirements

- Node.js 24
- pnpm 11 (`corepack enable` or `npm install -g pnpm@11`)

## Reproduction steps

From the root of the extracted archive:

```bash
pnpm install --frozen-lockfile
SERVER_URL=watch.ruszabarov.com pnpm --filter @open-watch-party/extension build:firefox
```

The unpacked Firefox extension is written to:

- `apps/extension/.output/firefox-mv2/` (Manifest V2 build)
- `apps/extension/.output/firefox-mv3/` (Manifest V3 build, if produced)

`SERVER_URL` is the public host of the realtime backend. It is baked into the
extension's connect policy at build time. Omitting it falls back to
`localhost:8787`, which is only useful for local development.

## Layout

- `apps/extension` — WXT + Svelte browser extension
- `packages/shared` — shared protocol, room logic, and service registry
- `pnpm-workspace.yaml`, `pnpm-lock.yaml` — workspace definition and lockfile

`apps/server` and the release tooling are excluded from this archive because
they are not required to reproduce the browser extension.
