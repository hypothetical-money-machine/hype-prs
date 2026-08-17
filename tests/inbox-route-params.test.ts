import assert from "node:assert/strict";
import test from "node:test";
import { parseInboxRequest } from "../lib/server/inbox-params";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

test("page 1 and 2 map to the 25-per-bucket paginated query", () => {
  assert.deepEqual(parseInboxRequest(params("page=1")), {
    cursors: {},
    kind: "page",
    perBucket: 25,
  });
  assert.deepEqual(parseInboxRequest(params("page=2")), {
    cursors: {},
    kind: "page",
    perBucket: 25,
  });
});

test("page requests forward per-bucket after cursors", () => {
  const parsed = parseInboxRequest(
    params("page=2&authoredAfter=cursor_a&reviewRequestedAfter=cursor_r"),
  );
  assert.deepEqual(parsed, {
    cursors: { authored: "cursor_a", reviewRequested: "cursor_r" },
    kind: "page",
    perBucket: 25,
  });
});

test("a non-integer or out-of-range page is rejected, not silently defaulted", () => {
  for (const value of ["0", "3", "-1", "1.5", "abc", ""]) {
    assert.deepEqual(parseInboxRequest(params(`page=${value}`)), {
      kind: "invalid",
    });
  }
});

test("perBucket omitted or at the default routes to the full inbox query", () => {
  assert.deepEqual(parseInboxRequest(params("")), { kind: "full-inbox" });
  assert.deepEqual(parseInboxRequest(params("perBucket=50")), {
    kind: "full-inbox",
  });
});

test("a malformed perBucket is rejected instead of served as the default", () => {
  for (const value of ["25.5", "abc", "", "0", "51", "-3", "1e2"]) {
    assert.deepEqual(parseInboxRequest(params(`perBucket=${value}`)), {
      kind: "invalid",
    });
  }
});

test("an in-range perBucket routes to the paginated loader with cursors", () => {
  assert.deepEqual(
    parseInboxRequest(params("perBucket=25&assignedAfter=cursor_b")),
    { cursors: { assigned: "cursor_b" }, kind: "page", perBucket: 25 },
  );
});
