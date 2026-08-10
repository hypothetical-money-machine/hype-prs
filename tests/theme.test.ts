import assert from "node:assert/strict";
import test from "node:test";
import {
  explicitTheme,
  parseThemePreference,
  THEME_PREFERENCES,
} from "../lib/theme";

test("theme preferences accept each supported choice", () => {
  for (const preference of THEME_PREFERENCES) {
    assert.equal(parseThemePreference(preference), preference);
  }
});

test("missing and invalid theme preferences fall back to system", () => {
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference(undefined), "system");
  assert.equal(parseThemePreference("sepia"), "system");
});

test("only explicit preferences produce a theme override", () => {
  assert.equal(explicitTheme("light"), "light");
  assert.equal(explicitTheme("dark"), "dark");
  assert.equal(explicitTheme("system"), null);
});
