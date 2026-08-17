export interface GithubPullRequestRef {
  number: number;
  owner: string;
  repository: string;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const PATH_PATTERN =
  /^\/(?<owner>[A-Za-z0-9_.-]+)\/(?<repository>[A-Za-z0-9_.-]+)\/pull\/(?<number>\d+)(?:\/.*)?$/;

/**
 * Parse a GitHub pull request URL or an app path that mirrors one.
 * Accepts full github.com URLs and same-origin paths like
 * /owner/repo/pull/123/changes.
 */
export function parseGithubPullRequestLink(
  input: string,
): GithubPullRequestRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.includes("://") || trimmed.startsWith("//")) {
    let url: URL;
    try {
      url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }
    return parseGithubPullRequestPath(url.pathname);
  }

  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return parseGithubPullRequestPath(path);
}

export function parseGithubPullRequestPath(
  pathname: string,
): GithubPullRequestRef | null {
  const match = PATH_PATTERN.exec(pathname);
  if (!match?.groups) return null;

  const owner = match.groups.owner;
  const repository = match.groups.repository;
  const number = Number(match.groups.number);
  if (!SEGMENT.test(owner) || !SEGMENT.test(repository)) return null;
  if (!Number.isInteger(number) || number < 1) return null;

  return { number, owner, repository };
}

export function appPathForPullRequest(ref: GithubPullRequestRef): string {
  return `/${ref.owner}/${ref.repository}/pull/${ref.number}`;
}

export function pullRequestMatchesRef(
  pullRequest: { number: number; repository: string },
  ref: GithubPullRequestRef,
): boolean {
  // ASCII case folding only: locale-aware lowercasing (e.g. Turkish I)
  // would break owner/repo path matching against GitHub's nameWithOwner.
  return (
    pullRequest.number === ref.number &&
    pullRequest.repository.toLowerCase() ===
      `${ref.owner}/${ref.repository}`.toLowerCase()
  );
}

export function pullRequestRefKey(
  ref: GithubPullRequestRef | null | undefined,
): string {
  if (!ref) return "";
  return `${ref.owner.toLowerCase()}/${ref.repository.toLowerCase()}#${ref.number}`;
}

/** Same-origin relative path only; used for OAuth returnTo. */
export function isSafeAppReturnPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\") || value.includes("\0") || value.includes("..")) {
    return false;
  }
  try {
    const url = new URL(value, "https://hype-prs.invalid");
    return (
      url.origin === "https://hype-prs.invalid" &&
      `${url.pathname}${url.search}${url.hash}` === value
    );
  } catch {
    return false;
  }
}
