import { publicError } from "../../shared/github-api.mjs";

export function jsonError(error: unknown): Response {
  const safe = publicError(error);
  return Response.json(
    { error: { code: safe.code, message: safe.message } },
    { status: safe.status },
  );
}

export function notConnected(): Response {
  return Response.json(
    {
      error: {
        code: "not_connected",
        message: "Connect GitHub to continue.",
      },
    },
    { status: 401 },
  );
}

export function invalidOrigin(): Response {
  return Response.json(
    {
      error: {
        code: "invalid_origin",
        message: "The request origin was rejected.",
      },
    },
    { status: 403 },
  );
}

export function invalidRequest(): Response {
  return Response.json(
    {
      error: {
        code: "invalid_request",
        message: "The request body was not valid JSON.",
      },
    },
    { status: 400 },
  );
}
