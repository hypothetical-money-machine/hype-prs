import assert from "node:assert/strict";
import test from "node:test";
import {
  countForView,
  dominantReason,
  filterForView,
  searchPullRequests,
  sortForView,
} from "../lib/pr-views";
import type { PullRequestSummary } from "../lib/types";

const NOW = new Date("2026-07-28T18:00:00.000Z");

function pullRequest(
  id: string,
  overrides: Partial<PullRequestSummary> = {},
): PullRequestSummary {
  return {
    additions: 12,
    author: { login: "alex" },
    baseRefName: "main",
    changedFiles: 2,
    checkState: "SUCCESS",
    commentCount: 0,
    createdAt: "2026-07-20T12:00:00.000Z",
    deletions: 3,
    headRefName: `feature-${id}`,
    headSha: `sha-${id}`,
    id,
    isDraft: false,
    labels: [],
    lastMeaningfulActivityAt: "2026-07-27T12:00:00.000Z",
    mergeState: "MERGEABLE",
    mentionsViewer: false,
    number: Number(id.replace(/\D/g, "")) || 1,
    repository: "acme/service",
    reviewDecision: "REVIEW_REQUIRED",
    reviewRequestedAt: null,
    teamReviewRequested: false,
    title: `Pull request ${id}`,
    updatedAt: "2026-07-27T12:00:00.000Z",
    url: `https://github.com/acme/service/pull/${id}`,
    viewerLastReviewCommitSha: null,
    viewerLastReviewAt: null,
    viewerRelationship: "PARTICIPATING",
    viewerReviewState: null,
    ...overrides,
  };
}

const corpus: PullRequestSummary[] = [
  pullRequest("review", {
    author: { login: "maya" },
    repository: "acme/alpha",
    reviewRequestedAt: "2026-07-25T09:00:00.000Z",
    viewerRelationship: "REVIEW_REQUESTED",
  }),
  pullRequest("changes", {
    author: { login: "morgan" },
    repository: "acme/zulu",
    reviewDecision: "CHANGES_REQUESTED",
    updatedAt: "2026-07-24T09:00:00.000Z",
    viewerRelationship: "AUTHOR",
  }),
  pullRequest("ci", {
    author: { login: "morgan" },
    checkState: "FAILURE",
    repository: "acme/api",
    updatedAt: "2026-07-26T09:00:00.000Z",
    viewerRelationship: "AUTHOR",
  }),
  pullRequest("team", {
    author: { login: "riley" },
    repository: "acme/console",
    reviewRequestedAt: "2026-07-23T09:00:00.000Z",
    teamReviewRequested: true,
    viewerRelationship: "TEAM_REVIEW_REQUESTED",
  }),
  pullRequest("stale", {
    author: { login: "sam" },
    lastMeaningfulActivityAt: "2026-07-10T09:00:00.000Z",
    repository: "acme/infra",
    updatedAt: "2026-07-10T09:00:00.000Z",
    viewerRelationship: "ASSIGNED",
  }),
  pullRequest("waiting", {
    author: { login: "morgan" },
    repository: "acme/billing",
    viewerRelationship: "AUTHOR",
  }),
  pullRequest("draft", {
    isDraft: true,
    repository: "acme/mobile",
  }),
];

test("the default queue is action-ranked rather than repository-alphabetical", () => {
  const actionable = filterForView(corpus, "needs-attention", NOW);
  const ordered = sortForView(actionable, "needs-attention", "attention", NOW);

  assert.deepEqual(
    ordered.map(({ id }) => id),
    ["changes", "review", "ci", "team", "stale"],
  );
  assert.equal(ordered[0]?.repository, "acme/zulu");
  assert.equal(countForView(corpus, "needs-attention", NOW), 5);
});

test("alternative views keep one canonical PR set and expose explainable reasons", () => {
  assert.deepEqual(
    filterForView(corpus, "review-requested", NOW).map(({ id }) => id),
    ["review", "team"],
  );
  assert.deepEqual(
    filterForView(corpus, "ci-failing", NOW).map(({ id }) => id),
    ["ci"],
  );
  assert.deepEqual(
    filterForView(corpus, "awaiting-response", NOW).map(({ id }) => id),
    ["waiting"],
  );
  assert.deepEqual(
    filterForView(corpus, "stale", NOW).map(({ id }) => id),
    ["stale"],
  );
  assert.equal(dominantReason(corpus[0], NOW).code, "review-requested");
  assert.equal(dominantReason(corpus[1], NOW).code, "changes-requested");
  assert.equal(dominantReason(corpus[2], NOW).code, "ci-failed");
});

