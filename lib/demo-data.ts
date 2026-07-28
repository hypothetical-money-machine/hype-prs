import type {
  ChangedFile,
  InboxPayload,
  PullRequestDiff,
  PullRequestSummary,
} from "./types";

const NOW = Date.now();
const ago = (amount: number, unit: "hours" | "days") =>
  new Date(
    NOW - amount * (unit === "hours" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000),
  ).toISOString();

export const demoPullRequests: PullRequestSummary[] = [
  {
    additions: 184,
    author: { login: "maya-chen", name: "Maya Chen" },
    baseRefName: "main",
    changedFiles: 7,
    checkState: "SUCCESS",
    commentCount: 6,
    createdAt: ago(3, "days"),
    deletions: 42,
    headRefName: "keyboard-review-queue",
    headSha: "5e7c92f4a1",
    id: "demo-842",
    isDraft: false,
    labels: ["review", "accessibility"],
    lastMeaningfulActivityAt: ago(6, "hours"),
    mergeState: "MERGEABLE",
    mentionsViewer: false,
    number: 842,
    repository: "acme/console",
    reviewDecision: "REVIEW_REQUIRED",
    reviewRequestedAt: ago(18, "hours"),
    teamReviewRequested: false,
    title: "Add keyboard shortcuts to the review queue",
    updatedAt: ago(6, "hours"),
    url: "https://github.com/acme/console/pull/842",
    viewerLastReviewCommitSha: null,
    viewerLastReviewAt: null,
    viewerRelationship: "REVIEW_REQUESTED",
    viewerReviewState: null,
  },
  {
    additions: 96,
    author: { login: "morgan", name: "Morgan" },
    baseRefName: "main",
    changedFiles: 4,
    checkState: "FAILURE",
    commentCount: 11,
    createdAt: ago(5, "days"),
    deletions: 27,
    headRefName: "idempotent-webhook-retries",
    headSha: "3ba8c76fe2",
    id: "demo-319",
    isDraft: false,
    labels: ["reliability", "api"],
    lastMeaningfulActivityAt: ago(3, "hours"),
    mergeState: "MERGEABLE",
    mentionsViewer: false,
    number: 319,
    repository: "acme/api",
    reviewDecision: "CHANGES_REQUESTED",
    reviewRequestedAt: ago(4, "days"),
    teamReviewRequested: false,
    title: "Guard webhook retries with idempotency keys",
    updatedAt: ago(3, "hours"),
    url: "https://github.com/acme/api/pull/319",
    viewerLastReviewCommitSha: null,
    viewerLastReviewAt: null,
    viewerRelationship: "AUTHOR",
    viewerReviewState: null,
  },
  {
    additions: 58,
    author: { login: "omar-s", name: "Omar Singh" },
    baseRefName: "main",
    changedFiles: 3,
    checkState: "SUCCESS",
    commentCount: 3,
    createdAt: ago(2, "days"),
    deletions: 14,
    headRefName: "status-badge-contrast",
    headSha: "0a11ce9d71",
    id: "demo-128",
    isDraft: false,
    labels: ["design-system", "a11y"],
    lastMeaningfulActivityAt: ago(45, "hours"),
    mergeState: "MERGEABLE",
    mentionsViewer: false,
    number: 128,
    repository: "acme/design-system",
    reviewDecision: "REVIEW_REQUIRED",
    reviewRequestedAt: ago(2, "days"),
    teamReviewRequested: true,
    title: "Refresh status badge contrast and focus states",
    updatedAt: ago(45, "hours"),
    url: "https://github.com/acme/design-system/pull/128",
    viewerLastReviewCommitSha: "previous-demo-review",
    viewerLastReviewAt: ago(2, "days"),
    viewerRelationship: "TEAM_REVIEW_REQUESTED",
    viewerReviewState: "APPROVED",
  },
  {
    additions: 211,
    author: { login: "morgan", name: "Morgan" },
    baseRefName: "main",
    changedFiles: 9,
    checkState: "SUCCESS",
    commentCount: 8,
    createdAt: ago(12, "days"),
    deletions: 103,
    headRefName: "runner-images-macos-15",
    headSha: "6dc7810c09",
    id: "demo-77",
    isDraft: false,
    labels: ["infra", "macos"],
    lastMeaningfulActivityAt: ago(9, "days"),
    mergeState: "MERGEABLE",
    mentionsViewer: false,
    number: 77,
    repository: "acme/infra",
    reviewDecision: "REVIEW_REQUIRED",
    reviewRequestedAt: ago(10, "days"),
    teamReviewRequested: false,
    title: "Rotate hosted runner images to macOS 15",
    updatedAt: ago(9, "days"),
    url: "https://github.com/acme/infra/pull/77",
    viewerLastReviewCommitSha: null,
    viewerLastReviewAt: null,
    viewerRelationship: "AUTHOR",
    viewerReviewState: null,
  },
  {
    additions: 73,
    author: { login: "morgan", name: "Morgan" },
    baseRefName: "main",
    changedFiles: 5,
    checkState: "PENDING",
    commentCount: 1,
    createdAt: ago(1, "days"),
    deletions: 18,
    headRefName: "invoice-export-timestamps",
    headSha: "1e3f5d7a99",
    id: "demo-204",
    isDraft: false,
    labels: ["billing"],
    lastMeaningfulActivityAt: ago(2, "hours"),
    mergeState: "UNKNOWN",
    mentionsViewer: false,
    number: 204,
    repository: "acme/billing",
    reviewDecision: "REVIEW_REQUIRED",
    reviewRequestedAt: ago(20, "hours"),
    teamReviewRequested: false,
    title: "Backfill invoice export timestamps",
    updatedAt: ago(2, "hours"),
    url: "https://github.com/acme/billing/pull/204",
    viewerLastReviewCommitSha: null,
    viewerLastReviewAt: null,
    viewerRelationship: "AUTHOR",
    viewerReviewState: null,
  },
  {
    additions: 402,
    author: { login: "nina-p", name: "Nina Patel" },
    baseRefName: "main",
    changedFiles: 13,
    checkState: "NEUTRAL",
    commentCount: 2,
    createdAt: ago(4, "days"),
    deletions: 66,
    headRefName: "offline-sync",
    headSha: "be8849d120",
    id: "demo-511",
    isDraft: true,
    labels: ["mobile", "prototype"],
    lastMeaningfulActivityAt: ago(1, "days"),
    mergeState: "UNKNOWN",
    mentionsViewer: false,
    number: 511,
    repository: "acme/mobile",
    reviewDecision: null,
    reviewRequestedAt: null,
    teamReviewRequested: false,
    title: "Prototype offline activity synchronization",
    updatedAt: ago(1, "days"),
    url: "https://github.com/acme/mobile/pull/511",
    viewerLastReviewCommitSha: null,
    viewerLastReviewAt: null,
    viewerRelationship: "PARTICIPATING",
    viewerReviewState: null,
  },
  {
    additions: 37,
    author: { login: "liam-k", name: "Liam Kim" },
    baseRefName: "main",
    changedFiles: 2,
    checkState: "SUCCESS",
    commentCount: 9,
    createdAt: ago(3, "days"),
    deletions: 11,
    headRefName: "audit-log-redaction",
    headSha: "cb5023fc43",
    id: "demo-923",
    isDraft: false,
    labels: ["security"],
    lastMeaningfulActivityAt: ago(4, "hours"),
    mergeState: "MERGEABLE",
    mentionsViewer: true,
    number: 923,
    repository: "acme/console",
    reviewDecision: "REVIEW_REQUIRED",
    reviewRequestedAt: null,
    teamReviewRequested: false,
    title: "Redact tokens from audit-log previews",
    updatedAt: ago(4, "hours"),
    url: "https://github.com/acme/console/pull/923",
    viewerLastReviewCommitSha: null,
    viewerLastReviewAt: null,
    viewerRelationship: "ASSIGNED",
    viewerReviewState: null,
  },
  {
    additions: 126,
    author: { login: "morgan", name: "Morgan" },
    baseRefName: "main",
    changedFiles: 6,
    checkState: "SUCCESS",
    commentCount: 4,
    createdAt: ago(2, "days"),
    deletions: 32,
    headRefName: "signed-export-links",
    headSha: "9c136af25b",
    id: "demo-366",
    isDraft: false,
    labels: ["security", "storage"],
    lastMeaningfulActivityAt: ago(7, "hours"),
    mergeState: "MERGEABLE",
    mentionsViewer: false,
    number: 366,
    repository: "acme/api",
    reviewDecision: "APPROVED",
    reviewRequestedAt: ago(1, "days"),
    teamReviewRequested: false,
    title: "Use short-lived signed links for exports",
    updatedAt: ago(7, "hours"),
    url: "https://github.com/acme/api/pull/366",
    viewerLastReviewCommitSha: null,
    viewerLastReviewAt: null,
    viewerRelationship: "AUTHOR",
    viewerReviewState: null,
  },
];

