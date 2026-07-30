const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_AFTER_DAYS = 7;

export function isStale(pullRequest, now = new Date()) {
  return (
    now.getTime() -
      new Date(pullRequest.lastMeaningfulActivityAt).getTime() >=
    STALE_AFTER_DAYS * DAY_MS
  );
}

export function dominantReason(pullRequest, now = new Date()) {
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

  if (hasNewCommitsSinceReview) {
    return reason(
      "rereview",
      "RE-REVIEW",
      "The head revision changed after your last review",
      pullRequest.updatedAt,
      1,
      "violet",
    );
  }

  if (authored && pullRequest.reviewDecision === "CHANGES_REQUESTED") {
    return reason(
      "changes-requested",
      "CHANGES REQUESTED",
      "Review feedback is blocking your pull request",
      pullRequest.updatedAt,
      1,
      "red",
    );
  }

  if (pullRequest.viewerRelationship === "REVIEW_REQUESTED") {
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
      "A conversation is waiting for your response",
      pullRequest.updatedAt,
      1,
      "violet",
    );
  }

  if (authored && pullRequest.checkState === "FAILURE") {
    return reason(
      "ci-failed",
      "CI FAILED",
      "A failing check is blocking your pull request",
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
    pullRequest.mergeState === "MERGEABLE"
  ) {
    return reason(
      "ready",
      "READY",
      "Approved, green, and ready for the next step",
      pullRequest.updatedAt,
      2,
      "green",
    );
  }

  if (pullRequest.viewerRelationship === "TEAM_REVIEW_REQUESTED") {
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
      "No meaningful activity for at least seven days",
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
      "AWAITING REVIEW",
      "Reviewers own the next step",
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
    "UPDATED",
    "Recently changed",
    pullRequest.lastMeaningfulActivityAt,
    5,
    "muted",
  );
}

export function isActionable(pullRequest, now = new Date()) {
  return dominantReason(pullRequest, now).lane < 5;
}

/**
 * Pull requests where the viewer (or their team) has explicitly been asked for
 * something: lanes 1 through 3. Deliberately narrower than `isActionable`,
 * which also includes lane 4 ("stale"). Age alone is not a request, so it must
 * not drive the tray badge or the "needs your attention" notification.
 */
export function needsAttentionNow(pullRequest, now = new Date()) {
  return dominantReason(pullRequest, now).lane < 4;
}

function reason(code, label, explanation, timestamp, lane, tone) {
  return { code, explanation, label, lane, timestamp, tone };
}
