import { getGitHubConfig, readGitHubSession } from "@/lib/server/github-session";
import { jsonError } from "@/lib/server/responses";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getGitHubConfig();

  try {
    const session = await readGitHubSession();

    return Response.json(
      {
        authKind: config.configured ? "redirect" : null,
        configured: config.configured,
        connected: Boolean(session),
        expiresAt: session?.tokenSet.expiresAt ?? null,
        mode: "web",
        viewer: session?.viewer ?? null,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    // A transient refresh failure must not read as "disconnected", which would
    // drop the user back to the login screen while the session is still valid.
    return jsonError(error);
  }
}
