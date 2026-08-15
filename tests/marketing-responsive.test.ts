import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("globals.css contains responsive mobile styles for marketing page", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf-8");

  // Verify launch-shell has fluid mobile sizing
  assert.match(css, /\.launch-shell,\s*\.app-shell\.launch-shell/);
  assert.match(css, /min-width:\s*0/);

  // Verify window-bar mobile flex layout
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /\.window-bar\s*\{[^}]*display:\s*flex/);

  // Verify marketing hero, mock window, feature grid, and FAQ mobile breakpoints
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /@media\s*\(max-width:\s*540px\)/);
  assert.match(css, /@media\s*\(max-width:\s*480px\)/);
  assert.match(css, /@media\s*\(max-width:\s*380px\)/);

  // Verify touch manipulation on buttons
  assert.match(css, /touch-action:\s*manipulation/);
});
