import {
  hasUsableInboxData,
  mapInboxPayload,
  permissionWarning,
} from "./inbox-mapping.mjs";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_GRAPHQL_URL = `${GITHUB_API_URL}/graphql`;
const GITHUB_LOGIN_URL = "https://github.com/login";
const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_USER_AGENT = "Hype-PRs/0.1.0";
const GITHUB_MAX_READ_ATTEMPTS = 2;
const GITHUB_RETRY_DELAYS_MS = [250];
const GITHUB_TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const MAX_INBOX_RESULTS_PER_BUCKET = 20;
const MAX_DIFF_BYTES = 4 * 1024 * 1024;
const MAX_FILE_PAGES = 30;
const FILES_PER_PAGE = 100;

export const PR_FRAGMENT = `
  fragment PullRequestInboxItem on PullRequest {
    additions
    author {
      avatarUrl
      login
      ... on User {
        name
      }
    }
    baseRefName
    changedFiles
    commits(last: 1) {
      nodes {
        commit {
          oid
        }
      }
    }
    comments {
      totalCount
    }
    createdAt
    deletions
    headRefName
    headRefOid
    id
    isDraft
    labels(first: 20) {
      nodes {
        name
      }
    }
    number
    repository {
      nameWithOwner
    }
    title
    updatedAt
    url
  }
`;

// The mapping helpers in `inbox-mapping.mjs` derive the lane, the reason
// chips, and the "you are assigned / review requested" relationship from
// extra fields that the cheap inbox fragment above does not request. The
// paginated inbox query asks for them, at the cost of a larger query cost
// per page.
export const PR_DETAIL_FRAGMENT = `
  fragment PullRequestInboxItemDetail on PullRequest {
    additions
    author {
      avatarUrl
      login
      ... on User {
        name
      }
    }
    baseRefName
    changedFiles
    commits(last: 1) {
      nodes {
        commit {
          oid
          statusCheckRollup {
            state
          }
        }
      }
    }
    comments {
      totalCount
    }
    createdAt
    deletions
    headRefName
    headRefOid
    id
    isDraft
    labels(first: 100) {
      nodes {
        name
      }
    }
    latestOpinionatedReviews(first: 20) {
      nodes {
        author {
          login
        }
        commit {
          oid
        }
        state
        submittedAt
      }
    }
    mergeable
    number
    repository {
      nameWithOwner
    }
    reviewDecision
    reviewRequests(first: 20) {
      nodes {
        requestedReviewer {
          __typename
          ... on Team {
            name
            slug
          }
          ... on User {
            login
          }
        }
      }
    }
    title
    updatedAt
    url
  }
`;

export const INBOX_QUERY = `
  ${PR_FRAGMENT}
  query HypePullRequestInbox(
    $authoredQuery: String!
    $assignedQuery: String!
    $reviewQuery: String!
    $reviewedQuery: String!
  ) {
    viewer {
      avatarUrl
      login
      name
    }
    authored: search(type: ISSUE, query: $authoredQuery, first: ${MAX_INBOX_RESULTS_PER_BUCKET}) {
      nodes {
        ...PullRequestInboxItem
      }
    }
    assigned: search(type: ISSUE, query: $assignedQuery, first: ${MAX_INBOX_RESULTS_PER_BUCKET}) {
      nodes {
        ...PullRequestInboxItem
      }
    }
    reviewRequested: search(type: ISSUE, query: $reviewQuery, first: ${MAX_INBOX_RESULTS_PER_BUCKET}) {
      nodes {
        ...PullRequestInboxItem
      }
    }
    reviewed: search(type: ISSUE, query: $reviewedQuery, first: ${MAX_INBOX_RESULTS_PER_BUCKET}) {
      nodes {
        ...PullRequestInboxItem
      }
    }
    rateLimit {
      cost
      remaining
      resetAt
    }
  }
`;

