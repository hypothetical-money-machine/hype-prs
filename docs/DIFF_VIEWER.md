# Diff Viewer Integration

Status: MVP implementation contract

Library target: `@pierre/diffs` 1.2.12

## Decision

Use the React `CodeView` component as the pull request's code-review surface.
It owns a single virtualized scroll region containing all renderable changed
files and supports sticky file headers, split or unified layouts, line
selection, annotations, and scrolling to a file or line.

`PatchDiff` is useful for a one-patch smoke test, and `MultiFileDiff` is useful
when both complete file versions are already available. Neither should replace
`CodeView` for the pull request detail page because the changed-file tree needs
a stable item-scrolling API and large pull requests need a virtualized,
multi-file surface.

DiffsHub is an architectural reference, not a dependency. Its package is
private and consumes `@pierre/diffs` from the Pierre monorepo workspace.

## Package boundary

The package is ESM-only. Import parsers, utilities, and shared types from the
root entry point; import React components and handles from the React entry
point:

```tsx
import {
  parsePatchFiles,
  type CodeViewItem,
} from '@pierre/diffs';
import {
  CodeView,
  type CodeViewHandle,
} from '@pierre/diffs/react';
```

Do not import `parseDiffFromFile` or `parsePatchFiles` from
`@pierre/diffs/react`. The 1.2.12 React runtime does not export those
utilities, even though one upstream documentation example imports
`parseDiffFromFile` from that entry point.

No package stylesheet import is required. Diffs renders its internal styles in
Shadow DOM. Prefer its supported options and CSS custom properties over
`unsafeCSS`; upstream does not guarantee `unsafeCSS` selector compatibility
across patch releases.

## Patch-to-viewer adapter

The preferred input is a complete Git unified diff for the current pull
request base/head pair. Parse it once and flatten the returned patches into
`CodeViewItem` records:

```tsx
import {
  parsePatchFiles,
  type CodeViewItem,
} from '@pierre/diffs';
import {
  CodeView,
  type CodeViewHandle,
} from '@pierre/diffs/react';
import { useMemo, useRef } from 'react';

interface PullRequestDiffProps {
  baseSha: string;
  cacheKey: string;
  headSha: string;
  patchText: string;
}

export function PullRequestDiff({
  baseSha,
  cacheKey,
  headSha,
  patchText,
}: PullRequestDiffProps) {
  const viewerRef = useRef<CodeViewHandle<undefined> | null>(null);

  const items = useMemo<CodeViewItem[]>(
    () =>
      parsePatchFiles(patchText, cacheKey).flatMap((patch, patchIndex) =>
        patch.files.map((fileDiff, fileIndex) => ({
          id: codeViewItemId(patchIndex, fileIndex, fileDiff.name),
          type: 'diff',
          fileDiff,
        }))
      ),
    [cacheKey, patchText]
  );

  return (
    <CodeView
      key={`${baseSha}:${headSha}`}
      ref={viewerRef}
      items={items}
      style={{ height: '100%', overflow: 'auto' }}
      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        themeType: 'system',
        diffStyle: 'split',
        stickyHeaders: true,
        layout: { paddingTop: 0, gap: 1, paddingBottom: 0 },
      }}
    />
  );
}

function codeViewItemId(
  patchIndex: number,
  fileIndex: number,
  path: string
): string {
  return `diff:${patchIndex}:${fileIndex}:${path}`;
}
```

The containing flex or grid layout must give `CodeView` a definite height and
allow it to shrink, normally with `min-height: 0`. Without a bounded scroll
container, virtualization and sticky headers cannot behave correctly.

For the initial MVP, fetch and parse a complete patch before mounting the
viewer. If profiling shows that large pull requests block the browser, evolve
to DiffsHub's streaming model:

1. Split the response only at complete `diff --git` file boundaries.
2. Parse each complete file with
   `processFile(fileText, { isGitDiff: true, cacheKey })`.
3. Seed the uncontrolled viewer with `initialItems`.
4. Append later batches through `CodeViewHandle.addItems`.
5. Yield between bounded batches so navigation remains responsive.

Do not mix controlled `items` ownership with imperative `addItems` or
`updateItem` ownership in the same mounted viewer.

## Stable identity and updates

Every renderable changed file has:

- a unique, stable `CodeViewItem.id`;
- its current path and optional previous path;
- its `CodeViewItem` record;
- a file-tree record that stores the same item ID.

The adapter must not rely on a path alone being unique across multi-commit
patches. The patch and file ordinals in `codeViewItemId` prevent collisions.
For a normal aggregated pull request diff, the path remains the human-facing
tree key.

Changing a same-ID item's diff, annotations, or `collapsed` state requires
incrementing its numeric `version`. A new pull request base/head pair should
remount the controlled viewer so stale measured layout and highlighting state
cannot carry across revisions.

The optional cache-key prefix passed to `parsePatchFiles` should include the
repository identity, pull request number, base SHA, and head SHA. It must
change when the rendered content changes.

## File-tree scrolling contract

