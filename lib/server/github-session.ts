import { cookies } from "next/headers";
import {
  GitHubApiError,
  refreshUserToken,
  tokenSetNeedsRefresh,
  type TokenSet,
} from "../../shared/github-api.mjs";
import type { PullRequestActor } from "../types";

const AUTH_COOKIE = "hype_github_session";
const OAUTH_COOKIE = "hype_github_oauth";
const FALLBACK_SESSION_SECONDS = 30 * 24 * 60 * 60;

export interface GitHubSession {
  tokenSet: TokenSet;
  viewer: PullRequestActor;
}

interface OAuthTransaction {
  codeVerifier: string;
  createdAt: string;
  state: string;
}

export function getGitHubConfig() {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim() ?? "";
  const sessionSecret = process.env.SESSION_SECRET?.trim() ?? "";

  return {
    clientId,
    clientSecret,
    configured: Boolean(
      clientId && clientSecret && hasStrongSecret(sessionSecret),
    ),
    sessionSecret,
  };
}

export async function readGitHubSession(): Promise<GitHubSession | null> {
  const config = getGitHubConfig();
  if (!config.configured) return null;

  const cookieStore = await cookies();
  const sealed = cookieStore.get(AUTH_COOKIE)?.value;
  if (!sealed) return null;

  const session = await unseal<GitHubSession>(sealed, config.sessionSecret);
  if (!session?.tokenSet?.accessToken || !session.viewer?.login) {
    return null;
  }

  if (!tokenSetNeedsRefresh(session.tokenSet)) return session;
  if (!session.tokenSet.refreshToken) return null;

  try {
    const tokenSet = await refreshUserToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: session.tokenSet.refreshToken,
    });
    const refreshed = { tokenSet, viewer: session.viewer };
    await writeGitHubSession(refreshed);
    return refreshed;
  } catch (error) {
    if (
      error instanceof GitHubApiError &&
      ["bad_refresh_token", "expired_refresh_token"].includes(error.code)
    ) {
      // A parallel request may already have rotated this one-time refresh
      // token and set a newer cookie. Do not emit a deletion cookie from the
      // losing response, because it could overwrite that valid session.
      return null;
    }
    throw error;
  }
}

export async function writeGitHubSession(
  session: GitHubSession,
): Promise<void> {
  const sessionSecret = requireStrongSecret();
  const cookieStore = await cookies();
  const maxAge = sessionCookieMaxAge(session.tokenSet);
  cookieStore.set(AUTH_COOKIE, await seal(session, sessionSecret), {
    ...cookieOptions("/"),
    maxAge,
  });
}

export function sessionCookieMaxAge(
  tokenSet: TokenSet,
  now = Date.now(),
): number {
  const tokenExpiry =
    tokenSet.refreshTokenExpiresAt ?? tokenSet.expiresAt ?? null;
  return tokenExpiry
    ? secondsUntil(tokenExpiry, now)
    : FALLBACK_SESSION_SECONDS;
}

export async function clearGitHubSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, "", {
    ...cookieOptions("/"),
    expires: new Date(0),
  });
}

export async function writeOAuthTransaction(
  transaction: OAuthTransaction,
): Promise<void> {
  const sessionSecret = requireStrongSecret();
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_COOKIE, await seal(transaction, sessionSecret), {
    ...cookieOptions("/api/github/auth"),
    maxAge: 10 * 60,
  });
}

export async function takeOAuthTransaction(
  expectedState: string,
): Promise<OAuthTransaction | null> {
  const { sessionSecret } = getGitHubConfig();
  if (!sessionSecret) return null;

  const cookieStore = await cookies();
  const sealed = cookieStore.get(OAUTH_COOKIE)?.value;
  if (!sealed) return null;
  const transaction = await unseal<OAuthTransaction>(sealed, sessionSecret);
  if (!transaction || transaction.state !== expectedState) return null;

  cookieStore.set(OAUTH_COOKIE, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/api/github/auth",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return transaction;
}

export function callbackUrl(request: Request): string {
  const configured = process.env.GITHUB_CALLBACK_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    const isDevelopmentLoopback =
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !isDevelopmentLoopback) ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new Error(
        "GITHUB_CALLBACK_URL must be HTTPS, except for local development loopback URLs.",
      );
    }
    return url.toString();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("GITHUB_CALLBACK_URL is required in production.");
  }
  return `${new URL(request.url).origin}/api/github/auth/callback`;
}

export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    origin === new URL(request.url).origin &&
    (!fetchSite || fetchSite === "same-origin")
  );
}

export function randomUrlSafe(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toBase64Url(bytes);
}

export async function sha256UrlSafe(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toBase64Url(new Uint8Array(digest));
}

function hasStrongSecret(secret: string): boolean {
  return new TextEncoder().encode(secret).byteLength >= 32;
}

function requireStrongSecret(): string {
  const { sessionSecret } = getGitHubConfig();
  if (!hasStrongSecret(sessionSecret)) {
    throw new Error("Session encryption is not configured.");
  }
  return sessionSecret;
}

function cookieOptions(path: string): {
  httpOnly: boolean;
  path: string;
  sameSite: "lax";
  secure: boolean;
} {
  return {
    httpOnly: true,
    path,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
}

async function seal(value: unknown, secret: string): Promise<string> {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    key,
    encoded,
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return toBase64Url(combined);
}

async function unseal<T>(value: string, secret: string): Promise<T | null> {
  try {
    const combined = fromBase64Url(value);
    if (combined.length < 13) return null;
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const key = await encryptionKey(secret);
    const decrypted = await crypto.subtle.decrypt(
      { iv, name: "AES-GCM" },
      key,
      encrypted,
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch {
    return null;
  }
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function secondsUntil(value: string, now = Date.now()): number {
  return Math.max(
    60,
    Math.floor((new Date(value).getTime() - now) / 1000),
  );
}
