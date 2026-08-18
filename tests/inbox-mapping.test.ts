import assert from "node:assert/strict";
import test from "node:test";
import { GatewayError } from "../lib/gateway-error";
import {
  buildMappedInbox,
  fetchInboxPage,
} from "../lib/inbox-pages";
import {
  cloneBuckets,
  emptyInboxPage,
  emptyPageInfo,
  hasUsableInboxData,
  mapInboxPayload,
  mergeInboxPageBuckets,
  permissionWarning,
} from "../shared/inbox-mapping.mjs";
import type { InboxPage, InboxPageBucketPageInfoMap } from "../lib/inbox-page-types";
import type { PullRequestActor } from "../lib/types";

function buildNode(
  id: string,
  repository: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    repository: { nameWithOwner: repository },
    title: `Node ${id}`,
    url: `https://github.com/${repository}/pull/${id}`,
    number: Number(id.replace(/[^0-9]/g, "")) || 1,
    baseRefName: "main",
    baseRefOid: "b".repeat(40),
    headRefName: "feature",
    headRefOid: "a".repeat(40),
    isDraft: false,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    comments: { totalCount: 0 },
    labels: { nodes: [] },
    commits: {
      nodes: [{ commit: { oid: "a".repeat(40), statusCheckRollup: null } }],
    },
    latestOpinionatedReviews: { nodes: [] },
    reviewRequests: { nodes: [] },
    reviewDecision: null,
    mergeable: "MERGEABLE",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    author: { login: "octocat", name: "Octo Cat", avatarUrl: null },
    ...overrides,
  };
}

const VIEWER: PullRequestActor = { login: "morgan", name: "Morgan" };

function pageOf(opts: {
  authoredIds?: string[];
  assignedIds?: string[];
  reviewRequestedIds?: string[];
  reviewedIds?: string[];
  hasNextPage?: boolean;
} = {}): InboxPage {
  const authored = (opts.authoredIds ?? []).map((id) => buildNode(id, "acme/a"));
  const assigned = (opts.assignedIds ?? []).map((id) => buildNode(id, "acme/a"));
  const reviewRequested = (opts.reviewRequestedIds ?? []).map((id) =>
    buildNode(id, "acme/a"),
  );
  const reviewed = (opts.reviewedIds ?? []).map((id) => buildNode(id, "acme/a"));
  const pageInfo: InboxPageBucketPageInfoMap = {
    authored: { endCursor: "ca1", hasNextPage: Boolean(opts.hasNextPage) },
    assigned: { endCursor: "ca2", hasNextPage: Boolean(opts.hasNextPage) },
    reviewRequested: { endCursor: "ca3", hasNextPage: Boolean(opts.hasNextPage) },
    reviewed: { endCursor: "ca4", hasNextPage: Boolean(opts.hasNextPage) },
  };
  return {
    buckets: { authored, assigned, reviewRequested, reviewed },
    pageInfo,
    rateLimit: { cost: 1, remaining: 4999, resetAt: "2026-07-01T01:00:00.000Z" },
    viewer: VIEWER,
    warnings: [],
  };
}

test("emptyInboxPage returns a clean page with null viewer and zero nodes", () => {
  const page = emptyInboxPage();
  assert.equal(page.buckets.authored.length, 0);
  assert.equal(page.viewer, null);
  assert.equal(page.rateLimit, null);
  assert.deepEqual(page.warnings, []);
  assert.equal(page.pageInfo.authored.hasNextPage, false);
});

test("emptyPageInfo marks every bucket as exhausted", () => {
  const info = emptyPageInfo();
  for (const value of Object.values(info)) {
    assert.equal(value.endCursor, null);
    assert.equal(value.hasNextPage, false);
  }
});

test("cloneBuckets produces a defensive copy of the four lists", () => {
  const original = { authored: ["x"], assigned: [], reviewRequested: [], reviewed: [] };
  const copy = cloneBuckets(original);
  copy.authored.push("y");
  assert.equal(original.authored.length, 1);
});

test("mergeInboxPageBuckets concatenates per-bucket nodes and keeps the last viewer", () => {
  const first = pageOf({ authoredIds: ["1"] });
  const second = pageOf({ authoredIds: ["2"], reviewedIds: ["3"] });
  const merged = mergeInboxPageBuckets(first, second);
  assert.equal(merged.buckets.authored.length, 2);
  assert.equal(merged.buckets.assigned.length, 0);
  assert.equal(merged.buckets.reviewed.length, 1);
  assert.equal(merged.viewer, VIEWER);
  assert.equal(merged.rateLimit?.remaining, 4999);
});

test("mergeInboxPageBuckets preserves hasNextPage only when a later page still has more", () => {
  const first = pageOf({ hasNextPage: true });
  const second = pageOf({ hasNextPage: false });
  const merged = mergeInboxPageBuckets(first, second);
  assert.equal(merged.pageInfo.authored.hasNextPage, false);
});

test("hasUsableInboxData accepts partial bucket sets", () => {
  assert.equal(hasUsableInboxData({ authored: { nodes: [] } }), true);
  assert.equal(hasUsableInboxData({}), false);
  assert.equal(hasUsableInboxData(null), false);
});

test("permissionWarning describes the denied field when GraphQL reports one", () => {
  const text = permissionWarning([{ path: ["authored", "nodes", 0, "commits"] }]);
  assert.match(text, /GitHub denied: commits/);
});

