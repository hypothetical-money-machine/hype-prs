import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { ComponentType } from "react";
import { JSDOM } from "jsdom";
import { DiffWorkspace } from "../components/diff-workspace";
import { PrWorkspace } from "../components/pr-workspace";
import { createDemoInbox } from "../lib/demo-data";
import { writeInboxCache } from "../lib/inbox-cache";
import type { InboxPage } from "../lib/inbox-page-types";
import type { InboxPayload, PullRequestDiff } from "../lib/types";

const demoInbox = createDemoInbox();

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

const SIMPLE_PATCH =
  "diff --git a/src/index.ts b/src/index.ts\n" +
  "--- a/src/index.ts\n" +
  "+++ b/src/index.ts\n" +
  "@@ -1 +1 @@\n" +
  "-old\n" +
  "+new\n";

function changedFile(filename: string) {
  return {
    additions: 1,
    blobUrl: null,
    changes: 2,
    deletions: 1,
    filename,
    patch: null,
    previousFilename: null,
    rawUrl: null,
    status: "modified" as const,
  };
}

function liveDiff(): PullRequestDiff {
  return {
    baseSha: BASE_SHA,
    files: [changedFile("src/index.ts")],
    headSha: HEAD_SHA,
    patch: SIMPLE_PATCH,
    truncated: false,
  };
}

function statusPayload(login: string) {
  return {
    authKind: "redirect",
    configured: true,
    connected: true,
    expiresAt: null,
    mode: "web",
    viewer: { avatarUrl: null, login, name: login },
  };
}

function buildNode(
  id: string,
  repository: string,
  title: string,
  login: string,
  baseRefOid: string = BASE_SHA,
) {
  return {
    id,
    repository: { nameWithOwner: repository },
    number: Number(id.replace(/[^0-9]/g, "")) || 1,
    title,
    url: `https://github.com/${repository}/pull/${id}`,
    baseRefName: "main",
    baseRefOid,
    headRefName: "feature",
    headRefOid: HEAD_SHA,
    isDraft: false,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    comments: { totalCount: 0 },
    labels: { nodes: [] },
    commits: {
      nodes: [{ commit: { oid: HEAD_SHA, statusCheckRollup: null } }],
    },
    latestOpinionatedReviews: { nodes: [] },
    reviewRequests: { nodes: [] },
    reviewDecision: null,
    mergeable: "MERGEABLE",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    author: { login, name: login, avatarUrl: null },
  };
}

function buildPage(
  viewer: string,
  overrides: {
    authoredIds?: Array<[string, string, string, string]>;
    baseRefOid?: string;
    hasNextPage?: boolean;
  } = {},
): InboxPage {
  const authoredNodes = (overrides.authoredIds ?? []).map(
    ([id, repository, title, login]) =>
      buildNode(id, repository, title, login, overrides.baseRefOid ?? BASE_SHA),
  );
  return {
    buckets: {
      authored: authoredNodes,
      assigned: [],
      reviewRequested: [],
      reviewed: [],
    },
    pageInfo: {
      authored: {
        endCursor: "cursor_a",
        hasNextPage: Boolean(overrides.hasNextPage),
      },
      assigned: { endCursor: null, hasNextPage: false },
      reviewRequested: { endCursor: null, hasNextPage: false },
      reviewed: { endCursor: null, hasNextPage: false },
    },
    rateLimit: { cost: 1, remaining: 4999, resetAt: "2026-07-01T01:00:00.000Z" },
    viewer: { login: viewer, name: viewer },
    warnings: [],
  };
}

function requestUrl(input: unknown): string {
  return typeof input === "string"
    ? input
    : (input as { url: string }).url;
}

