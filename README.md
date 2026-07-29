# Hype PRs

Hype PRs is a web-first, action-first GitHub pull request inbox with a macOS
Electron menu-bar shell. It prioritizes what needs the connected user instead
of leading with an alphabetical repository list, then keeps discovery, changed
files, diffs, and formal review submission in one interface.

The implemented MVP includes:

- Needs attention as the default, plus Review requested, My PRs, CI failing,
  Awaiting response, Recently updated, Stale, Repository, Author, and All PRs.
- Explainable action reasons and deterministic ranking.
- Search, explicit sorts, manual refresh, and keyboard navigation.
- A directory file tree and split/unified multi-file diffs powered by
  `@pierre/diffs`.
- Pull-request-level Comment, Approve, and Request changes reviews.
- GitHub App authorization for web and Electron.
- A macOS menu-bar panel and compact action count. The panel is explicitly not
  always on top.
- A complete synthetic demo mode when GitHub is not configured.

See [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) for the exact MVP boundary and
post-MVP work.

## Requirements

- Node.js `>=22.13.0`
- npm
- macOS for Electron development and packaging
- A GitHub App only when using live GitHub data

## Run the demo

No credentials are required.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. The app remains in demo mode until a GitHub App is
configured and connected.

## Configure live GitHub access

Hype PRs uses a GitHub App. It does not accept a personal access token in the
UI.

Configure these repository permissions on the GitHub App:

- Metadata: read
- Pull requests: read and write
- Checks: read
- Commit statuses: read
- Contents: read

The inbox reads commit objects for the current head revision, aggregate check
state, and the commit attached to the viewer's latest review. GitHub gates those
commit objects behind Contents permission even though the surrounding pull
request metadata is covered by Pull requests permission.

Install the App only on repositories the user is allowed to access. Normal
organization approval, selected-repository access, SSO, and user permissions
continue to apply.

For one App to support both surfaces:

- Add the web callback URL.
- Enable Device Flow for Electron.
- Prefer expiring user access tokens so refresh tokens are available.

### Web authorization

For local development, add this callback URL to the GitHub App:

```text
http://localhost:3000/api/github/auth/callback
```

Provide secrets through the environment or an ignored `.env.local`:

```dotenv
GITHUB_APP_CLIENT_ID=your_public_client_id
GITHUB_APP_CLIENT_SECRET=your_server_only_client_secret
SESSION_SECRET=a_strong_random_server_only_value
GITHUB_CALLBACK_URL=http://localhost:3000/api/github/auth/callback
```

`GITHUB_CALLBACK_URL` may be omitted only for local development. It is required
as an exact HTTPS URL in production. `GITHUB_APP_CLIENT_SECRET` and
`SESSION_SECRET` must never be exposed to browser code, committed, or placed in
Electron configuration.

Restart `npm run dev`, choose **Connect GitHub**, and complete GitHub's normal
authorization and organization approval flow.

### Electron authorization

Electron uses Device Flow and needs only the GitHub App's public client ID.
Run the web dev server in one terminal:

```bash
npm run dev
```

Then launch Electron in another:

```bash
HYPE_GITHUB_APP_CLIENT_ID=your_public_client_id npm run electron:dev
```

`electron:dev` loads the shared UI from `http://localhost:3000`, while GitHub
requests and credentials go through the Electron main process.

To launch only from the menu-bar item, set `HYPE_SHOW_ON_START=0`.

## Package the macOS app

For a package that can connect to GitHub, put the public client ID in
`electron/config/github.json`:

```json
{
  "githubAppClientId": "your_public_client_id"
}
```

This file must contain no client secret or user token. The normal package
command fails closed when the public client ID is empty.

Build the current arm64 directory bundle:

```bash
npm run electron:pack
```

To deliberately build an unconfigured artifact for demo/testing only:

```bash
npm run electron:pack:demo
```

Electron Builder writes the output under `dist/`. The current script produces a
directory bundle, not a DMG, universal binary, signed release, or notarized
installer.

The package includes:

- the Vite-built shared renderer;
- the sandboxed Electron main/preload files;
- the public GitHub App configuration;
- the complete `@pierre/diffs` license and
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Production web build

```bash
npm run build
npm run start
```

Production hosting must provide the three server secrets used by web
authorization, use HTTPS, and register the deployed
`/api/github/auth/callback` URL with the GitHub App.

The web application uses vinext and the Cloudflare Vite plugin. The current MVP
does not use D1 or R2; `.openai/hosting.json` leaves both bindings unset.

## Architecture

| Area | Implementation |
| --- | --- |
| Shared feature UI | `components/pr-workspace.tsx` |
| Views and ranking | `lib/pr-views.ts` |
| File tree | `lib/file-tree.ts` |
| Diff surface | `components/diff-workspace.tsx` |
| GitHub queries, normalization, diffs, and review mutation | `shared/github-api.mjs` |
| Browser transport | `lib/github-gateway.ts` and `app/api/github/` |
| Web session protection | `lib/server/github-session.ts` |
| Electron shell and GitHub transport | `electron/main.mjs` |
| Restricted renderer bridge | `electron/preload.cjs` |
| Electron renderer entry | `electron/renderer/main.tsx` |
| Demo data | `lib/demo-data.ts` |

