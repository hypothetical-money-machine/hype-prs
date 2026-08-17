// Error thrown by the browser-side gateway when a /api/github/* request
// fails. It preserves the server's typed error envelope so callers can
// branch on the machine-readable code (for example `not_connected` should
// flip the UI to the connect state, while a 5xx is retryable) instead of
// pattern-matching the human-readable message.
export class GatewayError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, code: string | null, status: number) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
  }
}

export function isRetryableGatewayError(error: unknown): boolean {
  return error instanceof GatewayError && error.status >= 500;
}
