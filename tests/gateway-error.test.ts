import assert from "node:assert/strict";
import test from "node:test";
import { GatewayError, isRetryableGatewayError } from "../lib/gateway-error";
import { gateway } from "../lib/github-gateway";

test("the web gateway preserves the server's typed error envelope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          code: "not_connected",
          message: "Connect an approved GitHub App to continue.",
        },
      },
      { status: 401 },
    );

  try {
    await assert.rejects(
      gateway().connectionStatus(),
      (error: unknown) =>
        error instanceof GatewayError &&
        error.code === "not_connected" &&
        error.status === 401 &&
        error.message === "Connect an approved GitHub App to continue.",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the web gateway falls back to a generic message without a code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("boom", { status: 502 });

  try {
    await assert.rejects(
      gateway().connectionStatus(),
      (error: unknown) =>
        error instanceof GatewayError &&
        error.code === null &&
        error.status === 502 &&
        error.message === "Request failed (502).",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only 5xx gateway failures are considered retryable", () => {
  assert.equal(
    isRetryableGatewayError(new GatewayError("down", "graphql_error", 502)),
    true,
  );
  assert.equal(
    isRetryableGatewayError(new GatewayError("no session", "not_connected", 401)),
    false,
  );
  assert.equal(isRetryableGatewayError(new Error("plain")), false);
});
