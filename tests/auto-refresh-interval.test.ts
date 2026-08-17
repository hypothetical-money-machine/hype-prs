import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { ComponentType } from "react";
import { JSDOM } from "jsdom";
import { PrWorkspace } from "../components/pr-workspace";
import { createDemoInbox } from "../lib/demo-data";

const demoInbox = createDemoInbox();

test("the queue header exposes the auto-refresh interval dropdown", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  try {
    const { cleanup, fireEvent, render } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    const view = render(
      createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
        initialDemoInbox: demoInbox,
        initialNow: Date.parse(demoInbox.syncedAt),
      }),
    );

    fireEvent.click(
      await view.findByRole("button", { name: /Explore preview mode/ }),
    );

    const select = (await view.findByRole("combobox", {
      name: "Auto-refresh interval",
    })) as HTMLSelectElement;
    assert.ok(select, "auto-refresh select should be present");
    assert.equal(select.value, "off");
    assert.equal(select.disabled, true, "preview mode cannot auto-refresh");

    // The dropdown offers every supported cadence plus the default.
    const optionLabels = [...select.options].map((option) => option.textContent);
    assert.deepEqual(optionLabels, [
      "Auto: Off",
      "Auto: 1 min",
      "Auto: 2 min",
      "Auto: 5 min",
      "Auto: 15 min",
      "Auto: 30 min",
    ]);
  } finally {
    try {
      cleanupDom?.();
    } finally {
      dom.window.close();
      uninstallDom();
    }
  }
});

test("selecting a non-default interval persists it and shows it in the status line", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  try {
    const { cleanup, fireEvent, render } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    const view = render(
      createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
        initialDemoInbox: demoInbox,
        initialNow: Date.parse(demoInbox.syncedAt),
      }),
    );

    fireEvent.click(
      await view.findByRole("button", { name: /Explore preview mode/ }),
    );

    const select = (await view.findByRole("combobox", {
      name: "Auto-refresh interval",
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "5m" } });
    assert.equal(
      dom.window.localStorage.getItem("hype-prs-refresh-interval-ms-v1"),
      "5m",
    );

    assert.equal(select.value, "5m");

    // The status line reflects the persisted choice so the user can see it
    // is engaged even though the demo workspace does not auto-refresh.
    const statusLine = document.querySelector(".queue-status-line");
    assert.match(
      statusLine?.textContent ?? "",
      /auto 5 min/i,
      "auto-refresh cadence should appear in the status line",
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

test("restoring a non-default interval on a fresh render applies it to the select", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  try {
    dom.window.localStorage.setItem(
      "hype-prs-refresh-interval-ms-v1",
      "2m",
    );
    const { cleanup, fireEvent, render } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    const view = render(
      createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
        initialDemoInbox: demoInbox,
        initialNow: Date.parse(demoInbox.syncedAt),
      }),
    );

    fireEvent.click(
      await view.findByRole("button", { name: /Explore preview mode/ }),
    );

    const select = (await view.findByRole("combobox", {
      name: "Auto-refresh interval",
    })) as HTMLSelectElement;
    assert.equal(select.value, "2m");
  } finally {
    try {
      cleanupDom?.();
    } finally {
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
    fetch: () =>
      Promise.reject(new Error("No live GitHub in preview mode")),
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
