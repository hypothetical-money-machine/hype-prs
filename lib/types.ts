export type CheckState = "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL";

export type MergeState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export type ReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED"
  | null;

export type ReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING"
  | null;

export type ViewerRelationship =
  | "AUTHOR"
  | "REVIEW_REQUESTED"
  | "TEAM_REVIEW_REQUESTED"
  | "ASSIGNED"
  | "PARTICIPATING";

export interface PullRequestActor {
  avatarUrl?: string | null;
  login: string;
  name?: string | null;
}

export interface PullRequestSummary {
  additions: number;
  author: PullRequestActor;
  baseRefName: string;
  changedFiles: number;
  checkState: CheckState;
  commentCount: number;
  createdAt: string;
  deletions: number;
  headRefName: string;
  headSha: string;
  id: string;
  isDraft: boolean;
  labels: string[];
  lastMeaningfulActivityAt: string;
  mergeState: MergeState;
  mentionsViewer: boolean;
  number: number;
  repository: string;
  reviewDecision: ReviewDecision;
  reviewRequestedAt: string | null;
  teamReviewRequested: boolean;
  title: string;
  updatedAt: string;
  url: string;
  viewerLastReviewCommitSha: string | null;
  viewerLastReviewAt: string | null;
  viewerRelationship: ViewerRelationship;
  viewerReviewState: ReviewState;
}

export type ChangedFileStatus =
  | "added"
  | "changed"
  | "copied"
  | "deleted"
  | "modified"
  | "removed"
  | "renamed"
  | "unchanged";

export interface ChangedFile {
  additions: number;
  blobUrl: string | null;
  changes: number;
  deletions: number;
  filename: string;
  patch: string | null;
  previousFilename: string | null;
  rawUrl: string | null;
  status: ChangedFileStatus;
}

export interface PullRequestDiff {
  baseSha: string;
  files: ChangedFile[];
  headSha: string;
  patch: string;
  truncated: boolean;
}

export interface InboxPayload {
  pullRequests: PullRequestSummary[];
  rateLimit: {
    cost: number;
    remaining: number;
    resetAt: string;
  } | null;
  syncedAt: string;
  viewer: PullRequestActor;
  warnings?: string[];
}

export interface ConnectionStatus {
  authKind: "device" | "redirect" | null;
  configured: boolean;
  connected: boolean;
  expiresAt: string | null;
  mode: "demo" | "electron" | "web";
  viewer: PullRequestActor | null;
}

export interface DeviceFlowStart {
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
}

export type DeviceFlowPoll =
  | { status: "pending" | "slow_down" }
  | {
      status: "connected";
      viewer: PullRequestActor;
      expiresAt: string | null;
    }
  | {
      status: "expired" | "denied" | "error";
      message: string;
    };

export type ReviewEvent = "APPROVE" | "COMMENT" | "REQUEST_CHANGES";

export interface SubmitReviewInput {
  baseCommitId: string;
  body: string;
  commitId: string;
  event: ReviewEvent;
  number: number;
  owner: string;
  repository: string;
}

export interface GitHubBridge {
  connectionStatus(): Promise<ConnectionStatus>;
  disconnect(): Promise<void>;
  getInbox(): Promise<InboxPayload>;
  getPullDiff(input: {
    number: number;
    owner: string;
    repository: string;
  }, signal?: AbortSignal): Promise<PullRequestDiff>;
  openExternal(url: string): Promise<void>;
  pollDeviceFlow(): Promise<DeviceFlowPoll>;
  startDeviceFlow(): Promise<DeviceFlowStart>;
  submitReview(input: SubmitReviewInput): Promise<{ submittedAt: string }>;
}

declare global {
  interface Window {
    hypePrs?: GitHubBridge;
  }
}
