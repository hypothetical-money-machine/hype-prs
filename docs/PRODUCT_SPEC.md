# Hype PRs MVP Product Specification

Status: implemented MVP contract

Last updated: 2026-07-28

## Product thesis

Hype PRs is an action-first GitHub pull request inbox for engineers who work
across multiple repositories. Its first screen answers:

1. What needs me now?
2. What am I blocking?
3. Which of my pull requests is unhealthy or ready?
4. What changed recently?

The product is a web application. It renders the inbox, pull request detail,
file tree, diff, and review UI in the browser, with credentials stored
server-side.

The default is **Needs attention**, not a repository-alphabetical list.
Repository and author groupings are available as secondary views.

## MVP users and jobs

- **Reviewer:** find direct review obligations and inspect the changed files
  without opening each repository.
- **Author:** spot changes requested, failing CI, merge conflicts, and work that
  is approved and green.
- **Maintainer:** move from a personal action queue into repository or author
  groupings when broader context is useful.

## Implemented product model

The live inbox combines the first 50 open pull requests from each of four
GitHub searches for the connected viewer:

- authored by the viewer;
- assigned to the viewer;
- requesting the viewer's review;
- previously reviewed by the viewer.

Results are deduplicated by GitHub node ID. The normalized record includes
repository, author, title, branches, draft state, diff statistics, aggregate
check state, review decision, review requests, mergeability, latest viewer
review, current head SHA, and timestamps supplied by GitHub.

The current ranking is deliberately explainable and deterministic. It uses
available aggregate GitHub fields; it does not claim exact thread ownership,
required-check policy evaluation, or full timeline reconstruction.

## Action ranking

Each pull request receives one dominant reason. Lower lane numbers rank first;
the oldest reason timestamp ranks first within a lane. Most recent meaningful
activity, repository name, and PR number are deterministic tie-breakers.

### Lane 1: direct obligation

In precedence order:

1. **Re-review:** the latest reviewed commit differs from the current head and
   the viewer is still requested.
2. **Changes requested:** the viewer authored a non-draft pull request whose
   aggregate review decision is changes requested.
3. **Review requested:** the viewer has a direct review request.
4. **Mentioned:** the normalized record says the viewer was mentioned.

### Lane 2: authored operational action

In precedence order:

1. **CI failed:** an authored pull request has a failing aggregate check state.
2. **Merge conflict:** an authored pull request is conflicting.
3. **Ready:** an authored, non-draft pull request is approved, green, and
   mergeable.

### Lane 3: modeled team obligation

- **Team review:** the canonical/demo model can represent a non-draft pull
  request requesting one of the viewer's teams. Live viewer-team enumeration is
  post-MVP and is not inferred from unrelated team requests.

### Lane 4: at risk

- **Stale:** no meaningful GitHub update for at least seven days and the viewer
  is not merely participating.

### Lane 5: context

In precedence order:

1. **Awaiting review:** an authored pull request is waiting for review.
2. **Checks running:** an authored pull request has pending checks.
3. **Draft:** draft work is kept out of the action queue.
4. **Updated:** remaining recently changed work.

The interface shows the reason chip, a plain-language explanation, and the
reason timestamp on every row.

## Implemented views

A pull request may appear in more than one view.

| View | Membership and order |
| --- | --- |
| **Needs attention** | Lanes 1–4, ordered by lane, oldest available action signal, latest activity, then stable repository/number tie-breaks. This is the default. |
| **Review requested** | Non-draft direct review requests, plus modeled team requests when present. Direct requests rank ahead of team requests; least-recently updated requests rank first because the current query does not expose request time. |
| **My PRs** | Open pull requests authored by the viewer, action-ranked. |
| **CI failing** | Fetched pull requests whose aggregate check state is failure, action-ranked. |
| **Awaiting response** | Authored pull requests classified as awaiting review or checks running. |
| **Recently updated** | Pull requests updated within the non-stale window, newest activity first by default. |
| **Stale** | Pull requests with no meaningful GitHub update for at least seven days. |
| **By repository** | All fetched pull requests grouped by repository. Groups with more actionable items rank first; names break ties. |
| **By author** | All fetched pull requests grouped by author. Groups with more actionable items rank first; names break ties. |
| **All PRs** | The complete fetched and deduplicated set, recently updated first by default. |

All views support client-side search across title, repository, author, PR
number, and reason text. Available explicit sorts are action priority, recent
meaningful activity, oldest created, and raw GitHub update time. Repository and
author views keep their actionable-group order and apply the selected sort
within each group.

