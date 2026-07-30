import {
  dominantReason,
  isActionable,
  isStale,
  type Reason,
} from "../shared/pr-attention.mjs";
import type { PullRequestSummary } from "./types";

export {
  dominantReason,
  isActionable,
  isStale,
} from "../shared/pr-attention.mjs";
export type { Reason, ReasonCode } from "../shared/pr-attention.mjs";

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

export interface ViewDefinition {
  description: string;
  id: ViewId;
  label: string;
  section: "action" | "browse";
  shortLabel: string;
}

export const viewDefinitions: ViewDefinition[] = [
  {
    id: "needs-attention",
    label: "Needs attention",
    section: "action",
    shortLabel: "Needs attention",
    description: "Actionable requests and unhealthy PRs, ranked by obligation.",
  },
  {
    id: "review-requested",
    label: "Review requested",
    section: "action",
    shortLabel: "Review requested",
    description:
      "Direct requests, least-recently updated first. Demo fixtures can model team requests.",
  },
  {
    id: "my-prs",
    label: "My pull requests",
    section: "action",
    shortLabel: "My PRs",
    description: "Your open work, separated into needs-you, ready, and waiting.",
  },
  {
    id: "ci-failing",
    label: "CI failing",
    section: "action",
    shortLabel: "CI failing",
    description: "Failed checks on work you own or participate in.",
  },
  {
    id: "awaiting-response",
    label: "Awaiting response",
    section: "action",
    shortLabel: "Awaiting",
    description: "You completed the current action and someone else owns the next one.",
  },
  {
    id: "recently-updated",
    label: "Recently updated",
    section: "action",
    shortLabel: "Recent",
    description: "Human-significant activity ordered newest first.",
  },
  {
    id: "stale",
    label: "Stale",
    section: "action",
    shortLabel: "Stale",
    description: "No meaningful activity for at least seven days.",
  },
  {
    id: "repository",
    label: "By repository",
    section: "browse",
    shortLabel: "Repository",
    description: "Repositories with the most actionable work first.",
  },
  {
    id: "author",
    label: "By author",
    section: "browse",
    shortLabel: "Author",
    description: "Authors with the most actionable work first.",
  },
  {
    id: "all",
    label: "All pull requests",
    section: "browse",
    shortLabel: "All PRs",
    description: "The complete synchronized set, recently updated by default.",
  },
];

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
        (pullRequest) => !isStale(pullRequest, now),
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
  const compare = comparatorFor(sort, now);

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
      return compare(left, right);
    });
  }

  return sorted.sort(compare);
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

type Comparator = (
  left: PullRequestSummary,
  right: PullRequestSummary,
) => number;

function comparatorFor(sort: SortId, now: Date): Comparator {
  switch (sort) {
    case "attention":
      return attentionComparator(now);
    case "oldest":
      return (left, right) =>
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime();
    case "recent":
      return (left, right) =>
        new Date(right.lastMeaningfulActivityAt).getTime() -
        new Date(left.lastMeaningfulActivityAt).getTime();
    case "updated":
      return (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime();
  }
}

function attentionComparator(now: Date): Comparator {
  interface AttentionRank {
    activity: number;
    lane: Reason["lane"];
    obligation: number;
  }
  const ranks = new Map<string, AttentionRank>();
  const rankOf = (pullRequest: PullRequestSummary): AttentionRank => {
    let rank = ranks.get(pullRequest.id);
    if (!rank) {
      const reason = dominantReason(pullRequest, now);
      rank = {
        activity: new Date(pullRequest.lastMeaningfulActivityAt).getTime(),
        lane: reason.lane,
        obligation: new Date(reason.timestamp).getTime(),
      };
      ranks.set(pullRequest.id, rank);
    }
    return rank;
  };

  return (left, right) => {
    const leftRank = rankOf(left);
    const rightRank = rankOf(right);
    const laneDifference = leftRank.lane - rightRank.lane;
    if (laneDifference !== 0) return laneDifference;

    const obligationDifference = leftRank.obligation - rightRank.obligation;
    if (obligationDifference !== 0) return obligationDifference;

    const activityDifference = rightRank.activity - leftRank.activity;
    if (activityDifference !== 0) return activityDifference;

    const repositoryDifference = left.repository.localeCompare(right.repository);
    if (repositoryDifference !== 0) return repositoryDifference;
    return left.number - right.number;
  };
}
