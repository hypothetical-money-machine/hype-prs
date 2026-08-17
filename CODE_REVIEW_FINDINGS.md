# Code review findings — branch `t3code/cache-and-page-pull-requests`

This is a handoff describing what a medium-effort review of the working-tree diff found. It
describes the defects and how they manifest. It deliberately does not prescribe fixes — decide
those yourself once you have read the code.

The diff under review touches `app/api/github/inbox/route.ts`, `app/globals.css`,
`components/pr-workspace.tsx`, `lib/github-gateway.ts`, `shared/github-api.mjs`, plus the new
`components/use-refresh-interval.ts`, `lib/inbox-cache.ts`, and four new or modified test files.
The theme of the change is inbox pagination plus a localStorage cache plus a user-configurable
auto-refresh interval.

Findings are ordered roughly by severity. Four of them were confirmed by actually running
`tsc --noEmit`; the rest come from reading the code and are marked as such.

## The GraphQL `offset` argument does not exist — `shared/github-api.mjs:135`

This is the one that matters most, because it means the feature does not work at all.

`INBOX_PAGE_QUERY` declares a variable `$offset: Int!` and threads it into all four of the
`search` aliases as `offset: $offset`. GitHub's GraphQL API does not have an `offset` argument on
the `search` connection. Like every Relay-style connection in that schema, it accepts `first` and
`after` for forward paging and `last` and `before` for backward paging, and nothing else. An
unknown argument is a document validation error, so GitHub rejects the whole query before
executing any of it and returns an error along the lines of `Unknown argument "offset" on field
"search"`.

The consequence is worse than a failed second page. `loadInboxPageWithToken` only swallows errors
matching `"Resource not accessible by integration"`; anything else throws, and the route turns
that into a 502. Because the client now routes *both* page 1 and page 2 through this same query,
there is no surviving path that returns an inbox. A live session gets a 502 on bootstrap and the
inbox never populates.

Worth understanding before you touch it: GitHub's `search` connection is cursor-paginated, so
"page 2" is not addressable independently of page 1 — you need the `endCursor` from page 1's
`pageInfo` to ask for page 2, which makes the two requests sequential rather than parallel. Check
whether the current client code assumes it can fire them concurrently, because that assumption
may also need to change.

The new test in `tests/github-api.test.ts` does not catch any of this. It stubs `fetch` and
asserts only on the shape of the outgoing variables, so it verifies that the client sends
`offset` — not that the server accepts it. Any test that would have caught this needs either a
real request or a schema-aware mock.

## New exports missing from the ambient declarations — `shared/github-api.d.mts:40`

`shared/github-api.mjs` gained two new exported functions, `loadInboxPageWithToken` and
`mergeInboxPayloads`, but the hand-maintained `.d.mts` next to it was not updated to declare
them. Since the `.mjs` has no types of its own and consumers resolve through the declaration
file, TypeScript believes those exports do not exist.

`tsc --noEmit` fails with TS2724 and TS2305 across four files that import them:
`app/api/github/inbox/route.ts`, `lib/github-gateway.ts`, `tests/github-api.test.ts`, and
`tests/inbox-cache.test.ts`. This was confirmed by running the compiler, not inferred. Note that
this pattern — a `.mjs` shadowed by a hand-written `.d.mts` — will keep producing this class of
break every time someone adds an export, so it may be worth a note to whoever owns that file.

## `intervalMs` is nullable inside the closures — `components/use-refresh-interval.ts:113`

`intervalMs` is typed `number | null`. There is an early return above that guarantees it is
non-null by the time the scheduling closures run, but the guard does not narrow through a closure
boundary, so TypeScript still sees `number | null` at the two `nextAt = Date.now() + intervalMs`
sites on lines 113 and 128 and reports TS18047.

Runtime behaviour is correct — the early return really does prevent the null case — so this is
purely a compile break, but it is a compile break, confirmed by `tsc --noEmit`.

## `request.nextUrl` on a plain `Request` — `app/api/github/inbox/route.ts:21`

