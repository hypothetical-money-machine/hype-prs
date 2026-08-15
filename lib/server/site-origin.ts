const DEFAULT_ORIGIN = "http://localhost:3000";
// hostname[:port] only: no scheme, path, userinfo, comma, or whitespace.
const HOST_PATTERN = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i;

interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Resolve the canonical origin used for absolute metadata URLs. `SITE_URL` is
 * the source of truth; forwarded headers are client-controlled, so they are
 * validated and only used as a local development fallback. Never throws.
 */
export function resolveSiteOrigin(requestHeaders: HeaderReader): string {
  const configured = configuredOrigin(process.env.SITE_URL);
  if (configured) return configured;

  const host =
    firstValidHost(requestHeaders.get("x-forwarded-host")) ??
    firstValidHost(requestHeaders.get("host"));
  if (!host) return DEFAULT_ORIGIN;

  const protocol = forwardedProtocol(requestHeaders) ?? defaultProtocol(host);
  // HOST_PATTERN only checks shape, so an out-of-range port (":99999") still
  // reaches here. Round-trip through URL so callers never receive an origin
  // that `new URL()` would reject.
  return parseOrigin(`${protocol}://${host}`) ?? DEFAULT_ORIGIN;
}

function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function configuredOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function firstValidHost(value: string | null): string | null {
  // A proxy chain may comma-join the header; only the first entry is ours.
  const host = value?.split(",")[0]?.trim() ?? "";
  if (!HOST_PATTERN.test(host)) return null;
  // The pattern only checks shape, so an out-of-range port (":99999") still
  // gets here. Reject it so the next candidate header is tried.
  return parseOrigin(`https://${host}`) ? host : null;
}

function forwardedProtocol(requestHeaders: HeaderReader): string | null {
  const forwarded = requestHeaders.get("x-forwarded-proto");
  const protocol = forwarded?.split(",")[0]?.trim().toLowerCase() ?? "";
  return protocol === "http" || protocol === "https" ? protocol : null;
}

function defaultProtocol(host: string): string {
  const hostname = host.split(":")[0].toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1";
  return loopback ? "http" : "https";
}
