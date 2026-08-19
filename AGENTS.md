# AGENTS.md

## Cursor Cloud specific instructions

Open Watch Party is a pnpm workspace (pnpm 11, Node 26 via `.cursor/Dockerfile`).
Standard commands are in the root `package.json` and `README.md`.

After changing `.cursor/environment.json` or `.cursor/Dockerfile`, trigger a new environment build in the Cursor dashboard so agents pick up the updated base image.

Services:
- `apps/server`: `pnpm dev:server` → `wrangler dev` on `http://localhost:8787`. No Cloudflare account needed for local dev.
- `apps/extension`: `pnpm dev:extension` → WXT dev server on `http://localhost:3000`. The auto-launched browser has no display in headless VMs.

Non-obvious: `wrangler dev` uses port `8787`, not the `localhost:1999` default in `apps/extension/.env.example` (that's for a deployed host). `apps/server/.wrangler/` is untracked local state, safe to delete.