The file tree and `CodeView` share an adapter-owned lookup:

```ts
interface DiffTreeTarget {
  path: string;
  itemId: string;
  renderState: 'renderable' | 'binary' | 'truncated' | 'oversized' | 'error';
}
```

When the user activates a renderable tree item:

```ts
viewerRef.current?.scrollTo({
  type: 'item',
  id: target.itemId,
  align: 'start',
  behavior: 'smooth-auto',
});
```

Tree activation must also select the file and move focus into the review
surface without changing the tree's sort or expansion state. Keyboard and
pointer activation use the same command. A renamed file is shown at its new
path, with the previous path retained as metadata.

If the target is intentionally collapsed, scrolling to its header is still
valid. If product behavior later expands a collapsed file automatically, the
controlled item must first be updated with `collapsed: false` and an
incremented `version`; issue `scrollTo` after React commits that update.

Non-renderable tree items do not call `CodeView.scrollTo`. They select and
focus the corresponding degraded-state panel described below.

## Split and unified presentation

Split view is the desktop default. Unified view is the compact-window default
and remains directly selectable by the user. Changing presentation updates
the shared `CodeView` options; it does not rebuild the file tree or create a
second copy of pull request state.

The viewer may remember the user's preference locally. A responsive fallback
to unified view must not overwrite an explicit preference merely because the
window was temporarily narrow.

## Binary, truncated, oversized, and failed diffs

The detail page must never turn missing diff content into a blank viewer.
Classify each changed file before creating the renderable item list and keep
all files in the changed-file tree.

### Binary

Show a file-level panel with the path, change type, and any available size or
rename metadata. State that a textual diff is unavailable for the binary
file. Do not synthesize a text diff from binary data.

### Truncated

If GitHub omits or truncates patch content, label the file as truncated and
offer an explicit "Open on GitHub" fallback when its URL is available. Do not
describe the visible fragment as the complete change.

### Oversized

Apply a configured client rendering budget before syntax highlighting. An
oversized file starts collapsed behind a panel that reports why automatic
rendering was skipped. If an explicit load action is supported, it remains
bounded and cancellable. Very large pull requests should use streamed,
batched items and may initially collapse files rather than locking the UI.

### Parse or render failure

Catch parser and renderer errors at the file or request boundary. Show a retry
action and the GitHub fallback link without exposing tokens, response headers,
or raw internal error details. Other successfully parsed files remain usable.

The tree exposes a distinct status for each degraded state, and aggregate
changed-file counts continue to include degraded files.

## Performance progression

Syntax highlighting runs on the main thread by default. That is the MVP path
until measured traces show unacceptable blocking.

The optional worker pool is experimental. If adopted, Vite's supported worker
form is:

```ts
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';

export function workerFactory(): Worker {
  return new Worker(WorkerUrl, { type: 'module' });
}
```

Wrap the review surface with `WorkerPoolContextProvider`, choose a small pool,
and preload only common languages. Verify the worker URL, content security
policy, and syntax highlighting in both the production web build and packaged
Electron renderer before enabling it by default.

## Security and distribution

Patch text and source content may flow only between GitHub, the application
backend where policy permits, and the user's approved renderer. Do not send
source or diffs to analytics, crash-reporting payloads, or unrelated third
parties.

The web and Electron distributions must comply with
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). Electron packaging must
include the complete upstream `@pierre/diffs` `LICENSE.md`, not only a notice
or web link.

## Primary sources

- [`@pierre/diffs` 1.2.12 package manifest](https://github.com/pierrecomputer/pierre/blob/diffs-v1.2.12/packages/diffs/package.json)
- [React API examples](https://github.com/pierrecomputer/pierre/blob/diffs-v1.2.12/apps/docs/app/%28diffs%29/docs/ReactAPI/constants.ts)
- [CodeView guide](https://github.com/pierrecomputer/pierre/blob/diffs-v1.2.12/apps/docs/app/%28diffs%29/docs/CodeView/content.mdx)
- [CodeView React example](https://github.com/pierrecomputer/pierre/blob/diffs-v1.2.12/apps/docs/app/%28diffs%29/docs/CodeView/constants.ts)
- [DiffsHub item construction](https://github.com/pierrecomputer/pierre/blob/diffs-v1.2.12/apps/diffshub/lib/diffsHubDataAccumulator.ts)
- [DiffsHub viewer integration](https://github.com/pierrecomputer/pierre/blob/diffs-v1.2.12/apps/diffshub/components/DiffsHubViewer.tsx)
- [DiffsHub streaming loader](https://github.com/pierrecomputer/pierre/blob/diffs-v1.2.12/apps/diffshub/components/usePatchLoader.ts)
- [Vite worker-pool example](https://github.com/pierrecomputer/pierre/blob/diffs-v1.2.12/apps/docs/app/%28diffs%29/docs/WorkerPool/constants.ts)
- [Apache License 2.0 for `@pierre/diffs`](https://github.com/pierrecomputer/pierre/blob/diffs-v1.2.12/packages/diffs/LICENSE.md)
