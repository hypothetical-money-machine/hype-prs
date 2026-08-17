import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import type { ComponentType } from "react";
import { JSDOM } from "jsdom";
import { DiffWorkspace } from "../components/diff-workspace";
import {
  DEFAULT_DIFF_FONT_SIZE_PT,
  getDiffLineHeightPt,
  MAX_DIFF_FONT_SIZE_PT,
  MIN_DIFF_FONT_SIZE_PT,
  parseDiffFontSizePt,
} from "../lib/diff-font-size";
import { createDemoInbox, demoDiffs } from "../lib/demo-data";

const demoInbox = createDemoInbox();
const samplePr = demoInbox.pullRequests[0];
const sampleDiff = demoDiffs[samplePr.id];

test("parseDiffFontSizePt validates, clamps, and falls back safely", () => {
  assert.equal(parseDiffFontSizePt(7), 7);
  assert.equal(parseDiffFontSizePt(10), 10);
  assert.equal(parseDiffFontSizePt(13), 13);
  assert.equal(parseDiffFontSizePt(18), 18);
  assert.equal(parseDiffFontSizePt("8"), 8);
  assert.equal(parseDiffFontSizePt("12"), 12);
  assert.equal(parseDiffFontSizePt("15"), 15);

  // Clamping
  assert.equal(parseDiffFontSizePt(4), MIN_DIFF_FONT_SIZE_PT);
  assert.equal(parseDiffFontSizePt(32), MAX_DIFF_FONT_SIZE_PT);
  assert.equal(parseDiffFontSizePt("2"), MIN_DIFF_FONT_SIZE_PT);
  assert.equal(parseDiffFontSizePt("99"), MAX_DIFF_FONT_SIZE_PT);

  // Fallbacks
  assert.equal(parseDiffFontSizePt(null), DEFAULT_DIFF_FONT_SIZE_PT);
  assert.equal(parseDiffFontSizePt(undefined), DEFAULT_DIFF_FONT_SIZE_PT);
  assert.equal(parseDiffFontSizePt(""), DEFAULT_DIFF_FONT_SIZE_PT);
  assert.equal(parseDiffFontSizePt("invalid"), DEFAULT_DIFF_FONT_SIZE_PT);
  assert.equal(parseDiffFontSizePt(Number.NaN), DEFAULT_DIFF_FONT_SIZE_PT);
});

test("getDiffLineHeightPt computes proportional line-heights", () => {
  assert.equal(getDiffLineHeightPt(7), 11);
  assert.equal(getDiffLineHeightPt(8), 12);
  assert.equal(getDiffLineHeightPt(10), 16);
  assert.equal(getDiffLineHeightPt(12), 19);
  assert.equal(getDiffLineHeightPt(13), 20);
  assert.equal(getDiffLineHeightPt(14), 22);
  assert.equal(getDiffLineHeightPt(16), 25);
  assert.equal(getDiffLineHeightPt(18), 28);
});

test("globals.css defines point picker stepper styling", () => {
  const css = readFileSync("app/globals.css", "utf8");

  assert.match(
    css,
    /\.point-picker\s*\{/,
    "should define .point-picker container style",
  );
  assert.match(
    css,
    /\.point-picker-value/,
    "should define .point-picker-value font and alignment style",
  );
});

test("DiffWorkspace renders point size stepper and steps between 10pt and 18pt", async () => {
  const dom = installDom();
  let cleanupDom: (() => void) | undefined;

  try {
    const { cleanup, fireEvent, render } = await import(
      "@testing-library/react"
    );
    cleanupDom = cleanup;

    const view = render(
      createElement(
        DiffWorkspace as ComponentType<{
          diff: typeof sampleDiff;
          fileBrowserCollapsed: boolean;
          layout: "unified";
          loading: boolean;
          onLayoutChange(layout: "split" | "unified"): void;
          onOpenInGitHub(): void;
          themePreference: "system";
        }>,
        {
          diff: sampleDiff,
          fileBrowserCollapsed: false,
          layout: "unified",
          loading: false,
          onLayoutChange: () => {},
          onOpenInGitHub: () => {},
          themePreference: "system",
        },
      ),
    );

    const diffWorkspace = view.getByRole("tab", {
      name: /^Diff$/,
    }).closest(".diff-workspace");
    assert.ok(diffWorkspace, "diff workspace container should exist");
    assert.equal(
      diffWorkspace.getAttribute("data-font-size-pt"),
      "13",
      "initial font size should be 13pt",
    );

    const decreaseButton = view.getByRole("button", {
      name: /Decrease text size/,
    });
    const increaseButton = view.getByRole("button", {
      name: /Increase text size/,
    });
    const readout = diffWorkspace.querySelector(".point-picker-value");
    assert.ok(readout, "readout element should exist");
    assert.match(readout.textContent ?? "", /13\s*pt/);

    // Step down to 12pt
    fireEvent.click(decreaseButton);
    assert.equal(
      diffWorkspace.getAttribute("data-font-size-pt"),
      "12",
      "should step down to 12pt",
    );
    assert.match(readout.textContent ?? "", /12\s*pt/);

    // Step up to 14pt
    fireEvent.click(increaseButton);
    fireEvent.click(increaseButton);
    assert.equal(
      diffWorkspace.getAttribute("data-font-size-pt"),
      "14",
      "should step up to 14pt",
    );
    assert.match(readout.textContent ?? "", /14\s*pt/);
  } finally {
    try {
      cleanupDom?.();
    } finally {
      dom.window.close();
      uninstallDom();
    }
  }
});

let originalGlobals: Map<PropertyKey, PropertyDescriptor | undefined>;

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost:3000/",
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
