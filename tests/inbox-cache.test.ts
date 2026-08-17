import assert from "node:assert/strict";
import test from "node:test";
import {
  clearInboxCache,
  parseRefreshIntervalId,
  readInboxCache,
  readRefreshIntervalId,
  REFRESH_INTERVAL_OPTIONS,
  refreshIntervalMilliseconds,
  writeInboxCache,
  writeRefreshIntervalId,
} from "../lib/inbox-cache";
import type { InboxPayload, PullRequestSummary } from "../lib/types";

function buildPullRequest(
  id: string,
  overrides: Partial<PullRequestSummary> = {},
): PullRequestSummary {
  return {
    additions: 0,
    author: { login: "morgan", name: "Morgan" },
    baseRefName: "main",
    changedFiles: 0,
    checkState: "NEUTRAL",
    commentCount: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    deletions: 0,
    headRefName: "feature",
    headSha: "a".repeat(40),
    id,
    isDraft: false,
    labels: [],
    lastMeaningfulActivityAt: "2026-07-01T00:00:00.000Z",
    mergeState: "UNKNOWN",
    mentionsViewer: false,
    number: Number(id.replace(/[^0-9]/g, "")) || 1,
    repository: "acme/console",
    reviewDecision: null,
    reviewRequestedAt: null,
    teamReviewRequested: false,
    title: `PR ${id}`,
    updatedAt: "2026-07-01T00:00:00.000Z",
    url: `https://github.com/acme/console/pull/${id}`,
    viewerLastReviewCommitSha: null,
    viewerLastReviewAt: null,
    viewerRelationship: "PARTICIPATING",
    viewerReviewState: null,
    ...overrides,
  };
}

function buildInbox(overrides: Partial<InboxPayload> = {}): InboxPayload {
  return {
    pullRequests: [buildPullRequest("PR_1")],
    rateLimit: {
      cost: 1,
      remaining: 4999,
      resetAt: "2026-07-01T01:00:00.000Z",
    },
    syncedAt: "2026-07-01T00:00:00.000Z",
    viewer: { login: "morgan", name: "Morgan" },
    ...overrides,
  };
}

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

test("writeInboxCache then readInboxCache returns the original payload", () => {
  const storage = new MemoryStorage();
  const inbox = buildInbox();
  writeInboxCache(storage, inbox);
  const read = readInboxCache(storage);
  assert.deepEqual(read, inbox);
});

test("readInboxCache returns null when storage is unavailable", () => {
  assert.equal(readInboxCache(null), null);
  assert.equal(readInboxCache(undefined), null);
});

test("readInboxCache ignores corrupt and non-payload entries", () => {
  const storage = new MemoryStorage();
  storage.setItem("hype-prs-inbox-cache-v1", "{not json");
  assert.equal(readInboxCache(storage), null);

  storage.setItem("hype-prs-inbox-cache-v1", JSON.stringify({ unrelated: true }));
  assert.equal(readInboxCache(storage), null);

  storage.setItem(
    "hype-prs-inbox-cache-v1",
    JSON.stringify({ pullRequests: "not-an-array", syncedAt: 1, viewer: {} }),
  );
  assert.equal(readInboxCache(storage), null);
});

test("readInboxCache swallows storage access errors", () => {
  const brokenStorage = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
    removeItem() {
      throw new Error("storage disabled");
    },
    clear() {
      throw new Error("storage disabled");
    },
    key() {
      return null;
    },
    get length() {
      return 0;
    },
  } as unknown as Storage;
  assert.equal(readInboxCache(brokenStorage), null);
  writeInboxCache(brokenStorage, buildInbox());
  clearInboxCache(brokenStorage);
});

test("clearInboxCache removes the cached payload", () => {
  const storage = new MemoryStorage();
  writeInboxCache(storage, buildInbox());
  clearInboxCache(storage);
  assert.equal(readInboxCache(storage), null);
});

test("writeInboxCache ignores storage errors so the in-memory render still works", () => {
  const brokenStorage = {
    setItem() {
      throw new Error("quota exceeded");
    },
    getItem() {
      return null;
    },
    removeItem() {
      // no-op
    },
    clear() {
      // no-op
    },
    key() {
      return null;
    },
    get length() {
      return 0;
    },
  } as unknown as Storage;
  writeInboxCache(brokenStorage, buildInbox());
  assert.equal(readInboxCache(brokenStorage), null);
});

test("parseRefreshIntervalId accepts every supported id and falls back otherwise", () => {
  for (const option of REFRESH_INTERVAL_OPTIONS) {
    assert.equal(parseRefreshIntervalId(option.id), option.id);
  }
  assert.equal(parseRefreshIntervalId("nonsense"), "off");
  assert.equal(parseRefreshIntervalId(null), "off");
  assert.equal(parseRefreshIntervalId(undefined), "off");
});

test("refreshIntervalMilliseconds maps each id to its cadence", () => {
  assert.equal(refreshIntervalMilliseconds("off"), null);
  assert.equal(refreshIntervalMilliseconds("1m"), 60 * 1000);
  assert.equal(refreshIntervalMilliseconds("2m"), 2 * 60 * 1000);
  assert.equal(refreshIntervalMilliseconds("5m"), 5 * 60 * 1000);
  assert.equal(refreshIntervalMilliseconds("15m"), 15 * 60 * 1000);
  assert.equal(refreshIntervalMilliseconds("30m"), 30 * 60 * 1000);
});

test("readRefreshIntervalId and writeRefreshIntervalId round-trip through storage", () => {
  const storage = new MemoryStorage();
  assert.equal(readRefreshIntervalId(storage), "off");
  writeRefreshIntervalId(storage, "5m");
  assert.equal(readRefreshIntervalId(storage), "5m");
  writeRefreshIntervalId(storage, "off");
  assert.equal(readRefreshIntervalId(storage), "off");
});

test("readRefreshIntervalId tolerates a storage getItem that throws", () => {
  const brokenStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      // no-op
    },
    removeItem() {
      // no-op
    },
    clear() {
      // no-op
    },
    key() {
      return null;
    },
    get length() {
      return 0;
    },
  } as unknown as Storage;
  assert.equal(readRefreshIntervalId(brokenStorage), "off");
});

test("writeRefreshIntervalId tolerates a storage setItem that throws", () => {
  const brokenStorage = {
    setItem() {
      throw new Error("quota exceeded");
    },
    getItem() {
      return null;
    },
    removeItem() {
      // no-op
    },
    clear() {
      // no-op
    },
    key() {
      return null;
    },
    get length() {
      return 0;
    },
  } as unknown as Storage;
  writeRefreshIntervalId(brokenStorage, "2m");
});
