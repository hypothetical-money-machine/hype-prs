import type { InboxPayload } from "./types";

export const INBOX_CACHE_STORAGE_KEY = "hype-prs-inbox-cache-v1";
export const REFRESH_INTERVAL_STORAGE_KEY = "hype-prs-refresh-interval-ms-v1";

export type RefreshIntervalId =
  | "off"
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | "30m";

export interface RefreshIntervalOption {
  id: RefreshIntervalId;
  label: string;
  milliseconds: number | null;
}

export const REFRESH_INTERVAL_OPTIONS: readonly RefreshIntervalOption[] = [
  { id: "off", label: "Off", milliseconds: null },
  { id: "1m", label: "1 min", milliseconds: 60 * 1000 },
  { id: "2m", label: "2 min", milliseconds: 2 * 60 * 1000 },
  { id: "5m", label: "5 min", milliseconds: 5 * 60 * 1000 },
  { id: "15m", label: "15 min", milliseconds: 15 * 60 * 1000 },
  { id: "30m", label: "30 min", milliseconds: 30 * 60 * 1000 },
] as const;

interface CachedInboxEnvelope {
  payload: InboxPayload;
  savedAt: string;
}

const REFRESH_INTERVAL_IDS = new Set<RefreshIntervalId>(
  REFRESH_INTERVAL_OPTIONS.map((option) => option.id),
);

function isRefreshIntervalId(value: unknown): value is RefreshIntervalId {
  return typeof value === "string" && REFRESH_INTERVAL_IDS.has(value as RefreshIntervalId);
}

export function parseRefreshIntervalId(value: unknown): RefreshIntervalId {
  return isRefreshIntervalId(value) ? value : "off";
}

export function refreshIntervalMilliseconds(
  id: RefreshIntervalId,
): number | null {
  const option = REFRESH_INTERVAL_OPTIONS.find((entry) => entry.id === id);
  return option?.milliseconds ?? null;
}

export function readRefreshIntervalId(
  storage: Storage | null | undefined,
): RefreshIntervalId {
  if (!storage) return "off";
  let raw: string | null = null;
  try {
    raw = storage.getItem(REFRESH_INTERVAL_STORAGE_KEY);
  } catch {
    return "off";
  }
  return parseRefreshIntervalId(raw);
}

export function writeRefreshIntervalId(
  storage: Storage | null | undefined,
  id: RefreshIntervalId,
): void {
  if (!storage) return;
  try {
    storage.setItem(REFRESH_INTERVAL_STORAGE_KEY, id);
  } catch {
    // Storage may be unavailable in private browsing or when the quota is full.
  }
}

export function readInboxCache(
  storage: Storage | null | undefined,
): InboxPayload | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(INBOX_CACHE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as CachedInboxEnvelope;
    if (!envelope || typeof envelope !== "object") return null;
    const { payload } = envelope;
    if (!isInboxPayload(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function writeInboxCache(
  storage: Storage | null | undefined,
  payload: InboxPayload,
): void {
  if (!storage) return;
  try {
    const envelope: CachedInboxEnvelope = {
      payload,
      savedAt: new Date().toISOString(),
    };
    storage.setItem(INBOX_CACHE_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage may be unavailable or full; fall back to an in-memory render.
  }
}

export function clearInboxCache(storage: Storage | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(INBOX_CACHE_STORAGE_KEY);
  } catch {
    // Ignore storage failures; nothing else depends on the cached entry.
  }
}

function isInboxPayload(value: unknown): value is InboxPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InboxPayload>;
  if (!Array.isArray(candidate.pullRequests)) return false;
  if (typeof candidate.syncedAt !== "string") return false;
  if (!candidate.viewer || typeof candidate.viewer !== "object") return false;
  return true;
}