The browser path is:

```text
PrWorkspace -> same-origin /api/github routes -> shared GitHub API module
```

The Electron path is:

```text
PrWorkspace -> frozen preload bridge -> validated IPC -> shared GitHub API module
```

Both surfaces consume the same normalized pull request and diff types.

### Live inbox coverage

The current GitHub query fetches up to 50 open results from each of four
viewer-relative searches: authored, assigned, review requested, and reviewed.
It deduplicates those buckets by GitHub node ID. It is a personal PR inbox, not
an organization-wide inventory.

### Diff limits

The app fetches GitHub's complete PR diff plus paginated changed-file metadata.
It verifies that both the base and head revisions remain stable while those
representations load, and re-checks both before submitting a review. It falls
back to GitHub instead of attempting unsafe rendering when:

- the diff exceeds 4 MiB;
- the changed-file list reaches GitHub's 3,000-file limit;
- the complete patch cannot be safely parsed.

When GitHub omits text for an individual binary or oversized file, only that
file shows a degraded panel; the other textual diffs remain usable.

For adapter details, see [docs/DIFF_VIEWER.md](docs/DIFF_VIEWER.md).

## Security model

Hype PRs is another GitHub client. It does not bypass employer device policy,
GitHub App installation controls, organization approval, SSO, or repository
permissions.

### Web

- Authorization uses state, PKCE, and a ten-minute one-time transaction.
- The server exchanges the authorization code; the browser never receives the
  GitHub App client secret.
- The token set is AES-GCM encrypted in an `HttpOnly`, `SameSite=Lax` cookie.
  Production cookies are `Secure`.
- Disconnect and review mutations require same-origin requests.
- Public API errors are sanitized.

### Electron

- The package contains only a public GitHub App client ID.
- The token set is encrypted with Electron `safeStorage`, backed by macOS
  Keychain, and atomically written with mode `0600`.
- The renderer is sandboxed with Node integration disabled, context isolation
  and web security enabled, and a small frozen preload API.
- IPC senders and mutation inputs are validated.
- Packaged assets are served from a restricted `hype://app` protocol.
- New windows and webviews are denied.
- Only unpackaged development builds may load `localhost:3000`; packaged builds
  require the internal `hype://app` origin.
- External links are limited to HTTPS `github.com` URLs.
- Surfaced Electron errors redact bearer tokens.

Disconnect removes the local session and returns to the unauthenticated landing
page. Demo mode starts only through the explicit preview action. Do not add
tokens, secrets, private diffs, or repository data to logs or committed fixtures.

## Current MVP limits

These are deliberately outside the supported MVP:

- line-level comments and suggestions;
- local snooze, done, mute, pin, read/unread, and viewed-file persistence;
- configurable native notifications and dependable background delivery;
- repository include/exclude settings;
- scheduled background synchronization;
- authenticated team-review enumeration and live mention detection;
- pagination beyond the first 50 results in each viewer-relative search;
- exact timeline/thread ownership and required-check detail;
- live issue labels and issue-comment counts;
- merge, close, update-branch, and rerun-check mutations;
- GitHub Enterprise Server, other forges, mobile, signing, and notarization.

The Electron code may emit a generic development notification when its cached
action count rises. It is not a configurable or supported notification product
yet.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the vinext web development server. |
| `npm run build` | Build the production web application. |
| `npm run start` | Run the built web application. |
| `npm run lint` | Run ESLint with the repository configuration. |
| `npm run test:unit` | Run TypeScript unit tests under `tests/*.test.ts`. |
| `npm run test:rendered` | Test the rendered production HTML. |
| `npm test` | Run unit tests, web build, rendered test, and Electron renderer build. |
| `npm run electron:renderer` | Build the packaged Electron renderer with Vite. |
| `npm run electron:dev` | Launch Electron against the local web server. |
| `npm run electron:pack` | Validate the public client ID, then build an unsigned arm64 macOS directory bundle. |
| `npm run electron:pack:demo` | Build an explicitly unconfigured demo-only bundle. |

On a clean checkout, run lint before the Electron renderer creates ignored
bundle output, then run the full configured test/build pipeline:

```bash
npm run lint
npm test
```

## Troubleshooting

- **Connect dialog says GitHub is not configured:** provide the web environment
  variables or Electron public client ID, then restart the process.
- **GitHub returns 403:** check App installation, selected repositories,
  organization approval, SSO authorization, and API rate-limit status.
- **Electron refuses to persist the session:** macOS Keychain-backed
  `safeStorage` is unavailable; the app intentionally fails closed.
- **A diff is unavailable:** use the displayed **Open in GitHub** action. The
  PR may be binary, truncated, oversized, or inaccessible to the App.
- **The packaged window disappears when focus changes:** that is the intended
  menu-bar-panel behavior. Click the menu-bar item to show it again.

## Third-party software

`@pierre/diffs` 1.2.12 is Apache-2.0 licensed. Distribution requirements and
upstream links are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The web build exposes the
complete upstream license at `/licenses/pierre-diffs` and notices at
`/licenses/notices`.
