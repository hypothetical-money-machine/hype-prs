import { notFound, redirect } from "next/navigation";
import { PrWorkspace } from "@/components/pr-workspace";
import { createDemoInbox } from "@/lib/demo-data";
import {
  appPathForPullRequest,
  parseGithubPullRequestPath,
} from "@/lib/github-pr-link";

export const dynamic = "force-dynamic";

export default async function PullRequestDeepLinkPage({
  params,
}: {
  params: Promise<{
    number: string;
    owner: string;
    repository: string;
    rest?: string[];
  }>;
}) {
  const resolved = await params;
  const pathname = `/${resolved.owner}/${resolved.repository}/pull/${resolved.number}${
    resolved.rest?.length ? `/${resolved.rest.join("/")}` : ""
  }`;
  const target = parseGithubPullRequestPath(pathname);
  if (!target) notFound();

  // Collapse /files, /commits, /checks, etc. onto the canonical app path so
  // pasting a full GitHub URL after a host swap always lands in one place.
  const canonical = appPathForPullRequest(target);
  if (pathname !== canonical) {
    redirect(canonical);
  }

  return (
    <PrWorkspace
      initialDemoInbox={createDemoInbox()}
      initialPullRequestRef={target}
    />
  );
}
