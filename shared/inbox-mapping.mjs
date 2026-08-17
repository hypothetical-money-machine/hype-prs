// Pure functions that turn a raw GraphQL inbox response into the InboxPayload
// shape the UI consumes. Kept in its own file (and free of any fetch / query
// string imports) so the browser can pull it in without dragging the rest of
// the GitHub transport along.

export const EMPTY_BUCKETS = Object.freeze({
  authored: [],
  assigned: [],
  reviewRequested: [],
  reviewed: [],
});

export function emptyInboxPage() {
  return {
    buckets: cloneBuckets(EMPTY_BUCKETS),
    pageInfo: emptyPageInfo(),
    rateLimit: null,
    viewer: null,
    warnings: [],
  };
}

export function emptyPageInfo() {
  return {
    authored: { endCursor: null, hasNextPage: false },
    assigned: { endCursor: null, hasNextPage: false },
    reviewRequested: { endCursor: null, hasNextPage: false },
    reviewed: { endCursor: null, hasNextPage: false },
  };
}

export function cloneBuckets(buckets) {
  return {
    authored: [...(buckets?.authored ?? [])],
    assigned: [...(buckets?.assigned ?? [])],
    reviewRequested: [...(buckets?.reviewRequested ?? [])],
    reviewed: [...(buckets?.reviewed ?? [])],
  };
}

export function mergeInboxPageBuckets(...pages) {
  const merged = cloneBuckets(EMPTY_BUCKETS);
  let viewer = null;
  let rateLimit = null;
  const pageInfo = emptyPageInfo();
  const warnings = [];
  for (const page of pages) {
    if (!page) continue;
    if (page.viewer) viewer = page.viewer;
    if (page.rateLimit) rateLimit = page.rateLimit;
    for (const bucket of Object.keys(merged)) {
      const nodes = page.buckets?.[bucket];
      if (Array.isArray(nodes)) merged[bucket].push(...nodes);
    }
    if (Array.isArray(page.warnings)) warnings.push(...page.warnings);
  }
  // Take the last page's pageInfo: it tells us whether more results are
  // available. Earlier pages' cursors are no longer reachable once a later
  // page has been merged in.
  const lastPage = pages.filter(Boolean).at(-1);
  if (lastPage?.pageInfo) {
    for (const bucket of Object.keys(pageInfo)) {
      const cursor = lastPage.pageInfo[bucket];
      if (cursor) {
        pageInfo[bucket] = {
          endCursor: cursor.endCursor ?? null,
          hasNextPage: Boolean(cursor.hasNextPage),
        };
      }
    }
  }
  return {
    buckets: merged,
    pageInfo,
    rateLimit,
    viewer,
    warnings,
  };
}

export function mapInboxPayload(data, viewer, warnings = []) {
  const buckets = {
    authored: data?.authored?.nodes ?? [],
    assigned: data?.assigned?.nodes ?? [],
    reviewRequested: data?.reviewRequested?.nodes ?? [],
    reviewed: data?.reviewed?.nodes ?? [],
  };
  const indexed = new Map();

  for (const [bucket, nodes] of Object.entries(buckets)) {
    for (const node of nodes) {
      // Degraded permission data can omit the repository. Such a card can
      // never load a diff or accept a review, so drop it rather than render a
      // card whose diff pane would spin forever; the warning still surfaces.
      if (!node?.id || !node.repository?.nameWithOwner) continue;
      const existing = indexed.get(node.id) ?? { buckets: new Set(), node };
      existing.buckets.add(bucket);
      indexed.set(node.id, existing);
    }
  }

  const pullRequests = [...indexed.values()].map(({ node, buckets: bucketSet }) =>
    mapPullRequest(node, bucketSet, viewer.login),
  );

  return {
    pullRequests,
    rateLimit: data?.rateLimit
      ? {
          cost: data.rateLimit.cost,
          remaining: data.rateLimit.remaining,
          resetAt: data.rateLimit.resetAt,
        }
      : null,
    syncedAt: new Date().toISOString(),
    viewer,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export function mapPullRequest(node, buckets, viewerLogin) {
  const reviews = (node.latestOpinionatedReviews?.nodes ?? []).filter(
    (review) => review?.author?.login === viewerLogin,
  );
  const viewerReview = reviews
    .slice()
    .sort(
      (left, right) =>
        new Date(right.submittedAt).getTime() -
        new Date(left.submittedAt).getTime(),
    )[0];
  const commit = node.commits?.nodes?.[0]?.commit;
  const authored = buckets.has("authored") || node.author?.login === viewerLogin;

  let viewerRelationship = "PARTICIPATING";
  if (authored) viewerRelationship = "AUTHOR";
  // The `user-review-requested:@me` search bucket is GitHub's authoritative
  // direct-review signal. Reading PullRequest.reviewRequests separately is
  // both redundant and not always available to a valid App installation.
  else if (buckets.has("reviewRequested")) {
    viewerRelationship = "REVIEW_REQUESTED";
  } else if (buckets.has("assigned")) {
    viewerRelationship = "ASSIGNED";
  }

  return {
    additions: node.additions ?? 0,
    author: {
      avatarUrl: node.author?.avatarUrl ?? null,
      login: node.author?.login ?? "ghost",
      name: node.author?.name ?? null,
    },
    baseRefName: node.baseRefName ?? "",
    changedFiles: node.changedFiles ?? 0,
    checkState: normalizeCheckState(commit?.statusCheckRollup?.state),
    commentCount: node.comments?.totalCount ?? 0,
    createdAt: node.createdAt,
    deletions: node.deletions ?? 0,
    headRefName: node.headRefName ?? "",
    headSha: node.headRefOid ?? commit?.oid ?? "",
    id: node.id,
    isDraft: Boolean(node.isDraft),
    labels: (node.labels?.nodes ?? []).map((label) => label.name),
    lastMeaningfulActivityAt: node.updatedAt,
    mergeState: normalizeMergeState(node.mergeable),
    mentionsViewer: false,
    number: node.number,
    repository: node.repository?.nameWithOwner ?? "",
    reviewDecision: node.reviewDecision ?? null,
    reviewRequestedAt: null,
    teamReviewRequested: false,
    title: node.title,
    updatedAt: node.updatedAt,
    url: node.url,
    viewerLastReviewCommitSha: viewerReview?.commit?.oid ?? null,
    viewerLastReviewAt: viewerReview?.submittedAt ?? null,
    viewerRelationship,
    viewerReviewState: viewerReview?.state ?? null,
  };
}

export function hasUsableInboxData(data) {
  return ["authored", "assigned", "reviewRequested", "reviewed"].some(
    (bucket) => Array.isArray(data?.[bucket]?.nodes),
  );
}

export function permissionWarning(errors) {
  const fields = [
    ...new Set(
      errors
        .map((error) =>
          Array.isArray(error?.path) ? error.path.at(-1) : null,
        )
        .filter((field) => typeof field === "string"),
    ),
  ];
  const detail =
    fields.length > 0 ? ` GitHub denied: ${fields.join(", ")}.` : "";
  return `Some pull request details are unavailable.${detail} Approve the GitHub App’s requested repository permissions to restore them.`;
}

function normalizeCheckState(state) {
  if (state === "SUCCESS") return "SUCCESS";
  if (state === "FAILURE" || state === "ERROR") return "FAILURE";
  if (state === "PENDING" || state === "EXPECTED") return "PENDING";
  return "NEUTRAL";
}

function normalizeMergeState(state) {
  if (state === "MERGEABLE") return "MERGEABLE";
  if (state === "CONFLICTING") return "CONFLICTING";
  return "UNKNOWN";
}
