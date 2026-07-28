import { submitReviewWithToken } from "@/shared/github-api.mjs";
import {
  assertSameOrigin,
  readGitHubSession,
} from "@/lib/server/github-session";
import {
  invalidOrigin,
  jsonError,
  notConnected,
} from "@/lib/server/responses";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return invalidOrigin();
  const session = await readGitHubSession();
  if (!session) return notConnected();

  try {
    const input = await request.json();
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
