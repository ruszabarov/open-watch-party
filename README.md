# Watch Party OSS

Open-source watch party stack built as a pnpm workspace:

- `apps/extension`: WXT + Svelte browser extension
- `apps/server`: Socket.IO realtime backend with in-memory room state
- `packages/shared`: shared protocol types and room logic

## Commands

```bash
pnpm install
pnpm dev:server
pnpm dev:extension
pnpm check
pnpm build
pnpm build:firefox
pnpm build:safari
```

Safari packaging still requires Apple's native conversion/wrapper flow after `pnpm build:safari`.
