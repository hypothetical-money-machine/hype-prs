// This file is hand-maintained alongside `github-api.mjs`. The source file
// has no type information of its own, and the project's build does not emit
// `.d.ts` from it. Any new export added to the source must be declared
// here.
//
// The temptation to remove this file in favor of a JSR-style auto-generated
// declaration is real; until then, keep the source file and this declaration
// in sync.

import type {
  InboxPayload,
  PullRequestActor,
  PullRequestDiff,
  ReviewEvent,
} from "../lib/types";
import type { InboxPage } from "../lib/inbox-page-types";
import type { InboxPageBucketPageInfoMap } from "../lib/inbox-page-types";

export type { InboxPage, InboxPageBucketPageInfoMap } from "../lib/inbox-page-types";

export interface TokenSet {
  accessToken: string;
  expiresAt: string | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: string | null;
  tokenType: string;
}

export class GitHubApiError extends Error {
  code: string;
  githubMessage: string | null;
  requestId: string | null;
  status: number;
  constructor(
    message: string,
    options?: {
      code?: string;
      githubMessage?: string | null;
      requestId?: string | null;
      status?: number;
    },
  );
}

export const INBOX_QUERY: string;
export const INBOX_PAGE_QUERY: string;
export const PR_FRAGMENT: string;

export function getViewerWithToken(
  token: string,
  signal?: AbortSignal,
): Promise<PullRequestActor>;

export function loadInboxWithToken(
  token: string,
  signal?: AbortSignal,
): Promise<InboxPayload>;

export function loadInboxPageWithToken(
  token: string,
  options: {
    cursors?: Partial<Record<keyof InboxPageBucketPageInfoMap, string>>;
    perBucket: number;
  },
  signal?: AbortSignal,
): Promise<InboxPage>;

export function loadPullDiffWithToken(
  token: string,
  input: { number: number; owner: string; repository: string },
  signal?: AbortSignal,
): Promise<PullRequestDiff>;

export function submitReviewWithToken(
  token: string,
  input: {
    baseCommitId: string;
    body: string;
    commitId: string;
    event: ReviewEvent;
    number: number;
    owner: string;
    repository: string;
  },
  signal?: AbortSignal,
): Promise<{ submittedAt: string }>;

export function exchangeAuthorizationCode(
  input: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
  signal?: AbortSignal,
): Promise<TokenSet>;

export function refreshUserToken(
  input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  },
  signal?: AbortSignal,
): Promise<TokenSet>;

export function publicError(error: unknown): {
  code: string;
  message: string;
  status: number;
};