// GitHub's `search` connection is Relay-style and only accepts `first`/`after`
// (or `last`/`before`). `offset` is not a valid argument and a request that
// includes it is rejected with a document validation error before the server
// runs any of the search aliases. Page 2 is therefore a follow-up that passes
// each bucket's end cursor from page 1.
export const INBOX_PAGE_QUERY = `
  ${PR_DETAIL_FRAGMENT}
  query HypePullRequestInboxPage(
    $authoredQuery: String!
    $assignedQuery: String!
    $reviewQuery: String!
    $reviewedQuery: String!
    $perBucket: Int!
    $authoredAfter: String
    $assignedAfter: String
    $reviewAfter: String
    $reviewedAfter: String
  ) {
    viewer {
      avatarUrl
      login
      name
    }
    authored: search(
      type: ISSUE
      query: $authoredQuery
      first: $perBucket
      after: $authoredAfter
    ) {
      nodes {
        ...PullRequestInboxItemDetail
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    assigned: search(
      type: ISSUE
      query: $assignedQuery
      first: $perBucket
      after: $assignedAfter
    ) {
      nodes {
        ...PullRequestInboxItemDetail
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    reviewRequested: search(
      type: ISSUE
      query: $reviewQuery
      first: $perBucket
      after: $reviewAfter
    ) {
      nodes {
        ...PullRequestInboxItemDetail
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    reviewed: search(
      type: ISSUE
      query: $reviewedQuery
      first: $perBucket
      after: $reviewedAfter
    ) {
      nodes {
        ...PullRequestInboxItemDetail
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    rateLimit {
      cost
      remaining
      resetAt
    }
  }
`;

export class GitHubApiError extends Error {
  constructor(
    message,
    {
      code = "github_error",
      githubMessage = null,
      requestId = null,
      status = 500,
    } = {},
  ) {
    super(message);
    this.name = "GitHubApiError";
    this.code = code;
    this.githubMessage = githubMessage;
    this.requestId = requestId;
    this.status = status;
  }
}

export async function getViewerWithToken(token, signal) {
  const response = await githubFetch(
    "/user",
    { method: "GET", signal },
    token,
  );
  const user = await response.json();
  return {
    avatarUrl: user.avatar_url ?? null,
    login: user.login,
    name: user.name ?? null,
  };
}

// GitHub reports installation permission denials as FORBIDDEN GraphQL errors.
// Match the machine-readable type first so a wording change (or localized
// variant) of the message cannot silently break github_403 classification.
function isPermissionError(error) {
  return (
    error?.type === "FORBIDDEN" ||
    error?.message === "Resource not accessible by integration"
  );
}

export async function loadInboxWithToken(token, signal) {
  const viewer = await getViewerWithToken(token, signal);
  const variables = {
    authoredQuery: `is:pull-request is:open author:${viewer.login} archived:false sort:updated-desc`,
    assignedQuery: `is:pull-request is:open assignee:${viewer.login} archived:false sort:updated-desc`,
    reviewQuery:
      "is:pull-request is:open user-review-requested:@me archived:false sort:updated-desc",
    reviewedQuery: `is:pull-request is:open reviewed-by:${viewer.login} archived:false sort:updated-desc`,
  };

  const response = await githubFetch(
    GITHUB_GRAPHQL_URL,
    {
      body: JSON.stringify({ query: INBOX_QUERY, variables }),
      method: "POST",
      signal,
    },
    token,
    { retryable: true },
  );
  const payload = await readJsonResponse(response);
  const graphqlErrors = Array.isArray(payload.errors) ? payload.errors : [];
  if (!payload.data && graphqlErrors.length === 0) {
    throw new GitHubApiError("GitHub returned an empty GraphQL response.", {
      code: "graphql_error",
      status: 502,
    });
  }
  const permissionDenied =
    graphqlErrors.length > 0 && graphqlErrors.every(isPermissionError);
  const canUsePartialData =
    permissionDenied && hasUsableInboxData(payload.data);
  if (graphqlErrors.length > 0 && !canUsePartialData) {
    const githubMessage =
      graphqlErrors[0]?.message ??
      "GitHub could not load the pull request inbox.";
    throw new GitHubApiError(
      permissionDenied
        ? "The GitHub App installation does not have access to the requested pull request data."
        : githubMessage,
      {
        code: permissionDenied ? "github_403" : "graphql_error",
        githubMessage,
        status: permissionDenied ? 403 : 502,
      },
    );
  }

  return mapInboxPayload(
    payload.data,
    viewer,
    canUsePartialData ? [permissionWarning(graphqlErrors)] : [],
  );
}

