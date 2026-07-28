import assert from "node:assert/strict";
import test from "node:test";
import { callbackUrl } from "../lib/server/github-session";

const CALLBACK_ENV_KEYS = ["GITHUB_CALLBACK_URL", "NODE_ENV"] as const;

async function withCallbackEnvironment(
  values: Partial<Record<(typeof CALLBACK_ENV_KEYS)[number], string>>,
  run: () => void | Promise<void>,
) {
  const original = Object.fromEntries(
    CALLBACK_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  for (const key of CALLBACK_ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await run();
  } finally {
    for (const key of CALLBACK_ENV_KEYS) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("derives the callback from the active local development origin", async () => {
  await withCallbackEnvironment({ NODE_ENV: "development" }, () => {
    assert.equal(
      callbackUrl(new Request("http://localhost:3001/api/github/auth/start")),
      "http://localhost:3001/api/github/auth/callback",
    );
  });
});

test("allows an explicit HTTP loopback callback during local development", async () => {
  await withCallbackEnvironment(
    {
      GITHUB_CALLBACK_URL:
        "http://localhost:3001/api/github/auth/callback",
      NODE_ENV: "development",
    },
    () => {
      assert.equal(
        callbackUrl(new Request("http://localhost:3001/api/github/auth/start")),
        "http://localhost:3001/api/github/auth/callback",
      );
    },
  );
});

test("rejects an HTTP loopback callback in production", async () => {
  await withCallbackEnvironment(
    {
      GITHUB_CALLBACK_URL:
        "http://localhost:3001/api/github/auth/callback",
      NODE_ENV: "production",
    },
    () => {
      assert.throws(() =>
        callbackUrl(
          new Request("https://hype.example/api/github/auth/start"),
        ),
      );
    },
  );
});

test("rejects a non-loopback HTTP callback during development", async () => {
  await withCallbackEnvironment(
    {
      GITHUB_CALLBACK_URL:
        "http://hype.example/api/github/auth/callback",
      NODE_ENV: "development",
    },
    () => {
      assert.throws(() =>
        callbackUrl(
          new Request("http://localhost:3001/api/github/auth/start"),
        ),
      );
    },
  );
});

test("allows an explicit HTTPS callback in production", async () => {
  await withCallbackEnvironment(
    {
      GITHUB_CALLBACK_URL:
        "https://hype.example/api/github/auth/callback",
      NODE_ENV: "production",
    },
    () => {
      assert.equal(
        callbackUrl(
          new Request("https://hype.example/api/github/auth/start"),
        ),
        "https://hype.example/api/github/auth/callback",
      );
    },
  );
});
