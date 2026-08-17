# Hype PRs

Hype PRs is a web-first, action-first GitHub pull request inbox. It prioritizes
what needs the connected user instead of leading with an alphabetical repository
list, then keeps discovery, changed files, diffs, and formal review submission in
one interface.

The implemented MVP includes:

- Needs attention as the default, plus Review requested, My PRs, Checks failing,
  Waiting on others, Recent activity, Stale, By repository, By author, and All
  pull requests.
- Explainable action reasons and deterministic ranking.
- Search, explicit sorts, manual refresh, and keyboard navigation.
- A directory file tree and split/unified multi-file diffs powered by
  `@pierre/diffs`.
- Pull-request-level Comment, Approve, and Request changes reviews.
- GitHub App authorization for the web.
- A complete preview mode with sample data when GitHub is not configured.

See [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) for the exact MVP boundary and
post-MVP work.

## Requirements

- Node.js `>=22.13.0`
- npm
- A GitHub App only when using live GitHub data

## Explore the preview

No credentials are required.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. The app remains in preview mode until a GitHub App
is configured and connected.

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

Prefer expiring user access tokens so refresh tokens are available.

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
`SESSION_SECRET` must never be exposed to browser code or committed.

Set `SITE_URL` to the canonical public origin (for example
`https://hype-prs.example.com`) in production. Page metadata falls back to the
request headers when it is unset, and those headers are client-supplied.

Restart `npm run dev`, choose **Connect GitHub**, and complete GitHub's normal
authorization and organization approval flow.

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
| Preview data | `lib/demo-data.ts` |

The browser path is:

```text
PrWorkspace -> same-origin /api/github routes -> shared GitHub API module
```

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
- External links are limited to HTTPS `github.com` URLs.
- Public API errors are sanitized.

Disconnect removes the local session and returns to the unauthenticated landing
page. Preview mode starts only through the explicit preview action. Do not add
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
- GitHub Enterprise Server and other forges.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the vinext web development server. |
| `npm run build` | Build the production web application. |
| `npm run start` | Run the built web application. |
| `npm run deploy` | Build and deploy the web application to Cloudflare Workers. |
| `npm run lint` | Run ESLint with the repository configuration. |
| `npm run test:unit` | Run TypeScript unit tests under `tests/*.test.ts`. |
| `npm run test:rendered` | Test the rendered production HTML. |
| `npm test` | Run unit tests, the web build, and the rendered test. |

On a clean checkout, run lint, then run the full configured test/build
pipeline:

```bash
npm run lint
npm test
```

## Troubleshooting

- **Connect dialog says GitHub is not configured:** provide the web environment
  variables, then restart the process.
- **GitHub returns 403:** check App installation, selected repositories,
  organization approval, SSO authorization, and API rate-limit status.
- **A diff is unavailable:** use the displayed **Open in GitHub** action. The
  PR may be binary, truncated, oversized, or inaccessible to the App.
- **A GitHub link will not open:** external links are limited to HTTPS
  `github.com` URLs.

## Third-party software

`@pierre/diffs` 1.2.12 is Apache-2.0 licensed. Distribution requirements and
upstream links are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The web build exposes the
complete upstream license at `/licenses/pierre-diffs` and notices at
`/licenses/notices`.
