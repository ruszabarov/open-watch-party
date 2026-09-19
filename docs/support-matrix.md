# Support matrix

## Browsers

| Browser                       | Build                  | Status                                             |
| ----------------------------- | ---------------------- | -------------------------------------------------- |
| Chrome                        | `chrome-mv3`           | Supported                                          |
| Firefox                       | `firefox-mv2`          | Supported                                          |
| Safari (macOS)                | `safari-mv2` resources | Supported, requires a manually built Xcode wrapper |
| Edge / Brave / other Chromium | `chrome-mv3`           | Not tested; may work                               |

The extension is a Manifest V3 build for Chrome and a Manifest V2 build for
Firefox and Safari. The service worker keeps a heartbeat on the room socket so
the browser does not suspend it during quiet playback.

## Streaming services

| Service | Watch playback | Cross-video navigation | Ad handling                                                       |
| ------- | -------------- | ---------------------- | ----------------------------------------------------------------- |
| YouTube | Yes            | Yes (SPA)              | Reports are suppressed during ads and reconciled when the ad ends |
| Netflix | Yes            | Yes (episode change)   | Not specially handled                                             |

Adding a service is described in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Playback semantics

- **Control model.** There is no privileged leader. Any member's controlled tab
  can send an update, and the most recently accepted update defines the room
  timeline. Other members reconcile against it.
- **Tolerance.** Position differences within 1.5 seconds are treated as
  synchronized. The same constant is shared by the sync engine and every
  adapter.
- **Buffering and stalls.** A player that is `playing` but stalled is seeked
  back to the timeline. The engine does not broadcast a false pause for it.
- **Ads.** During an ad, position reports are unreliable. The engine treats a
  divergence as recovery and reissues the room target once reporting resumes.
- **Playback speed.** Only 1× is supported. Rate changes are not observed, so a
  non-1× participant will drift and be corrected repeatedly.
- **Player replacement.** When a service swaps its video element, the content
  script rebinds and reports a fresh snapshot.
- **Multiple tabs.** Only the tab selected when creating or joining a room can
  control it. Other tabs of the same service are ignored.
- **Reconnect.** A dropped connection rejoins the stored room. The server
  assigns a new member identity on rejoin; the member list updates accordingly.
- **Media identity.** Identity comes from the page URL. A report is only
  accepted once the page and the player describe the same media and the player
  timeline is ready.

## Not supported

- Watching on a page that is not a recognized watch page.
- Synchronized chat, voice, or presence beyond the member list.
- Playback-rate synchronization.
- Live streams where position is not a meaningful shared value.
- Browser profiles without access to the streaming service.
