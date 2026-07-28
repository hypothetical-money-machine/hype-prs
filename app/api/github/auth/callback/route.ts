import {
  exchangeAuthorizationCode,
  getViewerWithToken,
} from "@/shared/github-api.mjs";
import {
  callbackUrl,
  getGitHubConfig,
  takeOAuthTransaction,
  writeGitHubSession,
} from "@/lib/server/github-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const transaction = state ? await takeOAuthTransaction(state) : null;
  const config = getGitHubConfig();

  if (
    error ||
    !config.configured ||
    !code ||
    !state ||
    !transaction ||
    Date.now() - new Date(transaction.createdAt).getTime() > 10 * 60 * 1000
  ) {
    return Response.redirect(
      new URL("/?connection=failed", request.url),
      303,
    );
  }

  try {
    const tokenSet = await exchangeAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      codeVerifier: transaction.codeVerifier,
      redirectUri: callbackUrl(request),
    });
    const viewer = await getViewerWithToken(tokenSet.accessToken);
    await writeGitHubSession({ tokenSet, viewer });
    return Response.redirect(
      new URL("/?connection=connected", request.url),
      303,
    );
  } catch {
    return Response.redirect(
      new URL("/?connection=failed", request.url),
      303,
    );
  }
}
