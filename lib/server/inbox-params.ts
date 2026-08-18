// Pure parsing/validation for /api/github/inbox search parameters, kept out
// of the route file so it can be unit tested without a request scope.

export const DEFAULT_PER_BUCKET = 50;
const MAX_PER_BUCKET = 50;
const MIN_PER_BUCKET = 1;
const PAGE_PER_BUCKET: Record<1 | 2, number> = { 1: 25, 2: 25 };

export const CURSOR_BUCKETS = [
  "authored",
  "assigned",
  "reviewRequested",
  "reviewed",
] as const;
export type CursorBucket = (typeof CURSOR_BUCKETS)[number];

export type InboxRequest =
  | { kind: "invalid" }
  | { kind: "full-inbox" }
  | {
      cursors: Partial<Record<CursorBucket, string>>;
      kind: "page";
      perBucket: number;
    };

export function parseInboxRequest(params: URLSearchParams): InboxRequest {
  const pageRaw = params.get("page");
  if (pageRaw !== null) {
    const page = asInteger(pageRaw);
    if (page !== 1 && page !== 2) return { kind: "invalid" };
    return {
      cursors: readCursors(params),
      kind: "page",
      perBucket: PAGE_PER_BUCKET[page],
    };
  }

  const perBucketRaw = params.get("perBucket");
  const perBucket =
    perBucketRaw === null ? DEFAULT_PER_BUCKET : asInteger(perBucketRaw);
  if (
    perBucket === null ||
    perBucket < MIN_PER_BUCKET ||
    perBucket > MAX_PER_BUCKET
  ) {
    return { kind: "invalid" };
  }
  if (perBucket === DEFAULT_PER_BUCKET) return { kind: "full-inbox" };
  return { cursors: readCursors(params), kind: "page", perBucket };
}

function readCursors(
  params: URLSearchParams,
): Partial<Record<CursorBucket, string>> {
  const cursors: Partial<Record<CursorBucket, string>> = {};
  for (const bucket of CURSOR_BUCKETS) {
    const cursor = params.get(`${bucket}After`);
    if (cursor) cursors[bucket] = cursor;
  }
  return cursors;
}

function asInteger(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null;
  return Number(value);
}
