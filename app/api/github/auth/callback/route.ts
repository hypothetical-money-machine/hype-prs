import {
  exchangeAuthorizationCode,
  getViewerWithToken,
} from "@/shared/github-api.mjs";
import {
  githubAuthFailureDetails,
  type GitHubAuthStage,
} from "@/lib/server/github-auth-logging";
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
  const transactionAgeMs = transaction
    ? Date.now() - new Date(transaction.createdAt).getTime()
    : null;
  const rejectionReasons = [
    error ? "github_returned_error" : null,
    !config.configured ? "server_not_configured" : null,
    !code ? "missing_authorization_code" : null,
    !state ? "missing_state" : null,
    !transaction ? "missing_or_invalid_oauth_transaction" : null,
    transactionAgeMs !== null && transactionAgeMs > 10 * 60 * 1000
      ? "oauth_transaction_expired"
      : null,
  ].filter((reason): reason is string => Boolean(reason));

  if (rejectionReasons.length > 0 || !code || !transaction) {
    console.warn("[github-auth] OAuth callback rejected before token exchange", {
      githubError: safeOAuthErrorCode(error),
      reasons: rejectionReasons,
      transactionAgeMs,
    });
    return Response.redirect(
      new URL("/?connection=failed", request.url),
      303,
    );
  }

  let stage: GitHubAuthStage = "exchange_authorization_code";
  try {
    const tokenSet = await exchangeAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      codeVerifier: transaction.codeVerifier,
      redirectUri: callbackUrl(request),
    });
    stage = "load_authenticated_viewer";
    const viewer = await getViewerWithToken(tokenSet.accessToken);
    stage = "write_encrypted_session";
    await writeGitHubSession({ tokenSet, viewer });
    return Response.redirect(
      new URL("/?connection=connected", request.url),
      303,
    );
  } catch (error) {
    console.error(
      "[github-auth] OAuth callback failed",
      githubAuthFailureDetails(stage, error),
    );
    return Response.redirect(
      new URL("/?connection=failed", request.url),
      303,
    );
  }
}

function safeOAuthErrorCode(value: string | null): string | null {
  if (!value) return null;
  return /^[a-z0-9_]{1,64}$/i.test(value) ? value : "unrecognized_error";
}
