import type {
  InboxPayload,
  PullRequestActor,
  PullRequestDiff,
  ReviewEvent,
} from "../lib/types";

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
export const PR_FRAGMENT: string;

export function getViewerWithToken(
  token: string,
  signal?: AbortSignal,
): Promise<PullRequestActor>;

export function loadInboxWithToken(
  token: string,
  signal?: AbortSignal,
): Promise<InboxPayload>;

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

export function startDeviceFlow(
  clientId: string,
  signal?: AbortSignal,
): Promise<{
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
}>;

export function pollDeviceFlow(
  clientId: string,
  deviceCode: string,
  signal?: AbortSignal,
): Promise<
  | { status: "pending" | "slow_down" }
  | { status: "token"; tokenSet: TokenSet }
  | {
      status: "expired" | "denied" | "error";
      message: string;
    }
>;

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
    clientSecret?: string;
    refreshToken: string;
  },
  signal?: AbortSignal,
): Promise<TokenSet>;

export function publicError(error: unknown): {
  code: string;
  message: string;
  status: number;
};