test("a failed diff load shows a retryable panel, not a truncated notice", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  const page1 = buildPage("morgan", {
    authoredIds: [["PR_1", "acme/a", "The only PR", "octo"]],
    hasNextPage: false,
  });

  let diffCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/github/status")) {
      return Response.json(statusPayload("morgan"));
    }
    if (url.includes("/api/github/inbox?page=1")) {
      return Response.json(page1);
    }
    if (url.includes("/api/github/diff")) {
      diffCalls += 1;
      if (diffCalls === 1) {
        return Response.json(
          { error: { code: "github_502", message: "GitHub timed out." } },
          { status: 502 },
        );
      }
      return Response.json(liveDiff());
    }
    return Response.json({ error: { message: `Unhandled ${url}` } }, { status: 404 });
  };

  try {
    const { cleanup, fireEvent, render, waitFor, act } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(
        createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
          initialDemoInbox: demoInbox,
          initialNow: Date.parse(demoInbox.syncedAt),
        }),
      );
    });

    // The failed request renders the dedicated load-failed panel with the
    // server's message, not the "binary or truncated" copy.
    await view!.findByText("Could not load this diff");
    await view!.findByText("GitHub timed out.");
    assert.equal(
      /binary, truncated, or larger/.test(document.body.textContent ?? ""),
      false,
      "a network failure must not masquerade as a truncated diff",
    );

    // The Review button explains the failure instead of promising that the
    // comparison will finish loading.
    const reviewButton = view!.getByRole("button", { name: "Review" });
    assert.equal(reviewButton.hasAttribute("disabled"), true);
    assert.match(reviewButton.getAttribute("title") ?? "", /failed to load/);

    // Retry issues a fresh request; when it succeeds the review flow opens.
    fireEvent.click(view!.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      assert.ok(diffCalls >= 2, "retry should refetch the diff");
      assert.equal(
        view!.getByRole("button", { name: "Review" }).hasAttribute("disabled"),
        false,
        "a successfully retried diff should unlock the review button",
      );
    });
    assert.equal(
      /Could not load this diff/.test(document.body.textContent ?? ""),
      false,
    );
  } finally {
    try {
      cleanupDom?.();
    } finally {
      globalThis.fetch = originalFetch;
      dom.window.close();
      uninstallDom();
    }
  }
});

test("a refresh that changes no head revision does not refetch the diff", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  const page1 = buildPage("morgan", {
    authoredIds: [["PR_1", "acme/a", "The only PR", "octo"]],
    hasNextPage: false,
  });

  let diffCalls = 0;
  let page1Calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/github/status")) {
      return Response.json(statusPayload("morgan"));
    }
    if (url.includes("/api/github/inbox?page=1")) {
      page1Calls += 1;
      return Response.json(page1);
    }
    if (url.includes("/api/github/diff")) {
      diffCalls += 1;
      return Response.json(liveDiff());
    }
    return Response.json({ error: { message: `Unhandled ${url}` } }, { status: 404 });
  };

  try {
    const { cleanup, fireEvent, render, waitFor, act } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(
        createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
          initialDemoInbox: demoInbox,
          initialNow: Date.parse(demoInbox.syncedAt),
        }),
      );
    });

    // Initial load: inbox plus exactly one diff fetch.
    await waitFor(() => {
      assert.equal(page1Calls, 1);
      assert.equal(
        view!.getByRole("button", { name: "Review" }).hasAttribute("disabled"),
        false,
        "the initial diff should finish loading",
      );
    });
    assert.equal(diffCalls, 1);

    // A manual refresh mints a fresh syncedAt but no SHA changes, so the
    // already-loaded diff must survive without an abort-and-refetch cycle.
    fireEvent.click(
      view!.getByRole("button", { name: "Refresh pull requests" }),
    );
    await waitFor(() => {
      assert.equal(page1Calls, 2, "refresh should refetch the inbox");
      assert.match(
        document.querySelector(".queue-status-line")?.textContent ?? "",
        /Last synced/,
        "the refresh should complete",
      );
    });
    assert.equal(
      diffCalls,
      1,
      "an unchanged head revision must not trigger a diff refetch",
    );
    assert.equal(
      view!.getByRole("button", { name: "Review" }).hasAttribute("disabled"),
      false,
      "the diff pane must not blank out across the refresh",
    );
  } finally {
    try {
      cleanupDom?.();
    } finally {
      globalThis.fetch = originalFetch;
      dom.window.close();
      uninstallDom();
    }
  }
});