// Returns the raw GraphQL response for one paginated slice of the inbox:
// the four bucket node lists, the per-bucket `pageInfo`, the viewer, and the
// rate limit. Mapping and bucket deduplication happen on the client (or on
// whichever caller assembles the full inbox), so a PR that appears in two
// buckets across two pages keeps the bucket membership it earned in both.
export async function loadInboxPageWithToken(
  token,
  { perBucket, cursors = {} },
  signal,
) {
  const viewer = await getViewerWithToken(token, signal);
  const variables = {
    authoredQuery: `is:pull-request is:open author:${viewer.login} archived:false sort:updated-desc`,
    assignedQuery: `is:pull-request is:open assignee:${viewer.login} archived:false sort:updated-desc`,
    reviewQuery:
      "is:pull-request is:open user-review-requested:@me archived:false sort:updated-desc",
    reviewedQuery: `is:pull-request is:open reviewed-by:${viewer.login} archived:false sort:updated-desc`,
    perBucket,
    authoredAfter: cursors.authored ?? null,
    assignedAfter: cursors.assigned ?? null,
    reviewAfter: cursors.reviewRequested ?? null,
    reviewedAfter: cursors.reviewed ?? null,
  };

  const response = await githubFetch(
    GITHUB_GRAPHQL_URL,
    {
      body: JSON.stringify({ query: INBOX_PAGE_QUERY, variables }),
      method: "POST",
      signal,
    },
    token,
    { retryable: true },
  );
  const payload = await readJsonResponse(response);
  const graphqlErrors = Array.isArray(payload.errors) ? payload.errors : [];
  if (!payload.data && graphqlErrors.length === 0) {
    throw new GitHubApiError("GitHub returned an empty GraphQL response.", {
      code: "graphql_error",
      status: 502,
    });
  }
  const permissionDenied =
    graphqlErrors.length > 0 && graphqlErrors.every(isPermissionError);
  const canUsePartialData =
    permissionDenied && hasUsableInboxData(payload.data);
  if (graphqlErrors.length > 0 && !canUsePartialData) {
    const githubMessage =
      graphqlErrors[0]?.message ??
      "GitHub could not load the pull request inbox.";
    throw new GitHubApiError(
      permissionDenied
        ? "The GitHub App installation does not have access to the requested pull request data."
        : githubMessage,
      {
        code: permissionDenied ? "github_403" : "graphql_error",
        githubMessage,
        status: permissionDenied ? 403 : 502,
      },
    );
  }

  return {
    buckets: {
      authored: payload.data?.authored?.nodes ?? [],
      assigned: payload.data?.assigned?.nodes ?? [],
      reviewRequested: payload.data?.reviewRequested?.nodes ?? [],
      reviewed: payload.data?.reviewed?.nodes ?? [],
    },
    pageInfo: {
      authored: payload.data?.authored?.pageInfo ?? {
        endCursor: null,
        hasNextPage: false,
      },
      assigned: payload.data?.assigned?.pageInfo ?? {
        endCursor: null,
        hasNextPage: false,
      },
      reviewRequested: payload.data?.reviewRequested?.pageInfo ?? {
        endCursor: null,
        hasNextPage: false,
      },
      reviewed: payload.data?.reviewed?.pageInfo ?? {
        endCursor: null,
        hasNextPage: false,
      },
    },
    rateLimit: payload.data?.rateLimit
      ? {
          cost: payload.data.rateLimit.cost,
          remaining: payload.data.rateLimit.remaining,
          resetAt: payload.data.rateLimit.resetAt,
        }
      : null,
    viewer,
    warnings: canUsePartialData ? [permissionWarning(graphqlErrors)] : [],
  };
}

