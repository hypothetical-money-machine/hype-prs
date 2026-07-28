import { getGitHubConfig, readGitHubSession } from "@/lib/server/github-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getGitHubConfig();
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
}
