import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GitHubApiError,
  PR_FRAGMENT,
  getViewerWithToken,
  loadInboxPageWithToken,
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

test("keeps the inbox query lightweight while documenting Contents access for diffs", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(PR_FRAGMENT, /commits\(last: 1\)/);
  assert.doesNotMatch(PR_FRAGMENT, /latestOpinionatedReviews/);
  assert.match(readme, /- Contents: read/);
});

test("authenticated API requests identify Hype PRs to GitHub", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ init?: RequestInit }> = [];
  globalThis.fetch = async (_input, init) => {
    calls.push({ init });
    return Response.json({
      avatar_url: null,
      login: "morgan",
      name: "Morgan",
    });
  };

  try {
    await getViewerWithToken("secret-token");
    const requestHeaders = new Headers(calls[0]?.init?.headers);
    assert.equal(requestHeaders.get("User-Agent"), "Hype-PRs/0.1.0");
    assert.equal(
      requestHeaders.get("X-GitHub-Api-Version"),
      "2026-03-10",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries a transient GitHub failure while loading the inbox", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; method?: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), method: init?.method });
    if (String(input).endsWith("/user")) {
      return Response.json({
        avatar_url: null,
        login: "morgan",
        name: "Morgan",
      });
    }
    if (calls.filter((call) => call.input.endsWith("/graphql")).length === 1) {
      return new Response("Bad Gateway", { status: 502 });
    }
    return Response.json({
      data: {
        assigned: { nodes: [] },
        authored: { nodes: [] },
        reviewRequested: { nodes: [] },
        reviewed: { nodes: [] },
      },
    });
  };

  try {
    const result = await loadInboxWithToken("secret-token");
    assert.deepEqual(result.pullRequests, []);
    assert.equal(
      calls.filter((call) => call.input.endsWith("/graphql")).length,
      2,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries a transient network failure while loading GitHub data", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return Response.json({
      avatar_url: null,
      login: "morgan",
      name: "Morgan",
    });
  };

  try {
    const viewer = await getViewerWithToken("secret-token");
    assert.equal(viewer.login, "morgan");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry a GitHub review submission", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    if (init?.method === "GET") {
      return Response.json({
        base: { sha: BASE_SHA },
        head: { sha: CURRENT_HEAD },
      });
    }
    return new Response("Bad Gateway", { status: 502 });
  };

  try {
    await assert.rejects(
      submitReviewWithToken("secret-token", {
        baseCommitId: BASE_SHA,
        body: "Looks good",
        commitId: CURRENT_HEAD,
        event: "APPROVE",
        number: 30,
        owner: "acme",
        repository: "console",
      }),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.code === "github_502" &&
        error.message ===
          "GitHub is temporarily unavailable. We retried automatically; try again in a moment.",
    );
    assert.deepEqual(methods, ["GET", "POST"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logs safe diagnostics when a GitHub request finally fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const messages: unknown[] = [];
  console.error = (...args) => messages.push(args[0]);
  globalThis.fetch = async () =>
    new Response("Not Implemented", {
      headers: { "x-github-request-id": "ABC1:2345:6789" },
      status: 501,
    });

  try {
    await assert.rejects(getViewerWithToken("secret-token"));
    const diagnostic = JSON.parse(String(messages[0]));
    assert.deepEqual(diagnostic, {
      attempts: 1,
      endpoint: "/user",
      event: "github_api_request_failed",
      githubRequestId: "ABC1:2345:6789",
      method: "GET",
      status: 501,
    });
    assert.doesNotMatch(String(messages[0]), /secret-token/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("live inbox cards map every displayed PR field from GitHub", async () => {
  const originalFetch = globalThis.fetch;
  const graphqlBodies: Array<{ query?: string }> = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/user")) {
      return Response.json({
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        login: "morgan",
        name: "Morgan",
      });
    }

    graphqlBodies.push(JSON.parse(String(init?.body)));
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
      number: 128,
      repository: { nameWithOwner: "real/design-system" },
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
    });
  };

  try {
    const result = await loadInboxWithToken("secret-token");
    assert.match(graphqlBodies[0]?.query ?? "", /comments\s*\{\s*totalCount/);
    assert.match(
      graphqlBodies[0]?.query ?? "",
      /authored: search\(type: ISSUE, query: \$authoredQuery, first: 20\)/,
    );
    assert.match(graphqlBodies[0]?.query ?? "", /labels\(first: 20\)/);
    assert.doesNotMatch(graphqlBodies[0]?.query ?? "", /statusCheckRollup/);
    assert.doesNotMatch(graphqlBodies[0]?.query ?? "", /reviewRequests/);
    assert.deepEqual(result.pullRequests[0], {
      additions: 58,
      author: {
        avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
        login: "octocat",
        name: "Octo Cat",
      },
      baseRefName: "main",
      changedFiles: 3,
      checkState: "NEUTRAL",
      commentCount: 7,
      createdAt: "2026-07-26T18:00:00.000Z",
      deletions: 14,
      headRefName: "real-card-data",
      headSha: CURRENT_HEAD,
      id: "PR_real",
      isDraft: false,
      labels: ["a11y", "design-system"],
      lastMeaningfulActivityAt: "2026-07-28T18:00:00.000Z",
      mergeState: "UNKNOWN",
      mentionsViewer: false,
      number: 128,
      repository: "real/design-system",
      reviewDecision: null,
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
    assert.equal(result.warnings, undefined);
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

test("degraded permission data drops a card with no repository", async () => {
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
        authored: { nodes: [{ id: "PR_partial", number: 9 }] },
        reviewRequested: { nodes: [] },
        reviewed: { nodes: [] },
      },
      errors: [
        {
          message: "Resource not accessible by integration",
          path: ["authored", "nodes", 0, "repository"],
        },
      ],
    });
  };

  try {
    const result = await loadInboxWithToken("secret-token");
    // The node survives GraphQL partial data but has no repository, so it can
    // never load a diff. It is skipped; the permissions warning still lands.
    assert.equal(result.pullRequests.length, 0);
    assert.equal(result.warnings?.length, 1);
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

test("a rejected review explains why instead of saying Unprocessable Entity", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/pulls/30")) {
      return Response.json({
        base: { sha: BASE_SHA },
        head: { sha: CURRENT_HEAD },
      });
    }
    // GitHub answers a self-approval with a bare top-level message; the
    // actionable reason only appears in `errors`.
    return Response.json(
      {
        documentation_url: "https://docs.github.com/rest/pulls/reviews",
        errors: [
          {
            code: "custom",
            field: "user_id",
            message: "Can not approve your own pull request",
            resource: "PullRequestReview",
          },
        ],
        message: "Unprocessable Entity",
      },
      { status: 422 },
    );
  };

  try {
    await assert.rejects(
      submitReviewWithToken("secret-token", {
        baseCommitId: BASE_SHA,
        body: "LGTM",
        commitId: CURRENT_HEAD,
        event: "APPROVE",
        number: 30,
        owner: "hypothetical-money-machine",
        repository: "hypecreds",
      }),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.status === 422 &&
        error.message ===
          "Unprocessable Entity: Can not approve your own pull request",
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

test("rejects a missing repository segment instead of requesting /undefined", async () => {
  const originalFetch = globalThis.fetch;
  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    return Response.json({});
  };

  try {
    await assert.rejects(
      loadPullDiffWithToken("token", {
        number: 7,
        owner: "acme",
        repository: undefined,
      } as never),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.code === "invalid_pull_request" &&
        error.status === 400,
    );
    await assert.rejects(
      submitReviewWithToken("secret-token", {
        baseCommitId: BASE_SHA,
        body: "Looks good.",
        commitId: CURRENT_HEAD,
        event: "APPROVE",
        number: 7,
        owner: "acme",
        repository: undefined,
      } as never),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.code === "invalid_pull_request" &&
        error.status === 400,
    );
    assert.equal(requested, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("classifies FORBIDDEN-typed GraphQL errors as a permission denial", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/user")) {
      return Response.json({
        avatar_url: null,
        login: "morgan",
        name: "Morgan",
      });
    }
    // The message wording differs from the well-known string; the
    // machine-readable type alone must classify this as a 403.
    return Response.json({
      data: null,
      errors: [
        { message: "Your token has not been granted access.", type: "FORBIDDEN" },
      ],
    });
  };

  try {
    for (const load of [
      () => loadInboxWithToken("secret-token"),
      () => loadInboxPageWithToken("secret-token", { perBucket: 25 }),
    ]) {
      await assert.rejects(
        load(),
        (error: unknown) =>
          error instanceof GitHubApiError &&
          error.code === "github_403" &&
          error.status === 403 &&
          error.message.includes("installation does not have access"),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a non-JSON GraphQL 200 response surfaces as a GitHub error, not a crash", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/user")) {
      return Response.json({
        avatar_url: null,
        login: "morgan",
        name: "Morgan",
      });
    }
    return new Response("<html>Bad Gateway</html>", { status: 200 });
  };

  try {
    for (const load of [
      () => loadInboxWithToken("secret-token"),
      () => loadInboxPageWithToken("secret-token", { perBucket: 25 }),
    ]) {
      await assert.rejects(
        load(),
        (error: unknown) =>
          error instanceof GitHubApiError &&
          error.code === "graphql_error" &&
          error.status === 502,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an empty GraphQL payload rejects instead of rendering an empty inbox", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/user")) {
      return Response.json({
        avatar_url: null,
        login: "morgan",
        name: "Morgan",
      });
    }
    return Response.json({});
  };

  try {
    for (const load of [
      () => loadInboxWithToken("secret-token"),
      () => loadInboxPageWithToken("secret-token", { perBucket: 25 }),
    ]) {
      await assert.rejects(
        load(),
        (error: unknown) =>
          error instanceof GitHubApiError &&
          error.code === "graphql_error" &&
          error.status === 502 &&
          error.message === "GitHub returned an empty GraphQL response.",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a review accepted with an unparseable body still reports success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "GET") {
      return Response.json({
        base: { sha: BASE_SHA },
        head: { sha: CURRENT_HEAD },
      });
    }
    return new Response("", { status: 200 });
  };

  try {
    const result = await submitReviewWithToken("secret-token", {
      baseCommitId: BASE_SHA,
      body: "Looks good.",
      commitId: CURRENT_HEAD,
      event: "APPROVE",
      number: 42,
      owner: "acme",
      repository: "console",
    });
    assert.ok(Number.isFinite(Date.parse(result.submittedAt)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects dot-segment repository coordinates before making a request", async () => {
  const originalFetch = globalThis.fetch;
  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    return Response.json({});
  };

  try {
    for (const segment of [".", ".."]) {
      await assert.rejects(
        loadPullDiffWithToken("token", {
          number: 7,
          owner: segment,
          repository: "console",
        }),
        (error: unknown) =>
          error instanceof GitHubApiError &&
          error.code === "invalid_pull_request" &&
          error.status === 400,
      );
      await assert.rejects(
        loadPullDiffWithToken("token", {
          number: 7,
          owner: "acme",
          repository: segment,
        }),
        (error: unknown) =>
          error instanceof GitHubApiError &&
          error.code === "invalid_pull_request" &&
          error.status === 400,
      );
    }
    assert.equal(requested, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("marks the diff truncated when the changed-file listing hits its page cap", async () => {
  const originalFetch = globalThis.fetch;
  let filePages = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const accept = new Headers(init?.headers).get("Accept");
    if (url.includes("/files?")) {
      filePages += 1;
      return Response.json(
        Array.from({ length: 100 }, (_unused, index) => ({
          additions: 1,
          changes: 1,
          deletions: 0,
          filename: `src/generated/file-${filePages}-${index}.ts`,
          patch: "@@ -0,0 +1 @@\n+new",
          status: "added",
        })),
      );
    }
    if (accept === "application/vnd.github.diff") {
      return new Response("diff --git a/a b/a\n");
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
    assert.equal(filePages, 30);
    assert.equal(result.files.length, 3000);
    assert.equal(result.truncated, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("paginated inbox page passes per-bucket after cursors and perBucket", async () => {
  const originalFetch = globalThis.fetch;
  const graphqlBodies: Array<{
    query?: string;
    variables?: Record<string, unknown>;
  }> = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/user")) {
      return Response.json({
        avatar_url: null,
        login: "morgan",
        name: "Morgan",
      });
    }
    graphqlBodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      data: {
        assigned: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        authored: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        rateLimit: { cost: 1, remaining: 4999, resetAt: "2026-07-01T01:00:00.000Z" },
        reviewRequested: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
        reviewed: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    });
  };

  try {
    await loadInboxPageWithToken("secret-token", {
      perBucket: 25,
      cursors: {
        authored: "cursor_a",
        reviewRequested: "cursor_r",
      },
    });
    const variables = graphqlBodies[0]?.variables;
    const query = graphqlBodies[0]?.query ?? "";
    assert.match(query, /fragment PullRequestInboxItemDetail on PullRequest/);
    assert.match(query, /\.\.\.PullRequestInboxItemDetail/);
    assert.doesNotMatch(query, /\.\.\.PullRequestInboxItem(?!Detail)/);
    assert.equal(variables?.perBucket, 25);
    assert.equal(variables?.authoredAfter, "cursor_a");
    assert.equal(variables?.reviewAfter, "cursor_r");
    assert.equal(variables?.assignedAfter, null);
    assert.equal(variables?.reviewedAfter, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("paginated inbox page returns raw bucket nodes and pageInfo", async () => {
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
        assigned: {
          nodes: [
            {
              id: "PR_assigned",
              repository: { nameWithOwner: "acme/console" },
              number: 1,
              title: "Assigned",
              url: "https://github.com/acme/console/pull/1",
              baseRefName: "main",
              headRefName: "feature",
              headRefOid: "a".repeat(40),
              isDraft: false,
              additions: 1,
              deletions: 1,
              changedFiles: 1,
              comments: { totalCount: 0 },
              labels: { nodes: [] },
              commits: {
                nodes: [
                  { commit: { oid: "a".repeat(40), statusCheckRollup: null } },
                ],
              },
              latestOpinionatedReviews: { nodes: [] },
              reviewRequests: { nodes: [] },
              reviewDecision: null,
              mergeable: "MERGEABLE",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z",
              author: { login: "octocat", name: "Octo Cat", avatarUrl: null },
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: "next" },
        },
        authored: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        reviewRequested: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
        reviewed: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        rateLimit: { cost: 1, remaining: 4997, resetAt: "2026-07-01T01:00:00.000Z" },
      },
    });
  };

  try {
    const page = await loadInboxPageWithToken("secret-token", { perBucket: 25 });
    const assignedNodes = page.buckets.assigned as Array<{ id: string }>;
    assert.equal(assignedNodes.length, 1);
    assert.equal(assignedNodes[0]?.id, "PR_assigned");
    assert.equal(page.pageInfo.assigned.hasNextPage, true);
    assert.equal(page.pageInfo.assigned.endCursor, "next");
    assert.equal(page.viewer?.login, "morgan");
    assert.equal(page.warnings.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
