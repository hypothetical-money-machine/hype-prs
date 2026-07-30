import type { PullRequestSummary } from "../lib/types";

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

export const STALE_AFTER_DAYS: number;

export function isStale(
  pullRequest: PullRequestSummary,
  now?: Date,
): boolean;

export function dominantReason(
  pullRequest: PullRequestSummary,
  now?: Date,
): Reason;

export function isActionable(
  pullRequest: PullRequestSummary,
  now?: Date,
): boolean;

export function needsAttentionNow(
  pullRequest: PullRequestSummary,
  now?: Date,
): boolean;
