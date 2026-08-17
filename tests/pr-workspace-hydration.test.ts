import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { PrWorkspace } from "../components/pr-workspace";
import { createDemoInbox } from "../lib/demo-data";

const demoInbox = createDemoInbox();

type WorkspaceProps = NonNullable<Parameters<typeof PrWorkspace>[0]>;

test("the initial workspace render is deterministic across elapsed time", () => {
  const initialNow = new Date(demoInbox.syncedAt).getTime();
  const originalNow = Date.now;

  try {
    Date.now = () => initialNow;
    const serverHtml = renderToString(
      createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
        initialDemoInbox: demoInbox,
        initialNow,
      }),
    );

    Date.now = () => initialNow + 2 * 60 * 1000;
    const hydrationHtml = renderToString(
      createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
        initialDemoInbox: demoInbox,
        initialNow,
      }),
    );

    assert.equal(hydrationHtml, serverHtml);
    assert.match(serverHtml, /Checking your GitHub connection/);
    assert.match(serverHtml, /<legend[^>]*>Appearance<\/legend>/);
    assert.doesNotMatch(serverHtml, /\bchecked=""/);
    assert.doesNotMatch(serverHtml, /Welcome to Hype/);
    assert.doesNotMatch(serverHtml, /Explore preview/);
    assert.doesNotMatch(serverHtml, /Last synced/);
  } finally {
    Date.now = originalNow;
  }
});