const consoleFiles: ChangedFile[] = [
  {
    additions: 76,
    blobUrl: null,
    changes: 84,
    deletions: 8,
    filename: "src/features/inbox/ReviewQueue.tsx",
    patch: null,
    previousFilename: null,
    rawUrl: null,
    status: "modified",
  },
  {
    additions: 54,
    blobUrl: null,
    changes: 69,
    deletions: 15,
    filename: "src/features/inbox/useQueueShortcuts.ts",
    patch: null,
    previousFilename: null,
    rawUrl: null,
    status: "added",
  },
  {
    additions: 29,
    blobUrl: null,
    changes: 38,
    deletions: 9,
    filename: "src/features/inbox/ReviewQueue.test.tsx",
    patch: null,
    previousFilename: null,
    rawUrl: null,
    status: "modified",
  },
  {
    additions: 13,
    blobUrl: null,
    changes: 18,
    deletions: 5,
    filename: "src/styles/review-queue.css",
    patch: null,
    previousFilename: null,
    rawUrl: null,
    status: "modified",
  },
  {
    additions: 7,
    blobUrl: null,
    changes: 9,
    deletions: 2,
    filename: "docs/keyboard-shortcuts.md",
    patch: null,
    previousFilename: null,
    rawUrl: null,
    status: "modified",
  },
];

