# Open Watch Party

pnpm workspace: `apps/extension` (WXT + Svelte), `apps/server` (PartyServer on Cloudflare Workers), `packages/shared` (protocol and room logic).

Install with `pnpm install`. Dev: `pnpm dev:server` and `pnpm dev:extension`. Validate with `pnpm check`.

## Working principles

- Do not preserve backwards compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve readability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
- Study how established products solve the problem before designing a solution. Adopt their proven patterns and conventions rather than inventing an approach from scratch.

## Cloud agents

pnpm 11. `pnpm dev:server` is Wrangler on `http://localhost:8787` (not the `localhost:1999` host in `apps/extension/.env.example`). `pnpm dev:extension` serves WXT on `http://localhost:3000`; the auto-launched browser has no display in headless VMs. `apps/server/.wrangler/` is untracked local state.
