import { submitReviewWithToken } from "@/shared/github-api.mjs";
import {
  assertSameOrigin,
  readGitHubSession,
} from "@/lib/server/github-session";
import {
  invalidOrigin,
  invalidRequest,
  jsonError,
  notConnected,
} from "@/lib/server/responses";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return invalidOrigin();

  try {
    const session = await readGitHubSession();
    if (!session) return notConnected();

    let input;
    try {
      input = await request.json();
    } catch (error) {
      // An aborted body read is not a malformed body; let it reach jsonError.
      if (request.signal.aborted) throw error;
      return invalidRequest();
    }

    return Response.json(
      await submitReviewWithToken(
        session.tokenSet.accessToken,
        input,
        request.signal,
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