test("a refresh that moves the base revision refetches the diff", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  const MOVED_BASE_SHA = "c".repeat(40);
  const page1 = buildPage("morgan", {
    authoredIds: [["PR_1", "acme/a", "The only PR", "octo"]],
    hasNextPage: false,
  });
  // The teammate's merge advanced the base branch: same PR, same head, new
  // base revision.
  const page1AfterBaseMove = buildPage("morgan", {
    authoredIds: [["PR_1", "acme/a", "The only PR", "octo"]],
    baseRefOid: MOVED_BASE_SHA,
    hasNextPage: false,
  });

  let diffCalls = 0;
  let page1Calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/github/status")) {
      return Response.json(statusPayload("morgan"));
    }
    if (url.includes("/api/github/inbox?page=1")) {
      page1Calls += 1;
      return Response.json(page1Calls === 1 ? page1 : page1AfterBaseMove);
    }
    if (url.includes("/api/github/diff")) {
      diffCalls += 1;
      return Response.json(
        diffCalls === 1
          ? liveDiff()
          : { ...liveDiff(), baseSha: MOVED_BASE_SHA },
      );
    }
    return Response.json({ error: { message: `Unhandled ${url}` } }, { status: 404 });
  };

  try {
    const { cleanup, fireEvent, render, waitFor, act } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(
        createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
          initialDemoInbox: demoInbox,
          initialNow: Date.parse(demoInbox.syncedAt),
        }),
      );
    });

    await waitFor(() => {
      assert.equal(page1Calls, 1);
      assert.equal(
        view!.getByRole("button", { name: "Review" }).hasAttribute("disabled"),
        false,
        "the initial diff should finish loading",
      );
    });
    assert.equal(diffCalls, 1);

    // The base branch advanced on GitHub; submitting now would 409 with
    // "Refresh before submitting the review". Refreshing must actually
    // refetch the comparison — this is the escape hatch that used to hang
    // off syncedAt.
    fireEvent.click(
      view!.getByRole("button", { name: "Refresh pull requests" }),
    );
    await waitFor(() => {
      assert.equal(page1Calls, 2, "refresh should refetch the inbox");
      assert.equal(
        diffCalls,
        2,
        "a moved base revision must trigger a diff refetch",
      );
    });
    await waitFor(() => {
      assert.equal(
        view!.getByRole("button", { name: "Review" }).hasAttribute("disabled"),
        false,
        "the refetched comparison should unlock the review button again",
      );
    });
  } finally {
    try {
      cleanupDom?.();
    } finally {
      globalThis.fetch = originalFetch;
      dom.window.close();
      uninstallDom();
    }
  }
});

test("a lost session routes back to the login screen instead of an error banner", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/github/status")) {
      return Response.json(statusPayload("morgan"));
    }
    if (url.includes("/api/github/inbox")) {
      // The session died between the status check and the inbox load.
      return Response.json(
        { error: { code: "not_connected", message: "GitHub is not connected." } },
        { status: 401 },
      );
    }
    if (url.includes("/api/github/diff")) {
      return Response.json(liveDiff());
    }
    return Response.json({ error: { message: `Unhandled ${url}` } }, { status: 404 });
  };

  try {
    writeInboxCache(
      dom.window.localStorage,
      cachedInboxFor("morgan", "PR_cached", "Cached pull request"),
    );

    const { cleanup, render, waitFor, act } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    await act(async () => {
      render(
        createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
          initialDemoInbox: demoInbox,
          initialNow: Date.parse(demoInbox.syncedAt),
        }),
      );
    });

    // Instead of the hydrated (now dead) workspace with a banner, the login
    // screen takes over and explains what happened.
    await waitFor(() => {
      assert.match(
        document.body.textContent ?? "",
        /Your GitHub session ended/,
        "the login screen should explain the lost session",
      );
      assert.match(
        document.body.textContent ?? "",
        /Continue with GitHub/,
        "the login screen should offer to reconnect",
      );
    });
    assert.equal(
      document.querySelector(".pr-list"),
      null,
      "the stale workspace must not stay on screen",
    );
  } finally {
    try {
      cleanupDom?.();
    } finally {
      globalThis.fetch = originalFetch;
      dom.window.close();
      uninstallDom();
    }
  }
});