## Core workflows

### 1. Launch and sign in

An unauthenticated launch opens on the GitHub sign-in flow rather than loading
synthetic pull requests. A user with an existing valid session continues
directly to their live workspace. The launch screen also offers an explicit
**Explore preview mode** action that enters the full interface with synthetic
data and no GitHub authorization.

GitHub pull request URLs can be opened in Hype PRs by swapping the host while
keeping the path, for example
`https://hype-prs.com/owner/repo/pull/123/changes`. The app normalizes tab
suffixes to `/owner/repo/pull/123`, selects that pull request in the workspace,
and loads it even when it is outside the default inbox searches. Completing
GitHub authorization from a deep link returns to the same path.

### 2. Explore in demo mode

With no GitHub App configuration, the full shared UI loads synthetic pull
requests and diffs. Views, ranking, search, keyboard navigation, file browsing,
diff layout, and the formal review dialog remain usable without live access.
Demo review submission changes demo state only.

### 3. Connect GitHub

- The web app uses GitHub's authorization-code flow with state and PKCE. The
  server exchanges the code and stores the token set in an encrypted,
  `HttpOnly`, `SameSite=Lax` session cookie.
- The flow validates the connected viewer before loading live data.
- Disconnect deletes the active web cookie and returns the interface to the
  unauthenticated landing page. Demo mode remains available only through the
  landing page's explicit preview action.

The connection UI states that Hype PRs is another GitHub client and that normal
GitHub App installation, organization approval, SSO, and managed-device policy
still apply.

### 4. Triage the inbox

1. Open Hype PRs in the browser.
2. Start in Needs attention and read the reason shown for each item.
3. Switch among the ten implemented views or choose an explicit sort.
4. Search by PR content or reason.
5. Select with the pointer or use `J`/`K`; use `Command/Ctrl+K` to focus search
   and `Option+Arrow` to move between views.
6. Refresh manually from the UI.

### 5. Browse changed files and diffs

Selecting a pull request loads its changed-file list and complete Git diff from
GitHub. The detail surface provides:

- a directory-first, alphabetical file tree;
- path filtering;
- collapsible directories;
- file-to-diff scrolling;
- additions, deletions, and change status;
- split and unified layouts;
- a virtualized, syntax-highlighted multi-file view using `@pierre/diffs`.

The response is accepted only when both its base and head revisions remain
unchanged across the patch and file-list fetches. Diff responses larger than
4 MiB, pull requests at GitHub's 3,000-file limit, missing text patches, binary
content, and parser failures use a clear degraded state with an **Open in
GitHub** fallback.

### 5. Submit a formal review

The review dialog supports a pull-request-level summary and GitHub's three
formal review events:

- Comment;
- Approve;
- Request changes.

Comment and Request changes require a non-empty summary in the UI. Approve is
unavailable on pull requests the viewer authored, because GitHub rejects a
self-approval. Submission
must include the displayed full base and head SHAs, re-checks both immediately
before mutation, and requires a confirmation step. A successful live
submission refreshes the inbox and reclassifies the pull request.

Line-level comments and suggestions are not part of this MVP.

## MVP scope

- Web-first React UI.
- Demo mode with representative synthetic data.
- GitHub.com user connection through an approved GitHub App.
- Live authored, assigned, review-requested, and reviewed PR discovery.
- Ten action and browse views described above.
- Explainable reason chips and deterministic action ranking.
- Search, explicit sorting, manual refresh, and keyboard navigation.
- Pull request metadata, status summary, file tree, split/unified diff, and
  large/non-text fallback.
- Formal pull-request review submission with summary.
- Open in GitHub.
- Safe handling of disconnected, denied, expired, rate-limited, unavailable,
  and truncated states.

## Explicit non-goals for MVP

- Full Git operations: clone, checkout, commit, push, rebase, or conflict
  resolution.
- Creating, editing, closing, merging, or updating pull requests.
- Rerunning workflows or changing repository settings.
- GitLab, Bitbucket, GitHub Enterprise Server, or mobile clients.
- Organization administration or engineering analytics.
- AI ranking or semantic source-code analysis.
- Bypassing device management, SSO, GitHub App approval, or repository policy.

## Post-MVP

The following are intentional follow-on work and are not required to call the
current MVP complete:

- Line-level review comments, multi-line comments, suggestions, pending review
  threads, and thread resolution.
