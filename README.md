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
- Built for supported watch pages
- Realtime backend powered by PartyKit

## Supported Streaming Services

| Streaming service | Watch URL pattern                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Netflix           | `netflix.com/watch/...`                                                                    |
| YouTube           | `youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/embed/...`, `youtube.com/live/...` |

Want another streaming service? Please open an issue or pull request with the
streaming service you want to add. Adding support usually requires shared
streaming service metadata plus an extension-side player integration.

## Project Structure

This repository is a pnpm workspace:

- `apps/extension`: WXT + Svelte browser extension
- `apps/server`: PartyKit realtime backend (one party instance per room)
- `packages/shared`: shared protocol types and room logic
- `docs/store-listings.md`: reusable browser-store listing copy

## Development

Install dependencies:

```bash
pnpm install
```

Run the backend:

```bash
pnpm dev:server
```

Run the extension:

```bash
pnpm dev:extension
```

Useful checks:

```bash
pnpm check
pnpm build
pnpm build:firefox
pnpm build:safari
```

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

## Extension Environment

Copy [apps/extension/.env.example](apps/extension/.env.example) to
`apps/extension/.env` and set:

- `SERVER_URL`: PartyKit host the extension connects to (e.g.
  `open-watch-party.<user>.partykit.dev`; defaults to `localhost:1999` for local
  development). A leading `http(s)://` is stripped automatically.

## Adding A Streaming Service

Adding a streaming service starts in `packages/shared/src/streaming-services.ts`,
which owns the streaming service ID, display metadata, URL parsing, canonical
watch URL builder, and extension match patterns.

Then add the extension-only implementation under
`apps/extension/src/streaming-services/<id>/`, exporting a
`runMyStreamingServiceContentScript()` function from
`content-script.ts`. Wire it up by calling `defineContentScript` from
`apps/extension/src/entrypoints/<id>.content.ts`.

Issues and pull requests for new streaming services, bug fixes, documentation,
and store listing improvements are welcome.

## Backend Notes

The realtime backend is a [PartyKit](https://docs.partykit.io/) server. Each
room is an isolated party instance addressed by its room code, with state kept
in the party and persisted to its storage. Deploy it with `partykit deploy`
(from `apps/server`, or via `pnpm release:server`).

Keep these constraints in mind:

- rooms expire after 6 hours of inactivity
- room codes are generated client-side; the server rejects a collision so the
  client retries with a fresh code

## Credits

Logo icon attribution:
<a href="https://www.flaticon.com/free-icons/watching" title="watching icons">Watching icons created by Hilmy Abiyyu A. - Flaticon</a>

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
workflow packages Chrome, Firefox, Firefox sources, and Safari zips, uploads all
zips to the GitHub Release page, submits Chrome and Firefox through WXT, and
uploads a macOS Safari Xcode project zip. Safari publishing remains manual;
download the Safari Xcode project zip from the GitHub Release, then sign,
archive, and upload it from Xcode.