test("a page-2 selection keeps rendering while the second page loads", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  const page1 = buildPage("morgan", {
    authoredIds: [["PR_1", "acme/a", "Page 1 PR", "octo"]],
    hasNextPage: true,
  });
  const page2 = buildPage("morgan", {
    authoredIds: [["PR_2", "acme/b", "Page 2 PR", "octo"]],
    hasNextPage: false,
  });

  // Page 1 is gated so the cached hydration render commits first (mirroring
  // a real network); page 2 is gated so the test can observe the window
  // between the partial page-1 render and the final merge.
  let releasePage1: () => void = () => {};
  const page1Gate = new Promise<void>((resolve) => {
    releasePage1 = resolve;
  });
  let releasePage2: () => void = () => {};
  const page2Gate = new Promise<void>((resolve) => {
    releasePage2 = resolve;
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/github/status")) {
      return Response.json(statusPayload("morgan"));
    }
    if (url.includes("/api/github/inbox?page=1")) {
      await page1Gate;
      return Response.json(page1);
    }
    if (url.includes("/api/github/inbox?page=2")) {
      await page2Gate;
      return Response.json(page2);
    }
    if (url.includes("/api/github/diff")) {
      return Response.json(liveDiff());
    }
    return Response.json({ error: { message: `Unhandled ${url}` } }, { status: 404 });
  };

  try {
    // The user was reading the page-2 PR before this refresh started; the
    // cache restores it as the selection on launch.
    writeInboxCache(
      dom.window.localStorage,
      cachedInboxFor("morgan", "PR_2", "Page 2 PR"),
    );

    const { cleanup, render, waitFor, act } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(
        createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
          initialDemoInbox: demoInbox,
          initialNow: Date.parse(demoInbox.syncedAt),
        }),
      );
    });

    // The cached selection renders first, before any live page lands.
    await waitFor(() => {
      assert.match(
        document.querySelector(".pr-list")?.textContent ?? "",
        /Page 2 PR/,
      );
    });

    // Page 1 lands (its PR is in the queue) while page 2 is still pending.
    releasePage1();
    await waitFor(() => {
      assert.match(
        document.querySelector(".pr-list")?.textContent ?? "",
        /Page 1 PR/,
      );
    });

    // The detail pane must keep showing the selected page-2 PR through the
    // window rather than flashing the first page-1 row.
    const detailHeading = view!.getByRole("heading", { level: 2 });
    assert.equal(detailHeading.textContent, "Page 2 PR");

    releasePage2();
    await waitFor(() => {
      const row = view!.getByRole("option", { name: /Page 2 PR/ });
      assert.equal(row.getAttribute("aria-selected"), "true");
    });
    assert.equal(
      view!.getByRole("heading", { level: 2 }).textContent,
      "Page 2 PR",
    );
  } finally {
    try {
      cleanupDom?.();
    } finally {
      globalThis.fetch = originalFetch;
      dom.window.close();
      uninstallDom();
    }
  }
});

