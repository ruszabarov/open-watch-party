# Open Watch Party

Open Watch Party is an open source, lightweight, and free browser extension for
watch parties on your favorite streaming services.

Create a room, share the invite code with friends, and keep playback in sync
while everyone watches from their own browser. Contributions for more streaming
services are welcome.

Repository: https://github.com/ruszabarov/open-watch-party

## Features

- Free and open source
- Lightweight browser extension built with WXT and Svelte
- Realtime play, pause, seek, and playback-state sync
- Room-based watch parties with shareable invite codes
- Realtime backend powered by PartyServer on Cloudflare Workers

## Supported Streaming Services

| Streaming service | Watch URL pattern                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Netflix           | `netflix.com/watch/...`                                                                    |
| YouTube           | `youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/embed/...`, `youtube.com/live/...` |

Content scripts are registered for each service's whole domain so that
single-page navigation between videos is observed. They only read and control
the player on a recognized watch page; nothing is reported from other pages.

See [docs/support-matrix.md](docs/support-matrix.md) for browser and playback
support details.

Want another streaming service? Please open an issue or pull request. Adding
support requires registry metadata plus an extension-side player integration;
see [CONTRIBUTING.md](CONTRIBUTING.md).

## Project Structure

This repository is a pnpm workspace:

- `apps/extension`: WXT + Svelte browser extension
- `apps/server`: PartyServer realtime backend (one Durable Object instance per room)
- `packages/shared`: shared protocol, room logic, and the streaming service registry
- `docs/`: support matrix, self-hosting, and store-facing documentation

## Development

Install dependencies:

```bash
pnpm install
```

Run the backend (Wrangler on `http://localhost:8787`):

```bash
pnpm dev:server
```

Run the extension (WXT dev server on `http://localhost:3000`):

```bash
pnpm dev:extension
```

Useful checks:

```bash
pnpm check        # lint, format, typecheck
pnpm build
pnpm build:firefox
pnpm build:safari
```

## Extension Environment

Copy [apps/extension/.env.example](apps/extension/.env.example) to
`apps/extension/.env` and set:

- `SERVER_URL`: realtime backend host the extension connects to (for example,
  `watch.ruszabarov.com`). A leading `http(s)://` is stripped automatically.
  When unset, development builds fall back to `localhost:8787`, matching
  `pnpm dev:server`. CI release builds fail when it is missing.

The value is baked into the extension's Content Security Policy at build time:
production builds only permit the configured host (plus `'self'`), not arbitrary
HTTPS/WSS destinations.

## Backend Notes

The realtime backend is a [PartyServer](https://github.com/threepointone/partyserver)
Cloudflare Worker. Each room is an isolated Durable Object instance addressed by
its room code, with state persisted to Durable Object storage. Deploy it with
`wrangler deploy` from `apps/server`, or via `pnpm release:server`.

Keep these constraints in mind:

- A room with members expires after 6 hours of inactivity.
- A room with no members expires after 2 minutes, so an accidental empty room
  does not linger.
- Room codes are generated client-side and validated server-side; the server
  rejects a collision so the client retries with a fresh code.
- The server assigns each connection its own member identity. Knowing another
  member's id is not enough to control their connection.
- Server and extension are released independently. A response the client cannot
  parse is surfaced as an invalid-server-response error instead of being
  applied silently.

See [docs/self-hosting.md](docs/self-hosting.md) for deployment and release
details.

## Releases

Extension and server versions are released independently with release-it:

```bash
pnpm release:extension patch
pnpm release:server patch
```

Replace `patch` with `minor`, `major`, or an explicit semver version when
needed. Dry-run commands are also available:

```bash
pnpm release:extension:dry-run patch
pnpm release:server:dry-run patch
```

The extension release command bumps `apps/extension/package.json`, commits the
change, creates an `extension-v*` tag, and pushes it. The extension release
workflow packages Chrome, Firefox, and Safari zips, plus a Firefox source
archive that contains the whole pnpm workspace, uploads the zips to the GitHub
Release, and submits Chrome and Firefox through WXT. The Safari artifact
contains extension resources, not a prebuilt Xcode project; creating and
signing the Xcode wrapper remains a manual step with
`xcrun safari-web-extension-converter`, documented below.

## Safari

Create a Safari Xcode wrapper from the generated extension resources:

```bash
xcrun safari-web-extension-converter apps/extension/.output/safari-mv2 \
  --project-location apps/safari \
  --app-name "Open Watch Party" \
  --bundle-identifier com.ruszabarov.openwatchparty \
  --swift \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt
```

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md): adding a streaming service, manual test matrix, protocol changes
- [SECURITY.md](SECURITY.md): reporting a vulnerability
- [PRIVACY.md](PRIVACY.md): what the extension and server store
- [docs/self-hosting.md](docs/self-hosting.md): running your own backend
- [docs/support-matrix.md](docs/support-matrix.md): browsers and playback behavior
- [SOURCE_BUILD.md](SOURCE_BUILD.md): rebuilding the Firefox source archive

## Credits

Logo icon attribution:
<a href="https://www.flaticon.com/free-icons/watching" title="watching icons">Watching icons created by Hilmy Abiyyu A. - Flaticon</a>
