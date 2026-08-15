import { loadInboxWithToken } from "@/shared/github-api.mjs";
import { readGitHubSession } from "@/lib/server/github-session";
import { jsonError, notConnected } from "@/lib/server/responses";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await readGitHubSession();
    if (!session) return notConnected();

    return Response.json(
      await loadInboxWithToken(session.tokenSet.accessToken, request.signal),
    );
  } catch (error) {
    return jsonError(error);
  }
}
