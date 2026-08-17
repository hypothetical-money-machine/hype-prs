import assert from "node:assert/strict";
import test from "node:test";
import { createDemoInbox, demoDiffs } from "../lib/demo-data";

test("demo timestamps are relative to read time, not module load", () => {
  const base = Date.parse("2026-08-14T12:00:00.000Z");
  const weekLater = base + 7 * 24 * 60 * 60 * 1000;

  const first = createDemoInbox(base);
  const second = createDemoInbox(weekLater);

  assert.equal(first.syncedAt, new Date(base).toISOString());
  assert.equal(second.syncedAt, new Date(weekLater).toISOString());

  for (const [index, pullRequest] of first.pullRequests.entries()) {
    const shifted = second.pullRequests[index];
    assert.equal(
      Date.parse(shifted.updatedAt) - Date.parse(pullRequest.updatedAt),
      weekLater - base,
    );
  }
});

test("every demo file tree entry has a matching patch header", () => {
  // A file listed in the tree but absent from the patch renders as "GitHub
  // did not provide a textual patch" when clicked, so the two must agree.
  for (const [id, diff] of Object.entries(demoDiffs)) {
    const patchFilenames = [
      ...diff.patch.matchAll(/^diff --git a\/.+? b\/(.+)$/gm),
    ].map((match) => match[1]);
    const treeFilenames = diff.files.map((file) => file.filename);
    assert.deepEqual(
      [...treeFilenames].sort(),
      [...patchFilenames].sort(),
      `demo diff ${id} should list exactly the files its patch contains`,
    );
  }
});