The route handler's parameter is typed as the DOM `Request`, but the body reads
`request.nextUrl.searchParams`. `nextUrl` is a property Next.js adds on `NextRequest`, not
something `Request` has, so this is TS2339.

The interesting part is that this survives in production. The App Router does in fact pass a
`NextRequest` at runtime, so the property is there and the handler works when Next calls it. It
breaks the moment anything else calls it — most obviously a route unit test constructing a plain
`Request`, which gets `Cannot read properties of undefined (reading 'searchParams')`. So this is
both a build break today and a latent obstacle to testing this route directly.

## Page merging discards bucket membership — `shared/github-api.mjs:645`

`mergeInboxPayloads` deduplicates by doing `seen.set(id, pullRequest)` across the two pages. The
problem is what it is deduplicating: each page has already been run through `mapInboxPayload`
independently, and that mapping is where bucket membership gets baked into derived per-PR flags.
Look at `mapPullRequest` from line 681 onward — `authored`, the `reviewRequested` reason, and the
team-review flag are all derived from which search bucket the PR arrived in.

So a pull request that appears in page 1's `authored` bucket and again in page 2's `reviewed`
bucket produces two different mapped objects for the same id, with contradictory flags. The
`Map.set` keeps whichever came last, which means the page-2 classification silently overwrites
the page-1 one. The user-visible result is that the PR drops out of the Authored view and out of
its count, with no error and nothing in the logs — it simply appears to be filed under one
category instead of both.

Note that this is structural rather than an off-by-one: the information needed to merge correctly
is destroyed by the per-page mapping before the merge ever runs. Whoever fixes this will probably
need to change where mapping happens relative to merging, so read both functions together.

This one comes from reading the code rather than from an executed repro.

## Auto-refresh can move the user off the PR they are reading — `components/pr-workspace.tsx:240`

`refreshInbox` calls `setInboxData(firstPage)` and then immediately validates the current
selection against `firstPage.pullRequests` — before page 2 has arrived. If the selected PR
happens to live only in page 2, that guard fails and selection is reset to
`firstPage.pullRequests[0]`.

The reason this does not self-correct is subtle. When page 2 lands and the merged payload is
installed, the same guard runs again, but by then the selection is the page-1 PR that was just
force-selected, and that PR *is* present in the merged list. So the guard is satisfied and
nothing restores the original selection. The user is silently left somewhere else.

Before the auto-refresh work this was mostly theoretical, because a refresh was something the
user initiated and could see. The new interval timer makes it fire unprompted every one to thirty
minutes, so it will now happen to someone in the middle of reading a diff.

Read from the code, not reproduced.

## A truncated page-1 payload gets persisted — `components/pr-workspace.tsx:242`

`writeInboxCache(window.localStorage, firstPage)` runs before page 2 has been fetched, so what
lands in localStorage at that instant is a partial inbox — capped at whatever per-bucket limit
page 1 used, 25 by default.

Under normal conditions the merged payload overwrites it moments later and nobody notices. The
failure is in the gap: if the page-2 request errors, gets aborted, or the tab is closed before it
resolves, the truncated payload is what stays on disk. There is nothing in the cache record
marking it as partial, so on the next boot it hydrates and renders as a complete inbox, carrying
a "Last synced" timestamp that asserts freshness. The user sees a plausible but silently short
list of pull requests and has no way to tell.

Note the interaction with the interval feature: a shorter auto-refresh interval means more
page-1-writes per session, so more chances to be interrupted in that window.

Read from the code, not reproduced.

## Refresh-interval storage key is hardcoded on the read path — `components/use-refresh-interval.ts:18`

Writes go through `writeRefreshIntervalId`, which uses `REFRESH_INTERVAL_STORAGE_KEY` imported
from `lib/inbox-cache.ts`. Reads do not: both `readStoredInterval` and the `handleStorage` event
handler inline the string literal `"hype-prs-refresh-interval-ms-v1"` instead. The module already
imports from `lib/inbox-cache.ts`, so this is not a dependency-avoidance decision, just a
duplicated constant.

