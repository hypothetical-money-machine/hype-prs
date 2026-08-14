import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { ComponentType } from "react";
import { JSDOM } from "jsdom";
import { PrWorkspace } from "../components/pr-workspace";
import { demoInbox } from "../lib/demo-data";

test("workspace panels collapse from the viewer boundary and restore context", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  try {
    const { act, cleanup, fireEvent, render, screen } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    render(
      createElement(PrWorkspace as ComponentType<WorkspaceProps>, {
        initialDemoInbox: demoInbox,
        initialNow: Date.parse(demoInbox.syncedAt),
      }),
    );

    const preview = await screen.findByRole("button", {
      name: /Explore preview mode/,
    });
    fireEvent.click(preview);

    const queueSearch = await screen.findByRole<HTMLInputElement>("textbox", {
      name: /Search pull requests/,
    });
    const fileSearch = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Filter changed files",
    });
    fireEvent.change(queueSearch, { target: { value: "keyboard" } });
    fireEvent.change(fileSearch, { target: { value: "ReviewQueue" } });

    const collapse = screen.getByRole("button", {
      name: "Collapse panels",
    });
    assert.ok(collapse.closest(".detail-pane"));
    assert.equal(collapse.closest(".window-bar"), null);
    assert.deepEqual(collapse.getAttribute("aria-controls")?.split(/\s+/), [
      "workspace-navigation",
      "pull-request-queue",
      "changed-files",
    ]);
    const controlledPanels = controlledElements(collapse);

    fireEvent.click(collapse);
    assert.equal(collapse.getAttribute("aria-expanded"), "false");
    assert.equal(controlledPanels.every((panel) => panel.hidden), true);

    fireEvent.click(
      screen.getByRole("button", { name: "Expand panels" }),
    );
    assert.equal(controlledPanels.every((panel) => !panel.hidden), true);
    assert.equal(queueSearch.value, "keyboard");
    assert.equal(fileSearch.value, "ReviewQueue");
    assert.equal(
      screen
        .getByRole("option", { name: /Add keyboard shortcuts/ })
        .getAttribute("aria-selected"),
      "true",
    );

    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      fireEvent.click(
        screen.getByRole("button", { name: "Collapse panels" }),
      );
      await act(async () => {
        fireEvent.keyDown(dom.window.document.body, {
          ...modifier,
          key: "k",
        });
        await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
      });
      assert.equal(controlledPanels.every((panel) => !panel.hidden), true);
      assert.equal(dom.window.document.activeElement, queueSearch);
    }
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

function controlledElements(button: HTMLElement): HTMLElement[] {
  const ids = button.getAttribute("aria-controls")?.split(/\s+/) ?? [];
  return ids.map((id) => {
    const element = document.getElementById(id);
    assert.ok(element, `Expected controlled panel #${id}`);
    return element;
  });
}

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
  originalGlobals = new Map();

  const globals = {
    document: dom.window.document,
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
