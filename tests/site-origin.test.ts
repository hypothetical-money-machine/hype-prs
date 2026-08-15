import assert from "node:assert/strict";
import test from "node:test";
import { resolveSiteOrigin } from "../lib/server/site-origin";

async function withSiteUrl(
  value: string | undefined,
  run: () => void | Promise<void>,
) {
  const original = process.env.SITE_URL;

  if (value === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = value;

  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = original;
  }
}

function requestHeaders(values: Record<string, string>): Headers {
  return new Headers(values);
}

test("prefers the configured canonical origin over forwarded headers", async () => {
  await withSiteUrl("https://hype-prs.example.com/ignored/path", () => {
    assert.equal(
      resolveSiteOrigin(
        requestHeaders({ "x-forwarded-host": "attacker.example" }),
      ),
      "https://hype-prs.example.com",
    );
  });
});

test("falls back to forwarded headers when no canonical origin is set", async () => {
  await withSiteUrl(undefined, () => {
    assert.equal(
      resolveSiteOrigin(
        requestHeaders({
          "x-forwarded-host": "localhost:3001",
          "x-forwarded-proto": "http",
        }),
      ),
      "http://localhost:3001",
    );
  });
});

test("takes only the first entry of a comma-joined forwarded header", async () => {
  await withSiteUrl(undefined, () => {
    assert.equal(
      resolveSiteOrigin(
        requestHeaders({
          "x-forwarded-host": "app.example.com, attacker.example",
          "x-forwarded-proto": "https, http",
        }),
      ),
      "https://app.example.com",
    );
  });
});

test("ignores malformed forwarded values instead of throwing", async () => {
  await withSiteUrl(undefined, () => {
    for (const host of [
      "https://attacker.example",
      "app.example.com/path",
      "attacker example.com",
      "user@attacker.example",
      // Shape-valid but out of port range: `new URL()` would reject it.
      "attacker.example:99999",
      "",
    ]) {
      assert.equal(
        resolveSiteOrigin(
          requestHeaders({
            host: "app.example.com",
            "x-forwarded-host": host,
            "x-forwarded-proto": "javascript",
          }),
        ),
        "https://app.example.com",
      );
    }
  });
});

test("falls back to localhost when every host header is unusable", async () => {
  await withSiteUrl("not a url", () => {
    assert.equal(
      resolveSiteOrigin(requestHeaders({ host: "a b" })),
      "http://localhost:3000",
    );
  });
});