Today the two agree and everything works. The trap is the `-v1` suffix, which is an explicit
invitation to bump the version. When someone does, writes move to `-v2` while reads keep looking
at `-v1` and always come back empty, so `readStoredInterval` returns `"off"` forever. The setting
appears to save and then quietly fails to persist across reloads, with no error to trace.

## Non-integer `perBucket` is validated as acceptable, then 502s — `app/api/github/inbox/route.ts:33`

The query-parameter validation uses `Number.isFinite` plus a range check. `Number.isFinite(25.5)`
is true and `25.5` sits inside the `1..50` range, so a request like `?perBucket=25.5` passes
validation and is sent on to GraphQL — where the `Int!` coercion rejects it.

The user-visible effect is that a malformed request produces a 502, which reads as "the upstream
is broken", rather than the 400 the validation block was clearly written to produce. The same
gap applies to `offsetRaw`, which is validated the same way.

## A client module now pulls in the server GitHub API layer — `lib/github-gateway.ts:3`

`lib/github-gateway.ts` carries `"use client"`, and it now imports from `shared/github-api.mjs`
in order to reuse `mergeInboxPayloads`. That single import drags the whole module into the client
bundle: `INBOX_QUERY`, `INBOX_PAGE_QUERY`, `PR_FRAGMENT`, and the diff and review query strings,
which together are several kilobytes of query text that the browser has no use for.

To be clear about what this is and is not: there are no secrets in that file, so this is not a
credential leak. It is bundle weight, and specifically it undoes part of the entry-chunk
splitting work done in commit `ac0a012`, so it is a regression against something that was
recently and deliberately fixed. Whoever picks this up should look at `ac0a012` to see what that
change was protecting.

## The bootstrap path never clears a previous error — `components/pr-workspace.tsx:296`

`refreshInbox` begins by calling `setError(null)`. `loadLiveInbox`, which runs on bootstrap, does
not. These two functions are otherwise near-copies of each other (see the note on duplication
below), and this is one of the places where the copies have drifted.

The visible symptom appears when a user returns after a session that ended in an error. The
cached inbox hydrates and renders correctly, but the stale error banner from last time is still
sitting above it, so the UI simultaneously shows good data and claims something failed. It
resolves itself only once page 2 comes back, several seconds later.

## Focus outline removed with no replacement — `app/globals.css:1502`

The new refresh-interval `select` has `outline: none` applied without any substitute focus
indicator. A keyboard user tabbing through the toolbar gets no visual signal that the control has
focus, which matters more than usual here because the control changes a setting on keypress. The
surrounding `.refresh-interval-select` has no `:focus-within` styling either, so there is nothing
picking up the slack.

## Two smaller notes, not filed as findings

The comment above `mergeInboxPayloads` states that rate limits "are summed". Only `cost` is
actually summed. `remaining` is reduced with a minimum and `resetAt` with a maximum, which is the
correct behaviour but not what the comment says. A reader trusting the comment over the code
would draw the wrong conclusion about what the merged rate-limit record means.

Roughly forty lines are duplicated close to verbatim between `refreshInbox` and `loadLiveInbox`
in `components/pr-workspace.tsx`. This is not a style objection — the two copies have already
diverged, and the missing `setError(null)` described above is the divergence. Several other
findings in this document (the premature cache write, the premature selection reset) exist in
both copies and will need fixing twice as things stand.

## Verification status

`tsc --noEmit` was actually run, and the four compile findings above — the missing `.d.mts`
exports, the nullable `intervalMs`, the `nextUrl` access, and the errors those cause in dependent
files — are confirmed by its output. The hardcoded storage key and the removed focus outline are
confirmed by direct reading; there is nothing uncertain about what that code does.

The remaining findings come from reading the code and reasoning about the call paths. None of
them were reproduced against a running app or a live GitHub token. The `offset` finding rests on
GitHub's published GraphQL schema for the `search` connection rather than on an observed request,
so if you have a token handy, sending the query once is a cheap way to confirm it before you
plan any work around it.
