import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("web session keeps credentials server-side and preserves rotated refresh tokens", async () => {
  const [workspace, webSession, disconnectRoute] = await Promise.all([
    readFile(new URL("components/pr-workspace.tsx", root), "utf8"),
    readFile(new URL("lib/server/github-session.ts", root), "utf8"),
    readFile(new URL("app/api/github/disconnect/route.ts", root), "utf8"),
  ]);

  // Reviews are bound to the exact comparison that was inspected.
  assert.match(workspace, /liveDiffState\.inboxSyncedAt === inboxData\.syncedAt/);
  assert.match(workspace, /baseCommitId: displayedDiff\.baseSha/);

  // A connected session must leave the restoring view before loading the inbox.
  const connectedBootstrap = workspace.slice(
    workspace.indexOf("if (status.connected)"),
    workspace.indexOf("if (!selectedPullRequest || usingDemo)"),
  );
  assert.ok(
    connectedBootstrap.indexOf('setLaunchView("workspace")') <
      connectedBootstrap.indexOf("await gateway().getInbox()"),
    "connected sessions must leave the restoring view before loading the inbox",
  );

  // A rotated refresh token must not delete a valid parallel session.
  const badRefreshBranch = webSession.slice(
    webSession.indexOf('"bad_refresh_token"'),
    webSession.indexOf("throw error;"),
  );
  assert.doesNotMatch(badRefreshBranch, /clearGitHubSession/);

  // Only an explicit disconnect clears the session cookie.
  assert.match(disconnectRoute, /clearGitHubSession\(\)/);
});

test("session-backed routes answer a failed refresh with a structured error", async () => {
  const names = ["inbox", "diff", "review", "status"];
  const sources = await Promise.all(
    names.map((name) =>
      readFile(new URL(`app/api/github/${name}/route.ts`, root), "utf8"),
    ),
  );

  for (const [index, source] of sources.entries()) {
    // A transient token refresh failure must not escape as a bare 500, and
    // must never be reported as "not connected".
    assert.ok(
      source.indexOf("try {") < source.indexOf("await readGitHubSession()"),
      `${names[index]} must read the session inside its try block`,
    );
    assert.match(source, /return jsonError\(error\)/);
  }

  // A malformed review body is the client's error, not GitHub's.
  const reviewRoute = sources[names.indexOf("review")];
  const bodyParse = reviewRoute.slice(
    reviewRoute.indexOf("await request.json()"),
    reviewRoute.indexOf("submitReviewWithToken("),
  );
  assert.match(bodyParse, /catch[\s\S]*return invalidRequest\(\);/);
});