- Persistent local inbox state such as snooze, done, mute, pin, read/unread, and
  per-file viewed progress.
- Configurable native notification rules, notification preferences, and
  reliable background notification delivery. Any current generic development
  notification is not part of the supported MVP contract.
- Repository-scope selection, include/exclude settings, and per-repository
  preferences.
- Scheduled background synchronization and webhook/push updates.
- Exact review-request timestamps and timeline-derived ownership,
  unresolved-thread awareness, and required-check-level status detail.
- Live issue labels and issue-comment counts; the synthetic demo may show these
  fields without requesting GitHub Issues permission.
- Authenticated viewer-team enumeration, team-review search, and live mention
  detection.
- File-level collapse persistence, hide-whitespace controls, streaming large
  diffs, and richer binary/image diff handling.
- Merge, close, re-request review, update branch, and rerun-check mutations.
- GitHub Enterprise Server, additional forges, mobile, team analytics, and
  opt-in privacy-preserving usage measurement.

## Security requirements

### GitHub and policy boundary

- Use a GitHub App; do not accept a personal access token in the product UI.
- Request only the GitHub App permissions needed to read pull requests,
  metadata, commit objects, and checks/statuses and to submit reviews.
- Preserve GitHub's repository selection, installation, SSO, organization
  approval, and user permission decisions.
- Treat access denial as a boundary, not a condition to work around.
- Allow external navigation only to HTTPS pages on `github.com`.

### Web

- Keep the GitHub App client secret and session secret server-side.
- Protect authorization with state, PKCE, a ten-minute transaction lifetime,
  and an encrypted one-time transaction cookie.
- Store the token set only in an AES-GCM-encrypted, `HttpOnly`, `SameSite=Lax`
  cookie; mark it `Secure` in production.
- Require same-origin requests for disconnect and review mutations.
- Return sanitized public errors without token or response-header disclosure.

### Distribution

- Keep `@pierre/diffs` attribution and its complete Apache-2.0 license with the
  web distribution as described in `THIRD_PARTY_NOTICES.md`.
- Do not place credentials in committed configuration, renderer storage, URLs,
  logs, analytics, or crash reports.

## Validation plan

### Deterministic logic

Use fixture tests for every dominant reason, view membership, stale boundary,
sort, repository/author group order, search field, and deterministic tie-break.
Assert complete ordered PR ID lists for view tests.

### GitHub integration

Against a controlled GitHub test repository, verify web authorization,
token refresh, inbox deduplication, diff/file pagination, all three review
events, revocation, organization denial, rate limiting, and disconnect.

### Diff and degraded states

Verify directory navigation and both layouts with text patches, then exercise
missing patch, binary, parse failure, oversized response, and 3,000-file
fallback behavior.

## Acceptance criteria

1. The browser renders the `PrWorkspace` feature surface and opens in
   Needs attention.
2. All ten documented views are selectable and produce deterministic membership
   and order from a fixed fixture.
3. The default list is action-ranked; repository and author names are only
   explicit groupings or tie-breakers.
4. Every listed PR shows a dominant reason, explanation, and relative time.
5. Search, all four sorts, `J`/`K`, search focus, and view-switch shortcuts work.
6. With a configured GitHub App, the app connects, validates the viewer,
   deduplicates the four live query buckets, refreshes, and disconnects without
   exposing credentials.
7. A selected PR shows its metadata, directory file tree, path filter, and
   split/unified multi-file diff.
8. Selecting a file scrolls to its diff; missing, binary, oversized, truncated,
   revision-changed, and invalid diffs show an explicit GitHub fallback instead
   of a blank pane.
9. Comment, Approve, and Request changes submit a formal review for the selected
   PR and refresh its state; no line-comment behavior is implied.
10. Web auth uses state, PKCE, encrypted `HttpOnly` cookies, and same-origin
    mutation checks; external navigation is limited to GitHub.
11. With no GitHub configuration, demo mode remains fully navigable and cannot
    mutate GitHub.

## Implementation references

- View and ranking logic: `lib/pr-views.ts`
- Shared UI: `components/pr-workspace.tsx`
- File tree and diff surface: `lib/file-tree.ts` and
  `components/diff-workspace.tsx`
- Shared GitHub transport and normalization: `shared/github-api.mjs`
- Web session and routes: `lib/server/github-session.ts` and
  `app/api/github/`
- Diff integration contract: `docs/DIFF_VIEWER.md`
- Third-party obligations: `THIRD_PARTY_NOTICES.md`
