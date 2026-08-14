const GITHUB_API_URL = "https://api.github.com";
const GITHUB_GRAPHQL_URL = `${GITHUB_API_URL}/graphql`;
const GITHUB_LOGIN_URL = "https://github.com/login";
const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_USER_AGENT = "Hype-PRs/0.1.0";
const MAX_DIFF_BYTES = 4 * 1024 * 1024;
const MAX_FILE_PAGES = 30;

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
    authored: search(type: ISSUE, query: $authoredQuery, first: 50) {
      nodes {
        ...PullRequestInboxItem
      }
    }
    assigned: search(type: ISSUE, query: $assignedQuery, first: 50) {
      nodes {
        ...PullRequestInboxItem
      }
    }
    reviewRequested: search(type: ISSUE, query: $reviewQuery, first: 50) {
      nodes {
        ...PullRequestInboxItem
      }
    }
    reviewed: search(type: ISSUE, query: $reviewedQuery, first: 50) {
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
  );
  const payload = await response.json();
  const graphqlErrors = Array.isArray(payload.errors) ? payload.errors : [];
  const permissionDenied =
    graphqlErrors.length > 0 &&
    graphqlErrors.every(
      (error) => error?.message === "Resource not accessible by integration",
    );
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
  const truncated = limitedPatch.truncated || files.length >= 3000;

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
  const review = await reviewResponse.json();
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

function mapInboxPayload(data, viewer, warnings = []) {
  const buckets = [
    ["authored", data.authored?.nodes ?? []],
    ["assigned", data.assigned?.nodes ?? []],
    ["reviewRequested", data.reviewRequested?.nodes ?? []],
    ["reviewed", data.reviewed?.nodes ?? []],
  ];
  const indexed = new Map();

  for (const [bucket, nodes] of buckets) {
    for (const node of nodes) {
      if (!node?.id) continue;
      const existing = indexed.get(node.id) ?? { buckets: new Set(), node };
      existing.buckets.add(bucket);
      indexed.set(node.id, existing);
    }
  }

  const pullRequests = [...indexed.values()].map(({ node, buckets }) =>
    mapPullRequest(node, buckets, viewer.login),
  );

  return {
    pullRequests,
    rateLimit: data.rateLimit
      ? {
          cost: data.rateLimit.cost,
          remaining: data.rateLimit.remaining,
          resetAt: data.rateLimit.resetAt,
        }
      : null,
    syncedAt: new Date().toISOString(),
    viewer,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function hasUsableInboxData(data) {
  return ["authored", "assigned", "reviewRequested", "reviewed"].some(
    (bucket) => Array.isArray(data?.[bucket]?.nodes),
  );
}

function permissionWarning(errors) {
  const fields = [
    ...new Set(
      errors
        .map((error) =>
          Array.isArray(error?.path) ? error.path.at(-1) : null,
        )
        .filter((field) => typeof field === "string"),
    ),
  ];
  const detail =
    fields.length > 0 ? ` GitHub denied: ${fields.join(", ")}.` : "";
  return `Some pull request details are unavailable.${detail} Approve the GitHub App’s requested repository permissions to restore them.`;
}

function mapPullRequest(node, buckets, viewerLogin) {
  const reviewRequests = node.reviewRequests?.nodes ?? [];
  const directReview = reviewRequests.some(
    (request) =>
      request?.requestedReviewer?.__typename === "User" &&
      request.requestedReviewer.login === viewerLogin,
  );
  const requestedTeamPresent = reviewRequests.some(
    (request) => request?.requestedReviewer?.__typename === "Team",
  );
  const reviews = (node.latestOpinionatedReviews?.nodes ?? []).filter(
    (review) => review?.author?.login === viewerLogin,
  );
  const viewerReview = reviews
    .slice()
    .sort(
      (left, right) =>
        new Date(right.submittedAt).getTime() -
        new Date(left.submittedAt).getTime(),
    )[0];
  const commit = node.commits?.nodes?.[0]?.commit;
  const authored = buckets.has("authored") || node.author?.login === viewerLogin;

  let viewerRelationship = "PARTICIPATING";
  if (authored) viewerRelationship = "AUTHOR";
  else if (buckets.has("reviewRequested") && directReview) {
    viewerRelationship = "REVIEW_REQUESTED";
  } else if (buckets.has("reviewRequested") && requestedTeamPresent) {
    viewerRelationship = "TEAM_REVIEW_REQUESTED";
  } else if (buckets.has("assigned")) {
    viewerRelationship = "ASSIGNED";
  }

  return {
    additions: node.additions ?? 0,
    author: {
      avatarUrl: node.author?.avatarUrl ?? null,
      login: node.author?.login ?? "ghost",
      name: node.author?.name ?? null,
    },
    baseRefName: node.baseRefName ?? "",
    changedFiles: node.changedFiles ?? 0,
    checkState: normalizeCheckState(commit?.statusCheckRollup?.state),
    commentCount: node.comments?.totalCount ?? 0,
    createdAt: node.createdAt,
    deletions: node.deletions ?? 0,
    headRefName: node.headRefName ?? "",
    headSha: node.headRefOid ?? commit?.oid ?? "",
    id: node.id,
    isDraft: Boolean(node.isDraft),
    labels: (node.labels?.nodes ?? []).map((label) => label.name),
    lastMeaningfulActivityAt: node.updatedAt,
    mergeState: normalizeMergeState(node.mergeable),
    mentionsViewer: false,
    number: node.number,
    repository: node.repository.nameWithOwner,
    reviewDecision: node.reviewDecision ?? null,
    reviewRequestedAt: null,
    teamReviewRequested:
      buckets.has("reviewRequested") && requestedTeamPresent,
    title: node.title,
    updatedAt: node.updatedAt,
    url: node.url,
    viewerLastReviewCommitSha: viewerReview?.commit?.oid ?? null,
    viewerLastReviewAt: viewerReview?.submittedAt ?? null,
    viewerRelationship,
    viewerReviewState: viewerReview?.state ?? null,
  };
}

async function loadChangedFiles(token, basePath, signal) {
  const files = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
    const response = await githubFetch(
      `${basePath}/files?per_page=100&page=${page}`,
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
    if (payload.length < 100) break;
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

async function githubFetch(pathOrUrl, init, token) {
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

  const response = await fetch(url, { ...init, headers });
  if (response.ok) return response;

  let githubMessage = null;
  if (
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const payload = await response.json().catch(() => null);
    if (typeof payload?.message === "string") {
      githubMessage = payload.message;
    }
  }
  let message =
    githubMessage ?? `GitHub request failed (${response.status}).`;
  if (response.status === 401) {
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

  throw new GitHubApiError(message, {
    code: `github_${response.status}`,
    githubMessage,
    requestId: response.headers.get("x-github-request-id"),
    status: response.status,
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

function normalizeCheckState(state) {
  if (state === "SUCCESS") return "SUCCESS";
  if (state === "FAILURE" || state === "ERROR") return "FAILURE";
  if (state === "PENDING" || state === "EXPECTED") return "PENDING";
  return "NEUTRAL";
}

function normalizeMergeState(state) {
  if (state === "MERGEABLE") return "MERGEABLE";
  if (state === "CONFLICTING") return "CONFLICTING";
  return "UNKNOWN";
}

function validateRepositoryCoordinates({ owner, repository, number }) {
  const validSegment = /^[A-Za-z0-9_.-]+$/;
  if (
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
