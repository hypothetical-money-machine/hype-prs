import assert from "node:assert/strict";
import test from "node:test";
import { buildFileTree, filterFileTree } from "../lib/file-tree";
import type { ChangedFile } from "../lib/types";

function changedFile(filename: string): ChangedFile {
  return {
    additions: 1,
    blobUrl: null,
    changes: 1,
    deletions: 0,
    filename,
    patch: `@@ -0,0 +1 @@\n+${filename}`,
    previousFilename: null,
    rawUrl: null,
    status: "modified",
  };
}

const files = [
  changedFile("README.md"),
  changedFile("app/page.tsx"),
  changedFile("app/api/github/route.ts"),
  changedFile("components/workspace.tsx"),
];

test("changed files form a stable directory-first tree", () => {
  const tree = buildFileTree(files);
  assert.deepEqual(
    tree.map((node) => [node.type, node.name, node.id]),
    [
      ["directory", "app", "dir:app"],
      ["directory", "components", "dir:components"],
      ["file", "README.md", "file:README.md"],
    ],
  );

  const app = tree[0];
  assert.equal(app?.type, "directory");
  if (app?.type !== "directory") return;
  assert.deepEqual(
    app.children.map((node) => [node.type, node.name, node.id]),
    [
      ["directory", "api", "dir:app/api"],
      ["file", "page.tsx", "file:app/page.tsx"],
    ],
  );
});

test("a file named like a sibling directory keeps a distinct node id", () => {
  const tree = buildFileTree([changedFile("docs"), changedFile("docs/a.md")]);
  assert.deepEqual(
    tree.map((node) => [node.type, node.name, node.id]),
    [
      ["directory", "docs", "dir:docs"],
      ["file", "docs", "file:docs"],
    ],
  );
  const ids = tree.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("path filtering keeps matching ancestors and canonical file identity", () => {
  const filtered = filterFileTree(buildFileTree(files), "github");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "dir:app");
  assert.equal(filtered[0]?.type, "directory");

  const app = filtered[0];
  if (app?.type !== "directory") return;
  assert.equal(app.children[0]?.id, "dir:app/api");
  assert.equal(app.children[0]?.type, "directory");
  const api = app.children[0];
  if (api?.type !== "directory") return;
  assert.equal(api.children[0]?.id, "dir:app/api/github");
});