test("one patch-less file no longer blanks the rest of the diff", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  // The patch covers src/index.ts only; the binary file has no hunk.
  const diff: PullRequestDiff = {
    baseSha: BASE_SHA,
    files: [changedFile("src/index.ts"), changedFile("assets/logo.png")],
    headSha: HEAD_SHA,
    patch: SIMPLE_PATCH,
    truncated: false,
  };

  try {
    const { cleanup, fireEvent, render } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    const view = render(
      createElement(DiffWorkspace, {
        diff,
        fileBrowserCollapsed: false,
        layout: "unified",
        loading: false,
        onLayoutChange() {},
        onOpenInGitHub() {},
        themePreference: "light",
      }),
    );

    fireEvent.click(await view.findByTitle("assets/logo.png"));

    // A per-file notice appears while the rendered diff stays mounted.
    const notice = document.querySelector(".diff-file-notice");
    assert.ok(notice, "the unavailable file should raise an inline notice");
    assert.match(
      notice.textContent ?? "",
      /assets\/logo\.png/,
      "the notice should name the unavailable file",
    );
    assert.equal(
      document.querySelector(".diff-fallback"),
      null,
      "the whole-canvas fallback must not replace the rendered diff",
    );

    // Dismissing the notice clears the dead-end selection.
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
    assert.equal(document.querySelector(".diff-file-notice"), null);
  } finally {
    try {
      cleanupDom?.();
    } finally {
      dom.window.close();
      uninstallDom();
    }
  }
});

function cachedInboxFor(
  viewer: string,
  id: string,
  title: string,
): InboxPayload {
  return {
    pullRequests: [
      {
        additions: 11,
        author: { avatarUrl: null, login: "octo", name: "Octo" },
        baseRefName: "main",
        baseSha: BASE_SHA,
        changedFiles: 1,
        checkState: "SUCCESS",
        commentCount: 0,
        createdAt: "2026-07-01T00:00:00.000Z",
        deletions: 4,
        headRefName: "feature",
        headSha: HEAD_SHA,
        id,
        isDraft: false,
        labels: [],
        lastMeaningfulActivityAt: "2026-07-01T00:00:00.000Z",
        mergeState: "MERGEABLE",
        mentionsViewer: false,
        number: 1,
        repository: "acme/cached",
        reviewDecision: "REVIEW_REQUIRED",
        reviewRequestedAt: "2026-07-01T00:00:00.000Z",
        teamReviewRequested: false,
        title,
        updatedAt: "2026-07-01T00:00:00.000Z",
        url: `https://github.com/acme/cached/pull/1`,
        viewerLastReviewCommitSha: null,
        viewerLastReviewAt: null,
        viewerRelationship: "REVIEW_REQUESTED",
        viewerReviewState: null,
      },
    ],
    rateLimit: { cost: 1, remaining: 4999, resetAt: "2026-07-01T01:00:00.000Z" },
    syncedAt: "2026-07-01T00:00:00.000Z",
    viewer: { login: viewer, name: viewer },
  };
}

type WorkspaceProps = NonNullable<Parameters<typeof PrWorkspace>[0]>;

let originalGlobals: Map<PropertyKey, PropertyDescriptor | undefined>;

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  dom.window.requestAnimationFrame = (callback) =>
    dom.window.setTimeout(() => callback(dom.window.performance.now()), 0);
  dom.window.cancelAnimationFrame = (handle) =>
    dom.window.clearTimeout(handle);
  dom.window.localStorage.clear();
  originalGlobals = new Map();

  const globals = {
    document: dom.window.document,
    CSSStyleSheet: dom.window.CSSStyleSheet,
    customElements: dom.window.customElements,
    Element: dom.window.Element,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    SVGElement: dom.window.SVGElement,
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    window: dom.window,
  };

  for (const [key, value] of Object.entries(globals)) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  originalGlobals.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  );
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  });

  originalGlobals.set(
    "ResizeObserver",
    Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver"),
  );
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
    writable: true,
  });

  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  }

  return dom;
}

function uninstallDom() {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
