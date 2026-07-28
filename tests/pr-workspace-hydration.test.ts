import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PrWorkspace } from "../components/pr-workspace";
import { demoInbox } from "../lib/demo-data";

test("the initial workspace render is deterministic across elapsed time", () => {
  const initialNow = new Date(demoInbox.syncedAt).getTime();
  const originalNow = Date.now;

  try {
    Date.now = () => initialNow;
    const serverHtml = renderToString(
      createElement(PrWorkspace, {
        initialDemoInbox: demoInbox,
        initialNow,
      }),
    );

    Date.now = () => initialNow + 2 * 60 * 1000;
    const hydrationHtml = renderToString(
      createElement(PrWorkspace, {
        initialDemoInbox: demoInbox,
        initialNow,
      }),
    );

    assert.equal(hydrationHtml, serverHtml);
    assert.match(serverHtml, /Welcome to Hype/);
    assert.match(serverHtml, /Explore preview mode/);
    assert.doesNotMatch(serverHtml, /Last synced/);
  } finally {
    Date.now = originalNow;
  }
});
