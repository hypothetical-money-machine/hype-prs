import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/", accept = "text/html") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      passThroughOnException() {},
      waitUntil() {},
    },
  );
}

test("server-renders a neutral session check before auth state is known", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Hype — the pull request pulse<\/title>/i);
  assert.match(html, /name="color-scheme" content="light dark"/i);
  assert.match(html, /src="\/theme-init\.js"/i);
  assert.match(html, /Restoring your session/);
  assert.doesNotMatch(html, /Welcome to Hype/);
  assert.doesNotMatch(html, /Continue with GitHub/);
  assert.doesNotMatch(html, /Explore preview mode/);
  assert.doesNotMatch(html, /Needs attention/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("GitHub connection status is never cached", async () => {
  const response = await render("/api/github/status", "application/json");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /\bno-store\b/);
});

test("web distribution exposes Pierre's full license and notices", async () => {
  const [licenseResponse, noticesResponse] = await Promise.all([
    render("/licenses/pierre-diffs", "text/plain"),
    render("/licenses/notices", "text/plain"),
  ]);
  assert.equal(licenseResponse.status, 200);
  assert.equal(noticesResponse.status, 200);

  const [license, notices] = await Promise.all([
    licenseResponse.text(),
    noticesResponse.text(),
  ]);
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /Copyright 2025 Pierre Computer Company/);
  assert.match(notices, /@pierre\/diffs/);
});

test("production responses carry the web security baseline", async () => {
  const response = await render();
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(
    response.headers.get("permissions-policy") ?? "",
    /camera=\(\)/,
  );
});
