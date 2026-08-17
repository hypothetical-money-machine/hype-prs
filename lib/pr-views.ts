import type { PullRequestSummary } from "./types";

export type ViewId =
  | "needs-attention"
  | "review-requested"
  | "my-prs"
  | "ci-failing"
  | "awaiting-response"
  | "recently-updated"
  | "stale"
  | "repository"
  | "author"
  | "all";

export type SortId = "attention" | "recent" | "oldest" | "updated";

export type ReasonCode =
  | "rereview"
  | "changes-requested"
  | "review-requested"
  | "mentioned"
  | "ci-failed"
  | "merge-conflict"
  | "ready"
  | "team-review"
  | "stale"
  | "awaiting-review"
  | "awaiting-ci"
  | "draft"
  | "updated";

export interface Reason {
  code: ReasonCode;
  explanation: string;
  lane: 1 | 2 | 3 | 4 | 5;
  label: string;
  timestamp: string;
  tone: "amber" | "blue" | "green" | "muted" | "red" | "violet";
}

export interface ViewDefinition {
  description: string;
  id: ViewId;
  label: string;
  shortLabel: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_DAYS = 7;

export const viewDefinitions: ViewDefinition[] = [
  {
    id: "needs-attention",
    label: "Needs attention",
    shortLabel: "Needs you",
    description:
      "Pull requests that need a decision or action from you, ranked by urgency.",
  },
  {
    id: "review-requested",
    label: "Review requested",
    shortLabel: "Reviews",
    description:
      "Pull requests waiting for your review, including team requests.",
  },
  {
    id: "my-prs",
    label: "My pull requests",
    shortLabel: "My PRs",
    description: "Your open pull requests, organized by what happens next.",
  },
  {
    id: "ci-failing",
    label: "Checks failing",
    shortLabel: "Checks failing",
    description: "Pull requests blocked by failing checks.",
  },
  {
    id: "awaiting-response",
    label: "Waiting on others",
    shortLabel: "Waiting",
    description: "Your pull requests waiting on reviewers or checks.",
  },
  {
    id: "recently-updated",
    label: "Recent activity",
    shortLabel: "Recent",
    description: "Pull requests with meaningful activity in the last seven days.",
  },
  {
    id: "stale",
    label: "Stale",
    shortLabel: "Stale",
    description: "No meaningful activity for at least seven days.",
  },
  {
    id: "repository",
    label: "By repository",
    shortLabel: "Repositories",
    description: "All pull requests grouped by repository.",
  },
  {
    id: "author",
    label: "By author",
    shortLabel: "Authors",
    description: "All pull requests grouped by author.",
  },
  {
    id: "all",
    label: "All pull requests",
    shortLabel: "All PRs",
    description: "Every pull request in this workspace, most recent activity first.",
  },
];

export function isStale(
  pullRequest: PullRequestSummary,
  now = new Date(),
): boolean {
  return (
    now.getTime() -
      new Date(pullRequest.lastMeaningfulActivityAt).getTime() >=
    STALE_AFTER_DAYS * DAY_MS
  );
}

export function dominantReason(
  pullRequest: PullRequestSummary,
  now = new Date(),
): Reason {
  const authored = pullRequest.viewerRelationship === "AUTHOR";
  const hasNewCommitsSinceReview =
    pullRequest.viewerLastReviewCommitSha !== null &&
    pullRequest.viewerLastReviewCommitSha !== pullRequest.headSha &&
    (pullRequest.viewerRelationship === "REVIEW_REQUESTED" ||
      pullRequest.viewerRelationship === "TEAM_REVIEW_REQUESTED");

  if (pullRequest.isDraft) {
    return reason(
      "draft",
      "DRAFT",
      "Draft work is kept outside the action queue",
      pullRequest.updatedAt,
      5,
      "muted",
    );
  }

  if (!pullRequest.isDraft && hasNewCommitsSinceReview) {
    return reason(
      "rereview",
      "RE-REVIEW",
      "New commits landed after your last review",
      pullRequest.updatedAt,
      1,
      "violet",
    );
  }

  if (
    authored &&
    pullRequest.reviewDecision === "CHANGES_REQUESTED" &&
    !pullRequest.isDraft
  ) {
    return reason(
      "changes-requested",
      "CHANGES REQUESTED",
      "Review feedback is blocking your pull request",
      pullRequest.updatedAt,
      1,
      "red",
    );
  }

  if (
    !pullRequest.isDraft &&
    pullRequest.viewerRelationship === "REVIEW_REQUESTED"
  ) {
    return reason(
      "review-requested",
      "REVIEW REQUESTED",
      `${pullRequest.author.login} is waiting for your review`,
      pullRequest.reviewRequestedAt ?? pullRequest.updatedAt,
      1,
      "amber",
    );
  }

  if (pullRequest.mentionsViewer) {
    return reason(
      "mentioned",
      "MENTIONED",
      "A conversation needs your response",
      pullRequest.updatedAt,
      1,
      "violet",
    );
  }

  if (authored && pullRequest.checkState === "FAILURE") {
    return reason(
      "ci-failed",
      "CHECKS FAILING",
      "Failing checks are blocking your pull request",
      pullRequest.updatedAt,
      2,
      "red",
    );
  }

  if (authored && pullRequest.mergeState === "CONFLICTING") {
    return reason(
      "merge-conflict",
      "CONFLICT",
      "Your pull request has a merge conflict",
      pullRequest.updatedAt,
      2,
      "red",
    );
  }

  if (
    authored &&
    pullRequest.reviewDecision === "APPROVED" &&
    pullRequest.checkState === "SUCCESS" &&
    pullRequest.mergeState === "MERGEABLE" &&
    !pullRequest.isDraft
  ) {
    return reason(
      "ready",
      "READY",
      "Approved and checks are passing",
      pullRequest.updatedAt,
      2,
      "green",
    );
  }

  if (
    !pullRequest.isDraft &&
    pullRequest.viewerRelationship === "TEAM_REVIEW_REQUESTED"
  ) {
    return reason(
      "team-review",
      "TEAM REVIEW",
      "Your team has an open review request",
      pullRequest.reviewRequestedAt ?? pullRequest.updatedAt,
      3,
      "blue",
    );
  }

  if (isStale(pullRequest, now) && pullRequest.viewerRelationship !== "PARTICIPATING") {
    return reason(
      "stale",
      "STALE",
      "No meaningful activity in the last seven days",
      pullRequest.lastMeaningfulActivityAt,
      4,
      "muted",
    );
  }

  if (
    authored &&
    (pullRequest.reviewDecision === "REVIEW_REQUIRED" ||
      pullRequest.reviewDecision === null) &&
    pullRequest.checkState !== "PENDING"
  ) {
    return reason(
      "awaiting-review",
      "WAITING FOR REVIEW",
      "Waiting for reviewers to take the next step",
      pullRequest.updatedAt,
      5,
      "blue",
    );
  }

  if (authored && pullRequest.checkState === "PENDING") {
    return reason(
      "awaiting-ci",
      "CHECKS RUNNING",
      "Automation owns the next step",
      pullRequest.updatedAt,
      5,
      "blue",
    );
  }

  return reason(
    "updated",
    "RECENT ACTIVITY",
    "Recently active",
    pullRequest.lastMeaningfulActivityAt,
    5,
    "muted",
  );
}

export function isActionable(
  pullRequest: PullRequestSummary,
  now = new Date(),
): boolean {
  return dominantReason(pullRequest, now).lane < 5;
}

export function filterForView(
  pullRequests: PullRequestSummary[],
  view: ViewId,
  now = new Date(),
): PullRequestSummary[] {
  switch (view) {
    case "needs-attention":
      return pullRequests.filter((pullRequest) =>
        isActionable(pullRequest, now),
      );
    case "review-requested":
      return pullRequests.filter(
        (pullRequest) =>
          !pullRequest.isDraft &&
          (pullRequest.viewerRelationship === "REVIEW_REQUESTED" ||
            pullRequest.viewerRelationship === "TEAM_REVIEW_REQUESTED"),
      );
    case "my-prs":
      return pullRequests.filter(
        (pullRequest) => pullRequest.viewerRelationship === "AUTHOR",
      );
    case "ci-failing":
      return pullRequests.filter(
        (pullRequest) => pullRequest.checkState === "FAILURE",
      );
    case "awaiting-response":
      return pullRequests.filter((pullRequest) => {
        const code = dominantReason(pullRequest, now).code;
        return code === "awaiting-review" || code === "awaiting-ci";
      });
    case "recently-updated":
      return pullRequests.filter(
        (pullRequest) =>
          now.getTime() -
            new Date(pullRequest.lastMeaningfulActivityAt).getTime() <
          STALE_AFTER_DAYS * DAY_MS,
      );
    case "stale":
      return pullRequests.filter((pullRequest) => isStale(pullRequest, now));
    case "repository":
    case "author":
    case "all":
      return pullRequests;
  }
}

export function sortForView(
  pullRequests: PullRequestSummary[],
  view: ViewId,
  sort: SortId,
  now = new Date(),
): PullRequestSummary[] {
  const sorted = [...pullRequests];

  if (view === "repository" || view === "author") {
    const groupKey =
      view === "repository"
        ? (pullRequest: PullRequestSummary) => pullRequest.repository
        : (pullRequest: PullRequestSummary) => pullRequest.author.login;
    const actionCounts = new Map<string, number>();
    for (const pullRequest of sorted) {
      const key = groupKey(pullRequest);
      actionCounts.set(
        key,
        (actionCounts.get(key) ?? 0) +
          (isActionable(pullRequest, now) ? 1 : 0),
      );
    }
    return sorted.sort((left, right) => {
      const leftKey = groupKey(left);
      const rightKey = groupKey(right);
      const countDifference =
        (actionCounts.get(rightKey) ?? 0) - (actionCounts.get(leftKey) ?? 0);
      if (countDifference !== 0) return countDifference;
      const groupDifference = leftKey.localeCompare(rightKey);
      if (groupDifference !== 0) return groupDifference;
      return compareForSort(left, right, sort, now);
    });
  }

  return sorted.sort((left, right) => compareForSort(left, right, sort, now));
}

export function searchPullRequests(
  pullRequests: PullRequestSummary[],
  rawQuery: string,
  now = new Date(),
): PullRequestSummary[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return pullRequests;

  return pullRequests.filter((pullRequest) => {
    const reason = dominantReason(pullRequest, now);
    return [
      pullRequest.title,
      pullRequest.repository,
      pullRequest.author.login,
      `#${pullRequest.number}`,
      pullRequest.number.toString(),
      reason.label,
      reason.explanation,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });
}

export function countForView(
  pullRequests: PullRequestSummary[],
  view: ViewId,
  now = new Date(),
): number {
  return filterForView(pullRequests, view, now).length;
}

export function groupLabel(
  pullRequest: PullRequestSummary,
  view: ViewId,
): string | null {
  if (view === "repository") return pullRequest.repository;
  if (view === "author") return pullRequest.author.login;
  return null;
}

function compareAttention(
  left: PullRequestSummary,
  right: PullRequestSummary,
  now: Date,
): number {
  const leftReason = dominantReason(left, now);
  const rightReason = dominantReason(right, now);
  const laneDifference = leftReason.lane - rightReason.lane;
  if (laneDifference !== 0) return laneDifference;

  const obligationDifference =
    new Date(leftReason.timestamp).getTime() -
    new Date(rightReason.timestamp).getTime();
  if (obligationDifference !== 0) return obligationDifference;

  const activityDifference =
    new Date(right.lastMeaningfulActivityAt).getTime() -
    new Date(left.lastMeaningfulActivityAt).getTime();
  if (activityDifference !== 0) return activityDifference;

  const repositoryDifference = left.repository.localeCompare(right.repository);
  if (repositoryDifference !== 0) return repositoryDifference;
  return left.number - right.number;
}

function compareForSort(
  left: PullRequestSummary,
  right: PullRequestSummary,
  sort: SortId,
  now: Date,
): number {
  switch (sort) {
    case "attention":
      return compareAttention(left, right, now);
    case "oldest":
      return (
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime()
      );
    case "recent":
      return (
        new Date(right.lastMeaningfulActivityAt).getTime() -
        new Date(left.lastMeaningfulActivityAt).getTime()
      );
    case "updated":
      return (
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime()
      );
  }
}

function reason(
  code: ReasonCode,
  label: string,
  explanation: string,
  timestamp: string,
  lane: Reason["lane"],
  tone: Reason["tone"],
): Reason {
  return { code, explanation, label, lane, timestamp, tone };
}
