"use client";

import { mapInboxPayload, mergeInboxPageBuckets } from "@/shared/inbox-mapping.mjs";
import { GatewayError } from "./gateway-error";
import type { InboxPayload } from "./types";
import type { InboxPage, InboxPageBucketPageInfoMap } from "./inbox-page-types";

const PAGE_ONE_PER_BUCKET = 25;

export interface FetchInboxPageOptions {
  page: 1 | 2;
  cursors?: Partial<InboxPageBucketPageInfoMap>;
  fetchImpl?: typeof fetch;
  origin?: string;
  signal?: AbortSignal;
}

export interface PageLoadResult {
  page: InboxPage;
  perBucket: number;
}

export async function fetchInboxPage(
  options: FetchInboxPageOptions,
): Promise<PageLoadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin =
    options.origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const url = new URL("/api/github/inbox", origin || "http://localhost");
  url.searchParams.set("page", String(options.page));
  if (options.cursors) {
    for (const [bucket, info] of Object.entries(options.cursors)) {
      if (info?.endCursor) {
        url.searchParams.set(`${bucket}After`, info.endCursor);
      }
    }
  }
  const response = await fetchImpl(url.toString(), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new GatewayError(
      errorPayload?.error?.message ?? `Request failed (${response.status}).`,
      errorPayload?.error?.code ?? null,
      response.status,
    );
  }
  return {
    page: (await response.json()) as InboxPage,
    perBucket: PAGE_ONE_PER_BUCKET,
  };
}

export interface BuildMappedInboxInput {
  pages: InboxPage[];
  syncedAt?: string;
}

export function buildMappedInbox({
  pages,
  syncedAt,
}: BuildMappedInboxInput): InboxPayload | null {
  if (pages.length === 0) return null;
  const viewer = pages[pages.length - 1].viewer;
  if (!viewer) return null;
  const merged = mergeInboxPageBuckets(...pages);
  const data = {
    authored: { nodes: merged.buckets.authored },
    assigned: { nodes: merged.buckets.assigned },
    reviewRequested: { nodes: merged.buckets.reviewRequested },
    reviewed: { nodes: merged.buckets.reviewed },
    rateLimit: merged.rateLimit,
  };
  const mapped = mapInboxPayload(data, viewer, merged.warnings);
  if (syncedAt) mapped.syncedAt = syncedAt;
  return mapped;
}
