import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GitHubApiError,
  PR_FRAGMENT,
  getViewerWithToken,
  loadInboxWithToken,
  loadPullDiffWithToken,
  refreshUserToken,
  submitReviewWithToken,
} from "../shared/github-api.mjs";

const OLD_HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);
const CURRENT_HEAD = "c".repeat(40);
const BASE_SHA = "d".repeat(40);
const NEW_BASE_SHA = "e".repeat(40);

test("documents Contents access for commit-backed inbox fields", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(PR_FRAGMENT, /commits\(last: 1\)/);
  assert.match(PR_FRAGMENT, /latestOpinionatedReviews/);
  assert.match(readme, /- Contents: read/);
});

test("authenticated API requests identify Hype to GitHub", async () => {
  const originalFetch = globalThis.fetch;
  let requestHeaders: Headers | null = null;
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return Response.json({
      avatar_url: null,
      login: "morgan",
      name: "Morgan",
    });
  };

  try {
    await getViewerWithToken("secret-token");
    assert.equal(requestHeaders?.get("User-Agent"), "Hype-PRs/0.1.0");
    assert.equal(
      requestHeaders?.get("X-GitHub-Api-Version"),
      "2026-03-10",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("live inbox cards map every displayed PR field from GitHub", async () => {
  const originalFetch = globalThis.fetch;
  let graphqlBody: { query?: string } | null = null;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/user")) {
      return Response.json({
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        login: "morgan",
        name: "Morgan",
      });
    }

    graphqlBody = JSON.parse(String(init?.body));
    const pullRequest = {
      additions: 58,
      author: {
        avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
        login: "octocat",
        name: "Octo Cat",
      },
      baseRefName: "main",
      changedFiles: 3,
      comments: { totalCount: 7 },
      commits: {
        nodes: [
          {
            commit: {
              oid: CURRENT_HEAD,
              statusCheckRollup: { state: "SUCCESS" },
            },
          },
        ],
      },
      createdAt: "2026-07-26T18:00:00.000Z",
      deletions: 14,
      headRefName: "real-card-data",
      headRefOid: CURRENT_HEAD,
      id: "PR_real",
      isDraft: false,
      labels: { nodes: [{ name: "a11y" }, { name: "design-system" }] },
      latestOpinionatedReviews: { nodes: [] },
      mergeable: "MERGEABLE",
      number: 128,
      repository: { nameWithOwner: "real/design-system" },
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: "User",
              login: "morgan",
            },
          },
        ],
      },
      title: "Use real pull request data",
      updatedAt: "2026-07-28T18:00:00.000Z",
      url: "https://github.com/real/design-system/pull/128",
    };
    return Response.json({
      data: {
        assigned: { nodes: [] },
        authored: { nodes: [] },
        rateLimit: {
          cost: 4,
          remaining: 4996,
          resetAt: "2026-07-28T19:00:00.000Z",
        },
        reviewRequested: { nodes: [pullRequest] },
        reviewed: { nodes: [] },
      },
      errors: [
        {
          message: "Resource not accessible by integration",
          path: [
            "reviewRequested",
            "nodes",
            0,
            "commits",
            "nodes",
            0,
            "commit",
            "statusCheckRollup",
          ],
        },
      ],
    });
  };

  try {
    const result = await loadInboxWithToken("secret-token");
    assert.match(graphqlBody?.query ?? "", /comments\s*\{\s*totalCount/);
    assert.match(graphqlBody?.query ?? "", /labels\(first: 100\)/);
    assert.deepEqual(result.pullRequests[0], {
      additions: 58,
      author: {
        avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
        login: "octocat",
        name: "Octo Cat",
      },
      baseRefName: "main",
      changedFiles: 3,
      checkState: "SUCCESS",
      commentCount: 7,
      createdAt: "2026-07-26T18:00:00.000Z",
      deletions: 14,
      headRefName: "real-card-data",
      headSha: CURRENT_HEAD,
      id: "PR_real",
      isDraft: false,
      labels: ["a11y", "design-system"],
      lastMeaningfulActivityAt: "2026-07-28T18:00:00.000Z",
      mergeState: "MERGEABLE",
      mentionsViewer: false,
      number: 128,
      repository: "real/design-system",
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequestedAt: null,
      teamReviewRequested: false,
      title: "Use real pull request data",
      updatedAt: "2026-07-28T18:00:00.000Z",
      url: "https://github.com/real/design-system/pull/128",
      viewerLastReviewCommitSha: null,
      viewerLastReviewAt: null,
      viewerRelationship: "REVIEW_REQUESTED",
      viewerReviewState: null,
    });
    assert.deepEqual(result.warnings, [
      "Some pull request details are unavailable. GitHub denied: statusCheckRollup. Approve the GitHub App’s requested repository permissions to restore them.",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an integration permission error when GitHub returns no inbox data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/user")) {
      return Response.json({
        avatar_url: null,
        login: "morgan",
        name: "Morgan",
      });
    }
    return Response.json({
      data: null,
      errors: [{ message: "Resource not accessible by integration" }],
    });
  };

  try {
    await assert.rejects(
      loadInboxWithToken("secret-token"),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.code === "github_403" &&
        error.status === 403 &&
        error.githubMessage === "Resource not accessible by integration" &&
        error.message.includes("installation does not have access"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not hide unexpected GraphQL errors behind a partial inbox", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/user")) {
      return Response.json({
        avatar_url: null,
        login: "morgan",
        name: "Morgan",
      });
    }
    return Response.json({
      data: {
        assigned: { nodes: [] },
        authored: { nodes: [] },
        reviewRequested: { nodes: [] },
        reviewed: { nodes: [] },
      },
      errors: [{ message: "GitHub could not resolve the inbox query." }],
    });
  };

  try {
    await assert.rejects(
      loadInboxWithToken("secret-token"),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.code === "graphql_error" &&
        error.status === 502 &&
        error.message === "GitHub could not resolve the inbox query.",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub API errors retain safe upstream diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        documentation_url:
          "https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#user-agent",
        message: "User agent required",
      },
      {
        headers: { "x-github-request-id": "ABC1:2345:6789" },
        status: 403,
      },
    );

  try {
    await assert.rejects(
      getViewerWithToken("secret-token"),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.code === "github_403" &&
        error.status === 403 &&
        error.githubMessage === "User agent required" &&
        error.requestId === "ABC1:2345:6789",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unsafe repository coordinates before making a request", async () => {
  await assert.rejects(
    loadPullDiffWithToken("token", {
      number: 7,
      owner: "acme/../../elsewhere",
      repository: "console",
    }),
    (error: unknown) =>
      error instanceof GitHubApiError &&
      error.code === "invalid_pull_request" &&
      error.status === 400,
  );
});

test("refuses to submit a review when the PR head changed", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ init, url: String(input) });
    return Response.json({
      base: { sha: BASE_SHA },
      head: { sha: NEW_HEAD },
    });
  };

  try {
    await assert.rejects(
      submitReviewWithToken("secret-token", {
        baseCommitId: BASE_SHA,
        body: "Looks good.",
        commitId: OLD_HEAD,
        event: "APPROVE",
        number: 42,
        owner: "acme",
        repository: "console",
      }),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.code === "revision_changed" &&
        error.status === 409,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init?.method, "GET");
    assert.equal(
      new Headers(calls[0]?.init?.headers).get("Authorization"),
      "Bearer secret-token",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review submission pins the verified current head and trims the body", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ init, url: String(input) });
    if (init?.method === "GET") {
      return Response.json({
        base: { sha: BASE_SHA },
        head: { sha: CURRENT_HEAD },
      });
    }
    return Response.json({ submitted_at: "2026-07-28T18:00:00.000Z" });
  };

  try {
    const result = await submitReviewWithToken("secret-token", {
      baseCommitId: BASE_SHA,
      body: "  Please address the edge case.  ",
      commitId: CURRENT_HEAD,
      event: "REQUEST_CHANGES",
      number: 42,
      owner: "acme",
      repository: "console",
    });

    assert.equal(result.submittedAt, "2026-07-28T18:00:00.000Z");
    assert.equal(calls.length, 2);
    const requestBody = JSON.parse(String(calls[1]?.init?.body));
    assert.deepEqual(requestBody, {
      body: "Please address the edge case.",
      commit_id: CURRENT_HEAD,
      event: "REQUEST_CHANGES",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requires a full displayed revision at the mutation boundary", async () => {
  await assert.rejects(
    submitReviewWithToken("secret-token", {
      body: "",
      event: "APPROVE",
      number: 42,
      owner: "acme",
      repository: "console",
    } as never),
    (error: unknown) =>
      error instanceof GitHubApiError &&
      error.code === "invalid_review" &&
      error.status === 400,
  );
});

test("requires the displayed base revision at the mutation boundary", async () => {
  await assert.rejects(
    submitReviewWithToken("secret-token", {
      body: "",
      commitId: CURRENT_HEAD,
      event: "APPROVE",
      number: 42,
      owner: "acme",
      repository: "console",
    } as never),
    (error: unknown) =>
      error instanceof GitHubApiError &&
      error.code === "invalid_review" &&
      error.status === 400,
  );
});

test("a patchless binary file does not suppress valid textual diffs", async () => {
  const originalFetch = globalThis.fetch;
  const patch =
    "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const accept = new Headers(init?.headers).get("Accept");
    if (url.includes("/files?")) {
      return Response.json([
        {
          additions: 1,
          changes: 2,
          deletions: 1,
          filename: "src/index.ts",
          patch: "@@ -1 +1 @@\n-old\n+new",
          status: "modified",
        },
        {
          additions: 0,
          changes: 0,
          deletions: 0,
          filename: "public/logo.png",
          patch: null,
          status: "modified",
        },
      ]);
    }
    if (accept === "application/vnd.github.diff") {
      return new Response(patch);
    }
    return Response.json({
      base: { sha: BASE_SHA },
      head: { sha: CURRENT_HEAD },
    });
  };

  try {
    const result = await loadPullDiffWithToken("secret-token", {
      number: 42,
      owner: "acme",
      repository: "console",
    });
    assert.equal(result.truncated, false);
    assert.equal(result.patch, patch);
    assert.equal(result.files.length, 2);
    assert.equal(result.files[1]?.patch, null);
    assert.equal(result.baseSha, BASE_SHA);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stops reading a diff stream as soon as the byte budget is exceeded", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const accept = new Headers(init?.headers).get("Accept");
    if (url.includes("/files?")) return Response.json([]);
    if (accept === "application/vnd.github.diff") {
      let chunk = 0;
      const stream = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
        pull(controller) {
          chunk += 1;
          controller.enqueue(
            new Uint8Array((chunk === 1 ? 3 : 2) * 1024 * 1024),
          );
        },
      });
      return new Response(stream);
    }
    return Response.json({
      base: { sha: BASE_SHA },
      head: { sha: CURRENT_HEAD },
    });
  };

  try {
    const result = await loadPullDiffWithToken("secret-token", {
      number: 42,
      owner: "acme",
      repository: "console",
    });
    assert.equal(result.truncated, true);
    assert.equal(result.patch, "");
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a mixed diff snapshot when only the base revision moves", async () => {
  const originalFetch = globalThis.fetch;
  let pullReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const accept = new Headers(init?.headers).get("Accept");
    if (url.includes("/files?")) return Response.json([]);
    if (accept === "application/vnd.github.diff") {
      return new Response("diff --git a/a b/a\n");
    }
    pullReads += 1;
    return Response.json({
      base: { sha: pullReads === 1 ? BASE_SHA : NEW_BASE_SHA },
      head: { sha: CURRENT_HEAD },
    });
  };

  try {
    await assert.rejects(
      loadPullDiffWithToken("secret-token", {
        number: 42,
        owner: "acme",
        repository: "console",
      }),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.code === "revision_changed" &&
        error.status === 409,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refuses a review when the base revision moved after display", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      base: { sha: NEW_BASE_SHA },
      head: { sha: CURRENT_HEAD },
    });
  };

  try {
    await assert.rejects(
      submitReviewWithToken("secret-token", {
        baseCommitId: BASE_SHA,
        body: "",
        commitId: CURRENT_HEAD,
        event: "APPROVE",
        number: 42,
        owner: "acme",
        repository: "console",
      }),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.code === "revision_changed" &&
        error.status === 409,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web refresh sends the client secret", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body);
    return Response.json({
      access_token: "access",
      refresh_token: "refresh-next",
      token_type: "bearer",
    });
  };

  try {
    await refreshUserToken({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
    });
    assert.match(requestBody, /client_secret=secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
