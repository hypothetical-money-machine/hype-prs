import { loadPullDiffWithToken } from "@/shared/github-api.mjs";
import { readGitHubSession } from "@/lib/server/github-session";
import { jsonError, notConnected } from "@/lib/server/responses";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await readGitHubSession();
  if (!session) return notConnected();

  const url = new URL(request.url);
  const owner = url.searchParams.get("owner") ?? "";
  const repository = url.searchParams.get("repository") ?? "";
  const number = Number(url.searchParams.get("number"));

  try {
    return Response.json(
      await loadPullDiffWithToken(
        session.tokenSet.accessToken,
        {
          number,
          owner,
          repository,
        },
        request.signal,
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
