import assert from "node:assert/strict";
import test from "node:test";
import {
  appPathForPullRequest,
  isSafeAppReturnPath,
  parseGithubPullRequestLink,
  pullRequestMatchesRef,
} from "../lib/github-pr-link";

test("parses github.com pull request URLs including tab suffixes", () => {
  assert.deepEqual(
    parseGithubPullRequestLink(
      "https://github.com/hypothetical-money-machine/hype-comms/pull/187/changes",
    ),
    {
      number: 187,
      owner: "hypothetical-money-machine",
      repository: "hype-comms",
    },
  );
  assert.deepEqual(
    parseGithubPullRequestLink(
      "https://www.github.com/acme/console/pull/42/files#diff-abc",
    ),
    {
      number: 42,
      owner: "acme",
      repository: "console",
    },
  );
});

test("parses app paths that mirror GitHub pull request URLs", () => {
  assert.deepEqual(
    parseGithubPullRequestLink(
      "/hypothetical-money-machine/hype-comms/pull/187/changes",
    ),
    {
      number: 187,
      owner: "hypothetical-money-machine",
      repository: "hype-comms",
    },
  );
  assert.equal(
    appPathForPullRequest({
      number: 187,
      owner: "hypothetical-money-machine",
      repository: "hype-comms",
    }),
    "/hypothetical-money-machine/hype-comms/pull/187",
  );
});

test("rejects non-GitHub hosts and malformed coordinates", () => {
  assert.equal(
    parseGithubPullRequestLink(
      "https://evil.example/github.com/acme/console/pull/1",
    ),
    null,
  );
  assert.equal(parseGithubPullRequestLink("/acme/console/issues/1"), null);
  assert.equal(parseGithubPullRequestLink("/acme/console/pull/0"), null);
  assert.equal(parseGithubPullRequestLink("/acme/con sole/pull/1"), null);
});

test("matches pull requests case-insensitively by repository path", () => {
  assert.equal(
    pullRequestMatchesRef(
      { number: 187, repository: "Hypothetical-Money-Machine/Hype-Comms" },
      {
        number: 187,
        owner: "hypothetical-money-machine",
        repository: "hype-comms",
      },
    ),
    true,
  );
  assert.equal(
    pullRequestMatchesRef(
      { number: 186, repository: "hypothetical-money-machine/hype-comms" },
      {
        number: 187,
        owner: "hypothetical-money-machine",
        repository: "hype-comms",
      },
    ),
    false,
  );
});

test("repository matching uses locale-independent ASCII case folding", () => {
  const original = String.prototype.toLocaleLowerCase;
  // Simulate a Turkish-style locale fold that would break "I" → "i".
  String.prototype.toLocaleLowerCase = function toLocaleLowerCase() {
    return original.call(this).replaceAll("i", "ı");
  };
  try {
    assert.equal(
      pullRequestMatchesRef(
        { number: 1, repository: "Acme/Infra" },
        { number: 1, owner: "acme", repository: "infra" },
      ),
      true,
    );
  } finally {
    String.prototype.toLocaleLowerCase = original;
  }
});

test("accepts only same-origin relative return paths", () => {
  assert.equal(
    isSafeAppReturnPath("/hypothetical-money-machine/hype-comms/pull/187"),
    true,
  );
  assert.equal(isSafeAppReturnPath("/?connection=connected"), true);
  assert.equal(isSafeAppReturnPath("//evil.example"), false);
  assert.equal(isSafeAppReturnPath("https://evil.example"), false);
  assert.equal(isSafeAppReturnPath("/../etc/passwd"), false);
});
