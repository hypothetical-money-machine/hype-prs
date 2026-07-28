import {
  callbackUrl,
  getGitHubConfig,
  randomUrlSafe,
  sha256UrlSafe,
  writeOAuthTransaction,
} from "@/lib/server/github-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = getGitHubConfig();
  if (!config.configured) {
    return Response.redirect(
      new URL("/?connection=not-configured", request.url),
      303,
    );
  }

  const state = randomUrlSafe();
  const codeVerifier = randomUrlSafe(48);
  const codeChallenge = await sha256UrlSafe(codeVerifier);
  const redirectUri = callbackUrl(request);
  await writeOAuthTransaction({
    codeVerifier,
    createdAt: new Date().toISOString(),
    state,
  });

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  return Response.redirect(authorizeUrl, 303);
}