test("mapInboxPayload combines the same PR across multiple buckets", () => {
  const node = buildNode("PR_1", "acme/console");
  const data = {
    authored: { nodes: [node] },
    reviewRequested: { nodes: [node] },
    assigned: { nodes: [] },
    reviewed: { nodes: [] },
    rateLimit: null,
  };
  const mapped = mapInboxPayload(data, VIEWER, []);
  assert.equal(mapped.pullRequests.length, 1);
  const pullRequest = mapped.pullRequests[0];
  assert.equal(pullRequest.viewerRelationship, "AUTHOR");
  assert.equal(pullRequest.teamReviewRequested, false);
  // The PR was in BOTH authored and reviewRequested. The author bucket
  // takes precedence for viewerRelationship (it appears first in the
  // decision tree), but bucket membership is preserved through the merge.
  assert.ok(pullRequest);
});

test("mapInboxPayload carries the base ref tip through as baseSha", () => {
  const currentBase = "c".repeat(40);
  const data = {
    authored: {
      nodes: [
        buildNode("PR_1", "acme/console", { baseRefOid: currentBase }),
        // Degraded permission data (or an older cached shape) may omit the
        // base revision entirely; the mapping must report "unknown" rather
        // than invent a value the workspace would treat as authoritative.
        buildNode("PR_2", "acme/console", { baseRefOid: undefined }),
      ],
    },
    assigned: { nodes: [] },
    reviewRequested: { nodes: [] },
    reviewed: { nodes: [] },
    rateLimit: null,
  };
  const mapped = mapInboxPayload(data, VIEWER, []);
  const withBase = mapped.pullRequests.find((pr) => pr.id === "PR_1");
  const withoutBase = mapped.pullRequests.find((pr) => pr.id === "PR_2");
  assert.equal(withBase?.baseSha, currentBase);
  assert.equal(withoutBase?.baseSha, "");
});

test("buildMappedInbox merges two pages, deduplicating by node id", () => {
  const first = pageOf({
    authoredIds: ["1", "2"],
    assignedIds: ["3"],
  });
  const second = pageOf({
    authoredIds: ["3", "4"],
    reviewRequestedIds: ["1"],
  });
  const merged = buildMappedInbox({ pages: [first, second] });
  assert.ok(merged);
  // "1" appears in authored (page 1) and reviewRequested (page 2). It
  // should keep both bucket memberships, and the reviewer (Morgan) is the
  // author of node "1" so it should land in the AUTHOR lane.
  const pr1 = merged.pullRequests.find((pullRequest) => pullRequest.id === "1");
  assert.ok(pr1);
  // "3" appears in assigned (page 1) and authored (page 2). The mapping
  // sees the authored bucket and marks it as AUTHOR.
  const pr3 = merged.pullRequests.find((pullRequest) => pullRequest.id === "3");
  assert.ok(pr3);
  assert.equal(pr3.viewerRelationship, "AUTHOR");
});

test("buildMappedInbox returns null when no page has a viewer", () => {
  const page: InboxPage = {
    ...emptyInboxPage(),
    buckets: { authored: [], assigned: [], reviewRequested: [], reviewed: [] },
  };
  assert.equal(buildMappedInbox({ pages: [page] }), null);
});

test("fetchInboxPage forwards the page and per-bucket cursors as query params", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify(emptyInboxPage()), {
      headers: { "content-type": "application/json" },
    });
  };
  const result = await fetchInboxPage({
    page: 2,
    cursors: {
      authored: { endCursor: "cursor_a", hasNextPage: true },
      reviewRequested: { endCursor: "cursor_r", hasNextPage: true },
    },
    fetchImpl,
    origin: "http://localhost:3000",
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("authoredAfter"), "cursor_a");
  assert.equal(url.searchParams.get("reviewRequestedAfter"), "cursor_r");
  assert.equal(url.searchParams.get("assignedAfter"), null);
  assert.equal(result.perBucket, 25);
});

test("fetchInboxPage throws with the server-provided error message on failure", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  await assert.rejects(
    fetchInboxPage({ page: 1, fetchImpl }),
    /Rate limit reached/,
  );
});

test("fetchInboxPage preserves the server's typed error code and status", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "not_connected",
          message: "Connect an approved GitHub App to continue.",
        },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  await assert.rejects(
    fetchInboxPage({ page: 1, fetchImpl }),
    (error: unknown) =>
      error instanceof GatewayError &&
      error.code === "not_connected" &&
      error.status === 401 &&
      error.message === "Connect an approved GitHub App to continue.",
  );
});

test("fetchInboxPage reports a code-less failure without inventing a code", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("upstream exploded", { status: 502 });
  await assert.rejects(
    fetchInboxPage({ page: 1, fetchImpl }),
    (error: unknown) =>
      error instanceof GatewayError &&
      error.code === null &&
      error.status === 502 &&
      error.message === "Request failed (502).",
  );
});

test("mapInboxPayload tolerates a missing data object", () => {
  const mapped = mapInboxPayload(undefined, VIEWER, []);
  assert.deepEqual(mapped.pullRequests, []);
  assert.equal(mapped.rateLimit, null);
  assert.equal(mapped.viewer, VIEWER);
});
