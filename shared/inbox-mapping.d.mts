// Hand-maintained declarations for `inbox-mapping.mjs`. The shared mapping
// module is imported by the client (via the gateway) and by the server
// (via `github-api.mjs`). It must stay free of fetch / query-string imports
// so the browser can pull it in without dragging the rest of the GitHub
// transport along.

import type { InboxPayload, PullRequestActor } from "../lib/types";
import type {
  InboxPage,
  InboxPageBucketNodes,
  InboxPageBucketPageInfoMap,
} from "../lib/inbox-page-types";

export type {
  InboxPage,
  InboxPageBucketNodes,
  InboxPageBucketPageInfoMap,
} from "../lib/inbox-page-types";

export const EMPTY_BUCKETS: Readonly<{
  assigned: never[];
  authored: never[];
  reviewRequested: never[];
  reviewed: never[];
}>;

export function emptyInboxPage(): InboxPage;

export function emptyPageInfo(): InboxPageBucketPageInfoMap;

export function cloneBuckets(
  buckets: Partial<InboxPageBucketNodes> | null | undefined,
): InboxPageBucketNodes;

export function mergeInboxPageBuckets(
  ...pages: (InboxPage | null | undefined)[]
): {
  buckets: InboxPageBucketNodes;
  pageInfo: InboxPageBucketPageInfoMap;
  rateLimit: InboxPage["rateLimit"];
  viewer: PullRequestActor | null;
  warnings: string[];
};

export function mapInboxPayload(
  data: unknown,
  viewer: PullRequestActor,
  warnings?: string[],
): InboxPayload;

export function hasUsableInboxData(data: unknown): boolean;
export function permissionWarning(errors: unknown): string;
