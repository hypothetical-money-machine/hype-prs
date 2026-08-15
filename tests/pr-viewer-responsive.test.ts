import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import type { ComponentType } from "react";
import { JSDOM } from "jsdom";
import { PrWorkspace } from "../components/pr-workspace";
import { createDemoInbox } from "../lib/demo-data";
import type { InboxPayload } from "../lib/types";

const demoInbox = createDemoInbox();

test("globals.css contains responsive mobile styles for PR workspace and diff viewer", () => {
  const css = readFileSync("app/globals.css", "utf8");

  assert.match(
    css,
    /@media\s*\(max-width:\s*768px\)/,
    "should contain 768px media query",
  );
  assert.match(
    css,
    /data-mobile-pane="queue"/,
    "should handle mobile queue pane visibility",
  );
  assert.match(
    css,
    /data-mobile-pane="detail"/,
    "should handle mobile detail pane visibility",
  );
  assert.match(
    css,
    /data-mobile-tab="diff"/,
    "should handle mobile diff tab display",
  );
  assert.match(
    css,
    /data-mobile-tab="files"/,
    "should handle mobile files tab display",
  );
  assert.match(
    css,
    /\.mobile-back-button/,
    "should contain mobile back button styles",
  );
  assert.match(
    css,
    /\.diff-mobile-tabs/,
    "should contain diff mobile tab switcher styles",
  );
  assert.match(
    css,
    /\.mobile-view-nav/,
    "should contain mobile quick view nav pills",
  );
  assert.match(
    css,
    /\.mobile-view-pill/,
    "should contain mobile quick view pill styles",
  );
});

test("mobile PR viewer navigation switches between queue and detail panes", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  try {
    const { cleanup, fireEvent, render } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    const view = render(
      createElement(PrWorkspace as ComponentType<{ initialDemoInbox: InboxPayload; initialNow: number }>, {
        initialDemoInbox: demoInbox,
        initialNow: Date.parse(demoInbox.syncedAt),
      }),
    );

    const preview = await view.findByRole("button", {
      name: /Explore preview mode/,
    });
    fireEvent.click(preview);

    const appGrid = (await view.findByRole("listbox", {
      name: /Needs attention/,
    })).closest(".app-grid");
    assert.ok(appGrid, "app-grid element should exist");
    assert.equal(
      appGrid.getAttribute("data-mobile-pane"),
      "queue",
      "initial mobile pane should be queue",
    );

    // Select a PR row
    const prRow = view.getByRole("option", {
      name: /Guard webhook retries with idempotency keys/,
    });
    fireEvent.click(prRow);

    assert.equal(
      appGrid.getAttribute("data-mobile-pane"),
      "detail",
      "selecting PR row should switch mobile pane to detail",
    );

    // Click back button
    const backButton = view.getByRole("button", {
      name: /Back to queue/,
    });
    fireEvent.click(backButton);

    assert.equal(
      appGrid.getAttribute("data-mobile-pane"),
      "queue",
      "clicking back button should return mobile pane to queue",
    );
  } finally {
    try {
      cleanupDom?.();
    } finally {
      dom.window.close();
      uninstallDom();
    }
  }
});

test("mobile diff workspace switches between diff and changed files tabs", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  try {
    const { cleanup, fireEvent, render } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    const view = render(
      createElement(PrWorkspace as ComponentType<{ initialDemoInbox: InboxPayload; initialNow: number }>, {
        initialDemoInbox: demoInbox,
        initialNow: Date.parse(demoInbox.syncedAt),
      }),
    );

    const preview = await view.findByRole("button", {
      name: /Explore preview mode/,
    });
    fireEvent.click(preview);

    // Select a PR
    fireEvent.click(
      await view.findByRole("option", {
        name: /Guard webhook retries with idempotency keys/,
      }),
    );

    const diffWorkspace = view.getByRole("tab", {
      name: /Diff View/,
    }).closest(".diff-workspace");
    assert.ok(diffWorkspace, "diff-workspace element should exist");
    assert.equal(
      diffWorkspace.getAttribute("data-mobile-tab"),
      "diff",
      "initial mobile tab should be diff",
    );

    // Switch to files tab
    const filesTab = view.getByRole("tab", {
      name: /^Files/,
    });
    fireEvent.click(filesTab);
    assert.equal(
      diffWorkspace.getAttribute("data-mobile-tab"),
      "files",
      "clicking Files tab should switch data-mobile-tab to files",
    );

    // Clicking a file inside changed files switches back to diff tab
    const fileNode = await view.findByTitle("src/change.ts");
    fireEvent.click(fileNode);
    assert.equal(
      diffWorkspace.getAttribute("data-mobile-tab"),
      "diff",
      "clicking a file should switch data-mobile-tab back to diff",
    );
  } finally {
    try {
      cleanupDom?.();
    } finally {
      dom.window.close();
      uninstallDom();
    }
  }
});

test("mobile quick view pills switch active triage view", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  try {
    const { cleanup, fireEvent, render } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    const view = render(
      createElement(PrWorkspace as ComponentType<{ initialDemoInbox: InboxPayload; initialNow: number }>, {
        initialDemoInbox: demoInbox,
        initialNow: Date.parse(demoInbox.syncedAt),
      }),
    );

    const preview = await view.findByRole("button", {
      name: /Explore preview mode/,
    });
    fireEvent.click(preview);

    const allPill = await view.findByRole("tab", {
      name: /^All\b/,
    });
    fireEvent.click(allPill);

    assert.equal(
      allPill.getAttribute("aria-selected"),
      "true",
      "All quick view pill should be active",
    );
  } finally {
    try {
      cleanupDom?.();
    } finally {
      dom.window.close();
      uninstallDom();
    }
  }
});

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id=\"root\"></div></body></html>",
    { pretendToBeVisual: true, url: "http://localhost:3000/" },
  );

  dom.window.requestAnimationFrame = (callback) =>
    dom.window.setTimeout(() => callback(dom.window.performance.now()), 0);
  dom.window.cancelAnimationFrame = (handle) =>
    dom.window.clearTimeout(handle);

  // The diff workspace loads lazily, so Pierre's custom elements now register
  // during render rather than at module load. They need `customElements` and a
  // constructable `CSSStyleSheet` on the global.
  const globals = {
    document: dom.window.document,
    CSSStyleSheet: dom.window.CSSStyleSheet,
    customElements: dom.window.customElements,
    CustomEvent: dom.window.CustomEvent,
    DOMParser: dom.window.DOMParser,
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
    fetch: () => Promise.reject(new Error("No live GitHub in preview mode")),
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
