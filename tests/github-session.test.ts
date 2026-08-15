import assert from "node:assert/strict";
import test from "node:test";
import {
  callbackUrl,
  sessionCookieMaxAge,
} from "../lib/server/github-session";

const CALLBACK_ENV_KEYS = ["GITHUB_CALLBACK_URL", "NODE_ENV"] as const;

// `NODE_ENV` is declared read-only on ProcessEnv, but these tests need to move
// it around, so write through a mutable view of the same object.
const env = process.env as Record<string, string | undefined>;

async function withCallbackEnvironment(
  values: Partial<Record<(typeof CALLBACK_ENV_KEYS)[number], string>>,
  run: () => void | Promise<void>,
) {
  const original = Object.fromEntries(
    CALLBACK_ENV_KEYS.map((key) => [key, env[key]]),
  );

  for (const key of CALLBACK_ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  try {
    await run();
  } finally {
    for (const key of CALLBACK_ENV_KEYS) {
      const value = original[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
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

test("keeps a non-expiring GitHub session across browser restarts", () => {
  assert.equal(
    sessionCookieMaxAge({
      accessToken: "access",
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      tokenType: "bearer",
    }),
    30 * 24 * 60 * 60,
  );
});

test("keeps the session through the refresh-token lifetime", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  assert.equal(
    sessionCookieMaxAge(
      {
        accessToken: "access",
        expiresAt: "2026-07-28T20:00:00.000Z",
        refreshToken: "refresh",
        refreshTokenExpiresAt: "2026-09-11T12:00:00.000Z",
        tokenType: "bearer",
      },
      now,
    ),
    // Deliberately not 30 days, so this cannot pass on the fallback value.
    45 * 24 * 60 * 60,
  );
});