const consolePatch = `diff --git a/src/features/inbox/ReviewQueue.tsx b/src/features/inbox/ReviewQueue.tsx
index 4920b7a..0fb2954 100644
--- a/src/features/inbox/ReviewQueue.tsx
+++ b/src/features/inbox/ReviewQueue.tsx
@@ -1,14 +1,24 @@
-import { useMemo } from "react";
+import { useMemo, useRef } from "react";
 import { PullRequestRow } from "./PullRequestRow";
+import { useQueueShortcuts } from "./useQueueShortcuts";
\u0020
 export function ReviewQueue({ pullRequests, onSelect }) {
-  const orderedPullRequests = useMemo(
-    () => [...pullRequests].sort((a, b) => a.repository.localeCompare(b.repository)),
+  const listRef = useRef<HTMLDivElement>(null);
+  const orderedPullRequests = useMemo(
+    () => rankByObligation(pullRequests),
     [pullRequests],
   );
+
+  const { activeIndex } = useQueueShortcuts({
+    count: orderedPullRequests.length,
+    onOpen: (index) => onSelect(orderedPullRequests[index]),
+  });
\u0020
   return (
-    <div className="review-queue">
+    <div
+      aria-label="Pull request queue"
+      className="review-queue"
+      ref={listRef}
+      role="listbox"
+    >
       {orderedPullRequests.map((pullRequest, index) => (
         <PullRequestRow
           key={pullRequest.id}
+          active={index === activeIndex}
           pullRequest={pullRequest}
           onSelect={onSelect}
         />
diff --git a/src/features/inbox/useQueueShortcuts.ts b/src/features/inbox/useQueueShortcuts.ts
new file mode 100644
index 0000000..e136a01
--- /dev/null
+++ b/src/features/inbox/useQueueShortcuts.ts
@@ -0,0 +1,26 @@
+import { useEffect, useState } from "react";
+
+export function useQueueShortcuts({ count, onOpen }) {
+  const [activeIndex, setActiveIndex] = useState(0);
+
+  useEffect(() => {
+    function onKeyDown(event: KeyboardEvent) {
+      if (event.target instanceof HTMLInputElement) return;
+      if (event.key === "j") {
+        setActiveIndex((index) => Math.min(index + 1, count - 1));
+      }
+      if (event.key === "k") {
+        setActiveIndex((index) => Math.max(index - 1, 0));
+      }
+      if (event.key === "Enter") {
+        onOpen(activeIndex);
+      }
+    }
+
+    window.addEventListener("keydown", onKeyDown);
+    return () => window.removeEventListener("keydown", onKeyDown);
+  }, [activeIndex, count, onOpen]);
+
+  return { activeIndex };
+}
diff --git a/src/features/inbox/ReviewQueue.test.tsx b/src/features/inbox/ReviewQueue.test.tsx
index 89d6c80..7a5d1b4 100644
--- a/src/features/inbox/ReviewQueue.test.tsx
+++ b/src/features/inbox/ReviewQueue.test.tsx
@@ -19,6 +19,14 @@ describe("ReviewQueue", () => {
     expect(screen.getAllByRole("option")).toHaveLength(3);
   });
+
+  it("opens the focused pull request from the keyboard", async () => {
+    const onSelect = vi.fn();
+    render(<ReviewQueue pullRequests={pullRequests} onSelect={onSelect} />);
+    await userEvent.keyboard("j{Enter}");
+    expect(onSelect).toHaveBeenCalledWith(pullRequests[1]);
+  });
 });
diff --git a/src/styles/review-queue.css b/src/styles/review-queue.css
index 3c36a3d..c40f0f9 100644
--- a/src/styles/review-queue.css
+++ b/src/styles/review-queue.css
@@ -8,6 +8,11 @@
   overflow: auto;
 }
\u0020
+.review-row[data-active="true"] {
+  outline: 2px solid var(--accent);
+  outline-offset: -2px;
+}
+
 @media (prefers-reduced-motion: reduce) {
   .review-row {
     transition: none;
`;

export const demoDiffs: Record<string, PullRequestDiff> = Object.fromEntries(
  demoPullRequests.map((pullRequest) => [
    pullRequest.id,
    {
      baseSha: "demo-base-revision",
      files:
        pullRequest.id === "demo-842"
          ? consoleFiles
          : [
              {
                additions: pullRequest.additions,
                blobUrl: null,
                changes: pullRequest.additions + pullRequest.deletions,
                deletions: pullRequest.deletions,
                filename: "src/change.ts",
                patch: null,
                previousFilename: null,
                rawUrl: null,
                status: "modified",
              },
            ],
      headSha: pullRequest.headSha,
      patch:
        pullRequest.id === "demo-842"
          ? consolePatch
          : consolePatch.replaceAll(
              "src/features/inbox/ReviewQueue",
              "src/change",
            ),
      truncated: false,
    },
  ]),
);

export const demoInbox: InboxPayload = {
  pullRequests: demoPullRequests,
  rateLimit: { cost: 1, remaining: 4999, resetAt: ago(-1, "hours") },
  syncedAt: new Date().toISOString(),
  viewer: { login: "morgan", name: "Morgan" },
};
