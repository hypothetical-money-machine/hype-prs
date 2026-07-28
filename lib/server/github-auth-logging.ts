import { GitHubApiError } from "../../shared/github-api.mjs";

export type GitHubAuthStage =
  | "exchange_authorization_code"
  | "load_authenticated_viewer"
  | "write_encrypted_session";

export function githubAuthFailureDetails(
  stage: GitHubAuthStage,
  error: unknown,
) {
  if (error instanceof GitHubApiError) {
    return {
      errorCode: error.code,
      errorMessage: error.message,
      errorName: error.name,
      githubMessage: error.githubMessage,
      httpStatus: error.status,
      requestId: error.requestId,
      stage,
    };
  }

  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
    stage,
  };
}