export async function loadPullDiffWithToken(
  token,
  { owner, repository, number },
  signal,
) {
  validateRepositoryCoordinates({ owner, repository, number });
  const basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repository,
  )}/pulls/${number}`;

  const beforeResponse = await githubFetch(
    basePath,
    { method: "GET", signal },
    token,
  );
  const before = await beforeResponse.json();
  const headSha = before.head?.sha;
  const baseSha = before.base?.sha;
  if (!headSha || !baseSha) {
    throw new GitHubApiError(
      "GitHub did not return the pull request comparison revisions.",
      { code: "invalid_response", status: 502 },
    );
  }

  const [patchResponse, files] = await Promise.all([
    githubFetch(
      basePath,
      {
        headers: { Accept: "application/vnd.github.diff" },
        method: "GET",
        signal,
      },
      token,
    ),
    loadChangedFiles(token, basePath, signal),
  ]);

  const limitedPatch = await readTextWithLimit(patchResponse, MAX_DIFF_BYTES);
  const truncated =
    limitedPatch.truncated || files.length >= MAX_FILE_PAGES * FILES_PER_PAGE;

  const afterResponse = await githubFetch(
    basePath,
    { method: "GET", signal },
    token,
  );
  const after = await afterResponse.json();
  if (after.head?.sha !== headSha || after.base?.sha !== baseSha) {
    throw new GitHubApiError(
      "This pull request comparison changed while its diff was loading. Refresh and try again.",
      { code: "revision_changed", status: 409 },
    );
  }

  return {
    baseSha,
    files,
    headSha,
    patch: limitedPatch.text,
    truncated,
  };
}

export async function submitReviewWithToken(token, input, signal) {
  if (!input || typeof input !== "object") {
    throw new GitHubApiError("Invalid review.", {
      code: "invalid_review",
      status: 400,
    });
  }
  const {
    owner,
    repository,
    number,
    event,
    body,
    commitId,
    baseCommitId,
  } = input;
  validateRepositoryCoordinates({ owner, repository, number });
  if (!["APPROVE", "COMMENT", "REQUEST_CHANGES"].includes(event)) {
    throw new GitHubApiError("Unsupported review action.", {
      code: "invalid_review",
      status: 400,
    });
  }
  if (typeof body !== "string" || body.length > 65_536) {
    throw new GitHubApiError("Invalid review summary.", {
      code: "invalid_review",
      status: 400,
    });
  }
  if (event !== "APPROVE" && !body.trim()) {
    throw new GitHubApiError(
      "A review summary is required for comments and change requests.",
      { code: "invalid_review", status: 400 },
    );
  }
  if (
    typeof commitId !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commitId)
  ) {
    throw new GitHubApiError(
      "A full pull request revision is required before submitting a review.",
      { code: "invalid_review", status: 400 },
    );
  }
  if (
    typeof baseCommitId !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(baseCommitId)
  ) {
    throw new GitHubApiError(
      "A full base revision is required before submitting a review.",
      { code: "invalid_review", status: 400 },
    );
  }

  const currentResponse = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repository,
    )}/pulls/${number}`,
    { method: "GET", signal },
    token,
  );
  const current = await currentResponse.json();
  if (
    current.head?.sha !== commitId ||
    current.base?.sha !== baseCommitId
  ) {
    throw new GitHubApiError(
      "This pull request comparison changed since it was loaded. Refresh before submitting the review.",
      { code: "revision_changed", status: 409 },
    );
  }

  const reviewResponse = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repository,
    )}/pulls/${number}/reviews`,
    {
      body: JSON.stringify({
        body: body.trim(),
        commit_id: commitId,
        event,
      }),
      method: "POST",
      signal,
    },
    token,
  );
  const review = await readJsonResponse(reviewResponse);
  return { submittedAt: review.submitted_at ?? new Date().toISOString() };
}

export async function exchangeAuthorizationCode(
  {
    clientId,
    clientSecret,
    code,
    codeVerifier,
    redirectUri,
  },
  signal,
) {
  const response = await fetch(`${GITHUB_LOGIN_URL}/oauth/access_token`, {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal,
  });
  const payload = await readJsonResponse(response);
  if (!response.ok || payload.error || !payload.access_token) {
    throw githubLoginError(payload, response.status);
  }
  return normalizeTokenSet(payload);
}

export async function refreshUserToken(
  { clientId, clientSecret, refreshToken },
  signal,
) {
  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  };
  const response = await fetch(`${GITHUB_LOGIN_URL}/oauth/access_token`, {
    body: new URLSearchParams(body),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal,
  });
  const payload = await readJsonResponse(response);
  if (!response.ok || payload.error || !payload.access_token) {
    throw githubLoginError(payload, response.status);
  }
  return normalizeTokenSet(payload);
}

export function publicError(error) {
  if (error instanceof GitHubApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }
  if (error?.name === "AbortError") {
    return {
      code: "request_cancelled",
      message: "The request was cancelled.",
      status: 499,
    };
  }
  return {
    code: "unexpected_error",
    message: "Something went wrong while contacting GitHub.",
    status: 500,
  };
}

async function loadChangedFiles(token, basePath, signal) {
  const files = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
    const response = await githubFetch(
      `${basePath}/files?per_page=${FILES_PER_PAGE}&page=${page}`,
      { method: "GET", signal },
      token,
    );
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new GitHubApiError("GitHub returned an invalid changed-file list.", {
        code: "invalid_response",
        status: 502,
      });
    }
    files.push(
      ...payload.map((file) => ({
        additions: file.additions ?? 0,
        blobUrl: file.blob_url ?? null,
        changes: file.changes ?? 0,
        deletions: file.deletions ?? 0,
        filename: file.filename,
        patch: file.patch ?? null,
        previousFilename: file.previous_filename ?? null,
        rawUrl: file.raw_url ?? null,
        status: file.status ?? "modified",
      })),
    );
    if (payload.length < FILES_PER_PAGE) break;
  }
  return files;
}

async function readTextWithLimit(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    return { text: "", truncated: true };
  }
  if (!response.body) return { text: "", truncated: false };

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return { text: "", truncated: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated: false };
}

function describeGitHubErrors(errors) {
  if (!Array.isArray(errors)) return null;
  const described = [];
  for (const entry of errors) {
    if (typeof entry === "string") {
      described.push(entry);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.message === "string" && entry.message.trim()) {
      described.push(entry.message.trim());
      continue;
    }
    const field = typeof entry.field === "string" ? entry.field : null;
    if (!field) continue;
    if (entry.code === "missing_field" || entry.code === "missing") {
      described.push(`${field} is required.`);
    } else if (entry.code === "invalid") {
      described.push(`${field} is invalid.`);
    } else if (entry.code === "already_exists") {
      described.push(`${field} already exists.`);
    }
  }
  if (!described.length) return null;
  return [...new Set(described)].join(" ");
}

async function githubFetch(pathOrUrl, init, token, { retryable = false } = {}) {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `${GITHUB_API_URL}${pathOrUrl}`;
  if (
    !url.startsWith(`${GITHUB_API_URL}/`) &&
    url !== GITHUB_GRAPHQL_URL
  ) {
    throw new GitHubApiError("Blocked an unexpected GitHub API destination.", {
      code: "invalid_destination",
      status: 400,
    });
  }

  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/vnd.github+json");
  }
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("User-Agent", GITHUB_USER_AGENT);
  headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const canRetry = retryable || init.method === "GET";
  const maxAttempts = canRetry ? GITHUB_MAX_READ_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch (error) {
      if (isAbortError(error, init.signal)) throw error;
      if (attempt < maxAttempts) {
        const delayMs = GITHUB_RETRY_DELAYS_MS[attempt - 1];
        logGitHubRetry({
          attempt,
          delayMs,
          endpoint: githubEndpoint(url),
          method: init.method ?? "GET",
          reason: "network_error",
        });
        await waitForGitHubRetry(delayMs, init.signal);
        continue;
      }
      logGitHubFailure({
        attempts: attempt,
        endpoint: githubEndpoint(url),
        errorName: error instanceof Error ? error.name : "UnknownError",
        method: init.method ?? "GET",
      });
      throw new GitHubApiError(
        "GitHub could not be reached. Try again in a moment.",
        { code: "github_network_error", status: 503 },
      );
    }

    if (response.ok) return response;

    if (
      attempt < maxAttempts &&
      GITHUB_TRANSIENT_STATUSES.has(response.status)
    ) {
      const delayMs = GITHUB_RETRY_DELAYS_MS[attempt - 1];
      logGitHubRetry({
        attempt,
        delayMs,
        endpoint: githubEndpoint(url),
        githubRequestId: response.headers.get("x-github-request-id"),
        method: init.method ?? "GET",
        reason: "http_status",
        status: response.status,
      });
      await response.body?.cancel().catch(() => {});
      await waitForGitHubRetry(delayMs, init.signal);
      continue;
    }

    return throwGitHubResponseError(response, {
      attempts: attempt,
      endpoint: githubEndpoint(url),
      method: init.method ?? "GET",
    });
  }

  throw new GitHubApiError("GitHub request retry loop failed unexpectedly.", {
    code: "github_retry_error",
    status: 500,
  });
}

async function throwGitHubResponseError(response, context) {
  let githubMessage = null;
  if (
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const payload = await response.json().catch(() => null);
    if (typeof payload?.message === "string") {
      githubMessage = payload.message;
    }
    // Validation failures (422) put the useful reason in `errors`; the
    // top-level message is only ever "Unprocessable Entity".
    const details = describeGitHubErrors(payload?.errors);
    if (details) {
      githubMessage = githubMessage ? `${githubMessage}: ${details}` : details;
    }
  } else {
    await response.body?.cancel().catch(() => {});
  }
  let message =
    githubMessage ?? `GitHub request failed (${response.status}).`;
  if (GITHUB_TRANSIENT_STATUSES.has(response.status)) {
    message =
      "GitHub is temporarily unavailable. We retried automatically; try again in a moment.";
  } else if (response.status === 401) {
    message = "The GitHub session expired or was revoked. Connect again.";
  } else if (response.status === 403) {
    message =
      response.headers.get("x-ratelimit-remaining") === "0"
        ? "GitHub’s API rate limit was reached. Try again after it resets."
        : "GitHub denied access. Check the App installation and organization approval.";
  } else if (response.status === 404) {
    message =
      "The pull request is unavailable or the GitHub App cannot access its repository.";
  }

  logGitHubFailure({
    ...context,
    githubRequestId: response.headers.get("x-github-request-id"),
    status: response.status,
  });
  throw new GitHubApiError(message, {
    code: `github_${response.status}`,
    githubMessage,
    requestId: response.headers.get("x-github-request-id"),
    status: response.status,
  });
}

function githubEndpoint(url) {
  return new URL(url).pathname;
}

function isAbortError(error, signal) {
  return signal?.aborted || error?.name === "AbortError";
}

function logGitHubRetry(details) {
  console.warn(
    JSON.stringify({ event: "github_api_retry", ...details }),
  );
}

function logGitHubFailure(details) {
  console.error(
    JSON.stringify({ event: "github_api_request_failed", ...details }),
  );
}

async function waitForGitHubRetry(delayMs, signal) {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(done, delayMs);
    function abort() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Request aborted.", "AbortError"));
    }
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function githubLoginError(payload, status) {
  return new GitHubApiError(
    payload.error_description ??
      payload.error ??
      "GitHub could not complete authentication.",
    {
      code: payload.error ?? "github_login_error",
      status: status >= 400 ? status : 401,
    },
  );
}

function normalizeTokenSet(payload) {
  const now = Date.now();
  return {
    accessToken: payload.access_token,
    expiresAt: payload.expires_in
      ? new Date(now + payload.expires_in * 1000).toISOString()
      : null,
    refreshToken: payload.refresh_token ?? null,
    refreshTokenExpiresAt: payload.refresh_token_expires_in
      ? new Date(
          now + payload.refresh_token_expires_in * 1000,
        ).toISOString()
      : null,
    tokenType: payload.token_type ?? "bearer",
  };
}

function validateRepositoryCoordinates({ owner, repository, number }) {
  // Reject "." and ".." explicitly: they pass encodeURIComponent unchanged
  // and URL-normalize into a different, unintended API endpoint.
  const validSegment = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
  if (
    typeof owner !== "string" ||
    typeof repository !== "string" ||
    !validSegment.test(owner) ||
    !validSegment.test(repository) ||
    !Number.isInteger(number) ||
    number < 1
  ) {
    throw new GitHubApiError("Invalid pull request coordinates.", {
      code: "invalid_pull_request",
      status: 400,
    });
  }
}
