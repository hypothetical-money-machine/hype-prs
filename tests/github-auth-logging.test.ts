import assert from "node:assert/strict";
import test from "node:test";
import {
  githubAuthFailureDetails,
  type GitHubAuthStage,
} from "../lib/server/github-auth-logging";
import { GitHubApiError } from "../shared/github-api.mjs";

test("GitHub auth logging preserves actionable API error details", () => {
  const details = githubAuthFailureDetails(
    "exchange_authorization_code",
    new GitHubApiError("The client secret is incorrect.", {
      code: "incorrect_client_credentials",
      githubMessage: "Bad credentials",
      requestId: "ABC1:2345:6789",
      status: 401,
    }),
  );

  assert.deepEqual(details, {
    errorCode: "incorrect_client_credentials",
    errorMessage: "The client secret is incorrect.",
    errorName: "GitHubApiError",
    githubMessage: "Bad credentials",
    httpStatus: 401,
    requestId: "ABC1:2345:6789",
    stage: "exchange_authorization_code",
  });
});

test("unexpected auth failures do not log arbitrary error messages", () => {
  const secret = "do-not-log-this-value";
  const stages: GitHubAuthStage[] = [
    "exchange_authorization_code",
    "load_authenticated_viewer",
    "write_encrypted_session",
  ];

  for (const stage of stages) {
    const details = githubAuthFailureDetails(stage, new Error(secret));
    assert.deepEqual(details, { errorName: "Error", stage });
    assert.doesNotMatch(JSON.stringify(details), new RegExp(secret));
  }
});
