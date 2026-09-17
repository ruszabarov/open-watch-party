# Privacy

Open Watch Party has no accounts, no analytics, and no advertising. This
document describes every piece of data the extension and server handle.

## What the extension stores

The extension writes to browser-local storage only:

- `local:watch-party-settings` — your display name (defaults to a generated
  `Guest NNN`).
- `session:watch-party` — the current session: room code, your server-assigned
  member id, connection status, the last room snapshot (member list and playback
  state), the controlled tab's id and media id, and the last error or notice
  shown in the popup.

This data stays in your browser profile. It is sent to the room's server while
you are in a room so that other members see your display name and playback, and
it is cleared when you leave or the room ends.

## What the server stores

Each room is a single Cloudflare Durable Object. It stores:

- the room code and service id,
- member ids (random UUIDs assigned by the server) and display names,
- the shared playback state (media id, title, position, play/pause, last
  update time),
- room expiry timestamps.

Room state is deleted when the room closes. A room with no members expires after
two minutes; a room with members expires after six hours of inactivity. The
server does not keep accounts, watch history, or a long-term log of viewing
activity. Short-lived operational logs record connection and error events
without room contents.

The server is hosted on Cloudflare Workers. Cloudflare processes the connection
metadata needed to run the service under its own privacy terms.

## Firefox data collection

The Firefox manifest declares the minimum categories required for the
extension's features:

- `browsingActivity` — to detect the watch page and player state.
- `websiteContent` — to read the video's title and position on a supported
  service.

Neither is used for tracking and neither is sent anywhere except the room's
realtime server.

## Your choices

- You can leave a room at any time from the popup, which removes your member
  entry and clears local session state.
- You can clear the extension's data through your browser's extension settings.
- To run without any third-party server, self-host the backend (see
  [self-hosting.md](docs/self-hosting.md)).
