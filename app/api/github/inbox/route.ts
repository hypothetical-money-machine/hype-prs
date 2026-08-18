import {
  GitHubApiError,
  loadInboxPageWithToken,
  loadInboxWithToken,
} from "@/shared/github-api.mjs";
import { parseInboxRequest } from "@/lib/server/inbox-params";
import { readGitHubSession } from "@/lib/server/github-session";
import { jsonError, notConnected } from "@/lib/server/responses";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await readGitHubSession();
    if (!session) return notConnected();

    const parsed = parseInboxRequest(new URL(request.url).searchParams);
    if (parsed.kind === "invalid") {
      return jsonError(
        new GitHubApiError("Invalid inbox pagination parameters.", {
          code: "invalid_pagination",
          status: 400,
        }),
      );
    }
    if (parsed.kind === "full-inbox") {
      return Response.json(
        await loadInboxWithToken(session.tokenSet.accessToken, request.signal),
      );
    }
    return Response.json(
      await loadInboxPageWithToken(
        session.tokenSet.accessToken,
        { cursors: parsed.cursors, perBucket: parsed.perBucket },
        request.signal,
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
