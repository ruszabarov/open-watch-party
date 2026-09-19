# Security policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for a
suspected vulnerability.

- Preferred: open a private advisory at
  https://github.com/ruszabarov/open-watch-party/security/advisories/new
- Alternatively, email the maintainer listed in the repository profile.

Include:

- what the issue is and why it matters,
- the affected component (extension, server, shared protocol),
- reproduction steps or a proof of concept,
- the version or commit you tested.

You can expect an acknowledgement within a few days. Please give us a chance to
ship a fix before public disclosure.

## Scope

In scope:

- The Cloudflare Worker / Durable Object backend in `apps/server`.
- The browser extension in `apps/extension`.
- The shared protocol in `packages/shared`.

Out of scope:

- Vulnerabilities in a streaming service's own player or website.
- Issues that require a compromised browser or a malicious extension with broad
  host permissions.
- Denial of service that only affects your own machine or your own room.

## Design notes

- A room code is permission to request admission, not an identity. The server
  assigns each connection a fresh member identity; a public member id from a
  snapshot cannot be used to impersonate or disconnect another member.
- Rooms have bounded membership, bounded message sizes, and join-attempt
  limits.
- The extension only requests the permissions it needs: `storage`, `tabs`, and
  `clipboardWrite`, plus host access to the supported streaming services.
