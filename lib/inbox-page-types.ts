import type { PullRequestActor } from "./types";

export interface InboxPageBucketPageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

export type InboxPageBucketPageInfoMap = Record<
  "assigned" | "authored" | "reviewRequested" | "reviewed",
  InboxPageBucketPageInfo
>;

export interface InboxPageBucketNodes {
  assigned: unknown[];
  authored: unknown[];
  reviewRequested: unknown[];
  reviewed: unknown[];
}

export interface InboxPage {
  buckets: InboxPageBucketNodes;
  pageInfo: InboxPageBucketPageInfoMap;
  rateLimit: {
    cost: number;
    remaining: number;
    resetAt: string;
  } | null;
  viewer: PullRequestActor;
  warnings: string[];
}
