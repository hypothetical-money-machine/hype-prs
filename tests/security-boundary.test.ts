import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Electron keeps credentials and native authority outside the renderer", async () => {
  const [main, preload, rendererHtml, workspace, webSession] =
    await Promise.all([
    readFile(new URL("electron/main.mjs", root), "utf8"),
    readFile(new URL("electron/preload.cjs", root), "utf8"),
    readFile(new URL("electron/renderer/index.html", root), "utf8"),
    readFile(new URL("components/pr-workspace.tsx", root), "utf8"),
    readFile(new URL("lib/server/github-session.ts", root), "utf8"),
  ]);

  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /panel\.setAlwaysOnTop\(false\)/);
  assert.match(main, /!app\.isPackaged/);
  assert.match(main, /event\.sender !== panel\.webContents/);
  assert.match(main, /event\.senderFrame !== panel\.webContents\.mainFrame/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setPermissionCheckHandler/);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /safeStorage\.decryptString/);
  assert.match(main, /authGeneration/);
  assert.match(main, /authAbortController\.abort\(\)/);
  assert.match(main, /readEncryptedSession\(operation\.generation\)/);
  assert.match(main, /loadInboxWithToken\(token, operation\.signal\)/);
  assert.match(main, /webContents\.setWindowOpenHandler/);
  assert.match(main, /will-navigate/);
  assert.doesNotMatch(preload, /accessToken|refreshToken|safeStorage|shell\./);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("hypePrs"/);
  assert.match(rendererHtml, /Content-Security-Policy/);
  assert.match(rendererHtml, /default-src 'self'/);
  assert.match(workspace, /liveDiffState\.inboxSyncedAt === inboxData\.syncedAt/);
  assert.match(workspace, /baseCommitId: displayedDiff\.baseSha/);
  const badRefreshBranch = webSession.slice(
    webSession.indexOf('"bad_refresh_token"'),
    webSession.indexOf("throw error;"),
  );
  assert.doesNotMatch(badRefreshBranch, /clearGitHubSession/);
});

test("Electron distribution includes the complete Pierre license", async () => {
  const [packageText, notices, license] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
    readFile(new URL("node_modules/@pierre/diffs/LICENSE.md", root), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const resourceSources = packageJson.build.extraResources.map(
    ({ from }: { from: string }) => from,
  );

  assert.ok(resourceSources.includes("node_modules/@pierre/diffs/LICENSE.md"));
  assert.equal(packageJson.build.mac.extendInfo.LSUIElement, true);
  assert.ok(packageJson.build.files.includes("!node_modules/**/*"));
  assert.match(notices, /Apache License, Version 2\.0/);
  assert.match(license, /Apache License/);
});