test("repository and author lenses prioritize groups with actionable work", () => {
  const grouped = [
    ...corpus,
    pullRequest("alpha-second", {
      author: { login: "maya" },
      repository: "acme/alpha",
      reviewRequestedAt: "2026-07-26T09:00:00.000Z",
      viewerRelationship: "REVIEW_REQUESTED",
    }),
  ];

  const repositoryOrder = sortForView(
    grouped,
    "repository",
    "attention",
    NOW,
  ).map(({ repository }) => repository);
  assert.equal(repositoryOrder[0], "acme/alpha");
  assert.equal(repositoryOrder[1], "acme/alpha");

  const authorOrder = sortForView(grouped, "author", "attention", NOW).map(
    ({ author }) => author.login,
  );
  assert.equal(authorOrder[0], "maya");
  assert.equal(authorOrder[1], "maya");
});

test("repository and author lenses honor the selected sort within each group", () => {
  const grouped = [
    pullRequest("newer", {
      createdAt: "2026-07-24T12:00:00.000Z",
      repository: "acme/alpha",
      updatedAt: "2026-07-28T12:00:00.000Z",
    }),
    pullRequest("older", {
      createdAt: "2026-07-10T12:00:00.000Z",
      repository: "acme/alpha",
      updatedAt: "2026-07-20T12:00:00.000Z",
    }),
  ];

  assert.deepEqual(
    sortForView(grouped, "repository", "oldest", NOW).map(({ id }) => id),
    ["older", "newer"],
  );
  assert.deepEqual(
    sortForView(grouped, "repository", "updated", NOW).map(({ id }) => id),
    ["newer", "older"],
  );
});

test("drafts stay outside Needs attention even when stale or failing", () => {
  const draft = pullRequest("stale-draft", {
    checkState: "FAILURE",
    isDraft: true,
    lastMeaningfulActivityAt: "2026-07-01T12:00:00.000Z",
    viewerRelationship: "AUTHOR",
  });

  assert.equal(dominantReason(draft, NOW).code, "draft");
  assert.deepEqual(filterForView([draft], "needs-attention", NOW), []);
});

test("re-review requires a different reviewed commit, not generic activity", () => {
  const reviewedHead = "a".repeat(40);
  const request = pullRequest("reviewed", {
    headSha: reviewedHead,
    updatedAt: "2026-07-28T17:00:00.000Z",
    viewerLastReviewAt: "2026-07-20T12:00:00.000Z",
    viewerLastReviewCommitSha: reviewedHead,
    viewerRelationship: "REVIEW_REQUESTED",
  });

  assert.equal(dominantReason(request, NOW).code, "review-requested");
  assert.equal(
    dominantReason(
      { ...request, viewerLastReviewCommitSha: "b".repeat(40) },
      NOW,
    ).code,
    "rereview",
  );
});

test("recent activity and raw update time are distinct sort signals", () => {
  const activityFirst = pullRequest("activity-first", {
    lastMeaningfulActivityAt: "2026-07-28T17:00:00.000Z",
    updatedAt: "2026-07-27T10:00:00.000Z",
  });
  const updateFirst = pullRequest("update-first", {
    lastMeaningfulActivityAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-28T17:00:00.000Z",
  });

  assert.deepEqual(
    sortForView([updateFirst, activityFirst], "all", "recent", NOW).map(
      ({ id }) => id,
    ),
    ["activity-first", "update-first"],
  );
  assert.deepEqual(
    sortForView([activityFirst, updateFirst], "all", "updated", NOW).map(
      ({ id }) => id,
    ),
    ["update-first", "activity-first"],
  );
});

test("search spans path-independent PR metadata and reason text", () => {
  assert.deepEqual(
    searchPullRequests(corpus, "acme/zulu", NOW).map(({ id }) => id),
    ["changes"],
  );
  assert.deepEqual(
    searchPullRequests(corpus, "checks failing", NOW).map(({ id }) => id),
    ["ci"],
  );
  assert.deepEqual(
    searchPullRequests(corpus, "maya", NOW).map(({ id }) => id),
    ["review"],
  );
});
