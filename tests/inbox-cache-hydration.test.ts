import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { ComponentType } from "react";
import { JSDOM } from "jsdom";
import { PrWorkspace } from "../components/pr-workspace";
import { createDemoInbox } from "../lib/demo-data";
import {
  INBOX_CACHE_STORAGE_KEY,
  writeInboxCache,
} from "../lib/inbox-cache";
import type { InboxPage } from "../lib/inbox-page-types";
import type { InboxPayload } from "../lib/types";

const demoInbox = createDemoInbox();

function buildCachedInbox(viewer: string): InboxPayload {
  return {
    pullRequests: [
      {
        additions: 11,
        author: { avatarUrl: null, login: "ada", name: "Ada" },
        baseRefName: "main",
        changedFiles: 1,
        checkState: "SUCCESS",
        commentCount: 0,
        createdAt: "2026-07-01T00:00:00.000Z",
        deletions: 4,
        headRefName: "cached-card",
        headSha: "f".repeat(40),
        id: "PR_cached",
        isDraft: false,
        labels: ["cache"],
        lastMeaningfulActivityAt: "2026-07-01T00:00:00.000Z",
        mergeState: "MERGEABLE",
        mentionsViewer: false,
        number: 1,
        repository: "acme/cached",
        reviewDecision: "REVIEW_REQUIRED",
        reviewRequestedAt: "2026-07-01T00:00:00.000Z",
        teamReviewRequested: false,
        title: "Cached pull request",
        updatedAt: "2026-07-01T00:00:00.000Z",
        url: "https://github.com/acme/cached/pull/1",
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

function buildNode(id: string, repository: string, title: string, login: string) {
  return {
    id,
    repository: { nameWithOwner: repository },
    number: Number(id.replace(/[^0-9]/g, "")) || 1,
    title,
    url: `https://github.com/${repository}/pull/${id}`,
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
      nodes: [{ commit: { oid: "a".repeat(40), statusCheckRollup: null } }],
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

function buildPage(viewer: string, overrides: {
  authoredIds?: Array<[string, string, string, string]>;
  hasNextPage?: boolean;
} = {}): InboxPage {
  const authoredNodes = (overrides.authoredIds ?? []).map(
    ([id, repository, title, login]) =>
      buildNode(id, repository, title, login),
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

test("the queue renders the cached inbox immediately and then refreshes", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  const page1 = buildPage("morgan", {
    authoredIds: [["PR_page1", "acme/page1", "From page 1", "octo"]],
    hasNextPage: false,
  });
  const page2 = buildPage("morgan", {
    authoredIds: [["PR_page2", "acme/page2", "From page 2", "octo"]],
    hasNextPage: false,
  });

  // Gate the page-1 fetch on a microtask so the cached render lands first.
  let resolvePage1: () => void = () => {};
  const page1Gate = new Promise<void>((resolve) => {
    resolvePage1 = resolve;
  });

  let fetchedPages = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : (input as unknown as { url: string }).url;
    if (url.endsWith("/api/github/status")) {
      return Response.json({
        authKind: "redirect",
        configured: true,
        connected: true,
        expiresAt: null,
        mode: "web",
        viewer: { avatarUrl: null, login: "morgan", name: "Morgan" },
      });
    }
    if (url.includes("/api/github/inbox?page=1")) {
      fetchedPages += 1;
      await page1Gate;
      return Response.json(page1);
    }
    if (url.includes("/api/github/inbox?page=2")) {
      return Response.json(page2);
    }
    if (url.includes("/api/github/diff")) {
      return Response.json({
        baseSha: "0".repeat(40),
        files: [],
        headSha: "a".repeat(40),
        patch: "",
        truncated: true,
      });
    }
    return Response.json({ error: { message: `Unhandled ${url}` } }, { status: 404 });
  };

  try {
    writeInboxCache(dom.window.localStorage, buildCachedInbox("morgan"));

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

    // The cached PR must be visible before any network call resolves. The
    // launch effect kicks off the live refresh asynchronously; the page-1
    // mock is gated so the cache row has time to render.
    const cachedRow = await view!.findByRole("option", {
      name: /Cached pull request/,
    });
    assert.ok(cachedRow, "cached row should be visible immediately");

    // Let the page-1 fetch resolve.
    resolvePage1();

    // The live page-1 fetch replaces the cached row when it lands.
    await waitFor(() => {
      assert.ok(fetchedPages > 0, "page 1 fetch should have run");
      const updated = document.querySelector(".pr-list");
      assert.match(
        updated?.textContent ?? "",
        /From page 1/,
        "page 1 result should replace the cached row",
      );
    });

    // The cache now holds the merged live payload, not the pre-launch one.
    const cachedAfter = dom.window.localStorage.getItem(INBOX_CACHE_STORAGE_KEY);
    assert.ok(cachedAfter, "cache should be re-written after a live refresh");
    assert.match(cachedAfter, /From page 1/);
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

test("a cached inbox from a different viewer is ignored on the next launch", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  const page1 = buildPage("ada", {
    authoredIds: [["PR_live", "acme/live", "Live fetch for Ada", "ada"]],
    hasNextPage: false,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : (input as unknown as { url: string }).url;
    if (url.endsWith("/api/github/status")) {
      return Response.json({
        authKind: "redirect",
        configured: true,
        connected: true,
        expiresAt: null,
        mode: "web",
        viewer: { avatarUrl: null, login: "ada", name: "Ada" },
      });
    }
    if (url.includes("/api/github/inbox?page=1")) {
      return Response.json(page1);
    }
    if (url.includes("/api/github/inbox?page=2")) {
      return Response.json(page1);
    }
    if (url.includes("/api/github/diff")) {
      return Response.json({
        baseSha: "0".repeat(40),
        files: [],
        headSha: "a".repeat(40),
        patch: "",
        truncated: true,
      });
    }
    return Response.json({ error: { message: `Unhandled ${url}` } }, { status: 404 });
  };

  try {
    writeInboxCache(dom.window.localStorage, buildCachedInbox("morgan"));

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

    // The live row lands once the page-1 fetch resolves. The cached row from
    // a different viewer must never show up in the merged list.
    await waitFor(() => {
      const list = document.querySelector(".pr-list");
      const matches = list?.textContent?.match(/Live fetch for Ada/);
      assert.ok(
        matches,
        "the live inbox row for the connected viewer should appear",
      );
    });

    const stray = document.querySelector(".pr-list")?.textContent ?? "";
    assert.equal(
      /Cached pull request/.test(stray),
      false,
      "the cached row from another viewer must not appear at all",
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

test("auto-refresh preserves the user's selected pull request when it lives in page 2", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  // Page 1 contains a different PR. Page 2 contains the one the user
  // selected before the auto-refresh fired. The user's selection must not
  // be reset to the page-1 PR.
  const page1 = buildPage("morgan", {
    authoredIds: [["PR_1", "acme/a", "Page 1 PR", "octo"]],
    hasNextPage: true,
  });
  const page2 = buildPage("morgan", {
    authoredIds: [["PR_2", "acme/b", "Page 2 PR", "octo"]],
    hasNextPage: false,
  });

  const fetchedPages: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : (input as unknown as { url: string }).url;
    if (url.endsWith("/api/github/status")) {
      return Response.json({
        authKind: "redirect",
        configured: true,
        connected: true,
        expiresAt: null,
        mode: "web",
        viewer: { avatarUrl: null, login: "morgan", name: "Morgan" },
      });
    }
    if (url.includes("/api/github/inbox?page=1")) {
      fetchedPages.push(1);
      return Response.json(page1);
    }
    if (url.includes("/api/github/inbox?page=2")) {
      fetchedPages.push(2);
      return Response.json(page2);
    }
    if (url.includes("/api/github/diff")) {
      return Response.json({
        baseSha: "0".repeat(40),
        files: [],
        headSha: "a".repeat(40),
        patch: "",
        truncated: true,
      });
    }
    return Response.json({ error: { message: `Unhandled ${url}` } }, { status: 404 });
  };

  try {
    // Seed a cache with the page-2 PR already selected. The bootstrap path
    // should restore that selection, the page-1 render should leave it
    // alone, and the page-2 merge should keep the user's existing selection
    // (auto-refresh policy) rather than reset to the page-1 PR.
    const cached = buildCachedInbox("morgan");
    cached.pullRequests = [
      {
        ...cached.pullRequests[0],
        id: "PR_2",
        title: "Page 2 PR",
        repository: "acme/b",
        headSha: "a".repeat(40),
      },
      {
        additions: 1,
        author: { avatarUrl: null, login: "octo", name: "Octo" },
        baseRefName: "main",
        changedFiles: 1,
        checkState: "NEUTRAL",
        commentCount: 0,
        createdAt: "2026-07-01T00:00:00.000Z",
        deletions: 1,
        headRefName: "feature",
        headSha: "a".repeat(40),
        id: "PR_1",
        isDraft: false,
        labels: [],
        lastMeaningfulActivityAt: "2026-07-01T00:00:00.000Z",
        mergeState: "MERGEABLE",
        mentionsViewer: false,
        number: 1,
        repository: "acme/a",
        reviewDecision: null,
        reviewRequestedAt: null,
        teamReviewRequested: false,
        title: "Page 1 PR",
        updatedAt: "2026-07-01T00:00:00.000Z",
        url: "https://github.com/acme/a/pull/1",
        viewerLastReviewCommitSha: null,
        viewerLastReviewAt: null,
        viewerRelationship: "AUTHOR",
        viewerReviewState: null,
      },
    ];
    writeInboxCache(dom.window.localStorage, cached);

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

    // Wait for the full merge to land (page 1 + page 2 both fetched).
    await waitFor(() => {
      assert.deepEqual(fetchedPages, [1, 2]);
    });

    // The user was looking at PR_2 (the page-2 PR). After auto-refresh the
    // row must still be selected — the page-1 PR must not have stolen the
    // focus.
    const pr2Row = await view!.findByRole("option", { name: /Page 2 PR/ });
    assert.equal(pr2Row.getAttribute("aria-selected"), "true");
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
