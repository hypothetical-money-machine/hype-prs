import assert from "node:assert/strict";
import test from "node:test";
import {
  GitHubApiError,
  loadPullDiffWithToken,
  refreshUserToken,
  submitReviewWithToken,
} from "../shared/github-api.mjs";

const OLD_HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);
const CURRENT_HEAD = "c".repeat(40);
const BASE_SHA = "d".repeat(40);
const NEW_BASE_SHA = "e".repeat(40);

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

test("web refresh sends the client secret while device refresh omits it", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(String(init?.body));
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
    await refreshUserToken({
      clientId: "client",
      refreshToken: "refresh",
    });
    assert.match(requestBodies[0] ?? "", /client_secret=secret/);
    assert.doesNotMatch(requestBodies[1] ?? "", /client_secret=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
