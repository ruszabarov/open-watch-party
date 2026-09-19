# Contributing

Thanks for helping improve Open Watch Party. This guide covers the two most
common contributions: adding a streaming service and changing the shared
protocol.

## Development setup

```bash
pnpm install
pnpm dev:server     # Wrangler on http://localhost:8787
pnpm dev:extension  # WXT on http://localhost:3000
pnpm check          # lint, format, typecheck
```

`pnpm check` runs the whole workspace.

## Adding a streaming service

The service registry is the single source of truth. Adding a service means:

1. **Registry metadata** in `packages/shared/src/streaming-services.ts`:
   - Add the id to the `SERVICE_IDS` tuple.
   - Add the definition to `SERVICE_BY_ID`.
   - Create `packages/shared/src/streaming-services/<id>.ts` with the
     `ServiceDefinition` contract:

   ```ts
   export type ServiceDefinition = {
     readonly descriptor: ServiceDescriptor;
     readonly contentMatches: readonly string[];
     matchesUrl(url: URL): boolean;
     extractMediaId(url: URL): string | null;
     isMediaIdValid(mediaId: string): boolean;
     buildCanonicalWatchUrl(mediaId: string): string;
   };
   ```

   The protocol's service enum, the popup's supported-service list, and the
   content-script match patterns all derive from this registry. Do not add a
   second enum anywhere.

2. **Content script** at
   `apps/extension/src/streaming-services/<id>/content-script.ts`. Export a
   `run<Id>ContentScript(ctx)` function and build it from the shared runner in
   `content-runner.ts`. A service only describes its own player:

   ```ts
   export type ContentService = {
     readonly serviceId: ServiceId;
     findVideo(): HTMLVideoElement | null;
     readMediaId(): string | null;
     canReport(): boolean;
     reasonForEvent(eventType: string): WatchReportReason;
     createAdapter(getVideo: () => HTMLVideoElement | null): VideoAdapter;
     install?(ctx: ContentScriptContext, api: ContentScriptApi): void;
     onVideoBound?(video: HTMLVideoElement | null, api: ContentScriptApi): void;
   };
   ```

   The runner owns video discovery, event binding/cleanup, report construction,
   messaging, and mutation-observation throttling. `findVideo` should prefer the
   service's player container and fall back to `video`. `readMediaId` should
   derive identity from the URL, not the media element, so identity cannot
   precede player identity.

3. **Adapter** (optional) at
   `apps/extension/src/streaming-services/<id>/adapter.ts`. The adapter only
   reads and controls its own player. It returns `applied` or `dropped`; the
   background owns retries, verification, navigation, and drift correction.
   Use `needsSeek` / `waitForMatch` from `video-adapter.ts` and the shared
   `PLAYBACK_POSITION_TOLERANCE_SEC` so the adapter and engine agree on the
   tolerance boundary.

4. **Entrypoint** at `apps/extension/src/entrypoints/<id>.content.ts`:

   ```ts
   export default defineContentScript({
     matches: [...SERVICE_BY_ID.myService.contentMatches],
     main: runMyServiceContentScript,
   });
   ```

5. **Manual checks.** At minimum: create and join from two browsers, play/pause/
   seek, SPA navigation to a new video, player replacement, an ad (if the
   service has them), and reconnect after the content script is reloaded.

Keep service-specific player APIs (for example a private player object) behind
that service's integration. Do not add inheritance trees, plugin discovery, or
dependency injection.

## Who controls playback

There is no privileged leader. Any member's controlled tab can send a playback
update, and the most recently accepted update becomes the authoritative room
timeline. Every other member's engine reconciles its local player against that
timeline. A report that merely matches the timeline is ignored, so a paused
player, a buffering stall, or an ad cannot silently pull the room out of sync.

Playback coordination is an XState machine in `background/playback-sync.ts`.
Its states distinguish inactive, synchronized, applying, sending, and retrying
playback. `initialTransition` and `transition` compute snapshots and commands;
`ControlledTabService` executes the commands and reports results as events.
Timer commands are produced when entering and leaving the relevant states.
Events carry local monotonic timestamps; room snapshots are anchored when
received, before navigation. The server passes an explicit epoch timestamp to
immutable room transitions for persisted playback and expiry.

## Protocol changes

`packages/shared/src/protocol.ts` is the wire contract. When you change it:

- Keep extension and server releases independent. Do not add backwards
  compatibility layers; instead make invalid payloads fail with a clear error.
- Keep new string fields bounded and validated at the server boundary.

## Manual test matrix

Run this matrix before releasing. Two browsers are enough for most rows; use a
third for membership checks.

| Case            | Steps                                            | Expected                                                                |
| --------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Create          | Open a watch page, create a room                 | Room code shown; local playback adopted                                 |
| Join            | Join the code from a second browser              | Both tabs show the same position within tolerance                       |
| Play/pause/seek | Act in either tab                                | The other tab follows promptly                                          |
| Drift recovery  | Pause one tab for ~10s without pausing the media | The stalled tab is seeked back to the timeline                          |
| Buffering       | Throttle one connection, resume                  | The stalled tab catches up without broadcasting a false pause           |
| Ads             | Watch an ad on one service                       | Reports are suppressed during the ad, then reconciled after             |
| SPA navigation  | Change episode/video in the controlled tab       | The room follows; other tabs navigate to the new media                  |
| Multiple tabs   | Open two videos of the same service, join one    | Only the selected tab is ever controlled                                |
| Reconnect       | Reload the controlled tab or lose the network    | The session rejoins and resumes the room timeline                       |
| Leave           | Leave from the popup                             | Connection closes and the member disappears                             |
| Room expiry     | Empty a room, wait two minutes                   | Room closes with an expiry message                                      |
| Impersonation   | Join with another member's id from a raw client  | The server assigns a fresh identity; the other member is unaffected     |
| Unjoined socket | Connect without joining, watch for broadcasts    | No room state is delivered; the socket is closed after the join timeout |

## Filing issues

Include the extension version, browser and version, streaming service, whether
you were the creator or a joiner, and what the other participants saw. Logs from
the extension's service worker and the server are useful but may contain room
codes; redact them if you prefer.
