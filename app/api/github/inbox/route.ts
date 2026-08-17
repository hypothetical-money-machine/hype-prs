import {
  loadInboxPageWithToken,
  loadInboxWithToken,
} from "@/shared/github-api.mjs";
import { readGitHubSession } from "@/lib/server/github-session";
import { jsonError, notConnected } from "@/lib/server/responses";

export const dynamic = "force-dynamic";

const DEFAULT_PER_BUCKET = 50;
const MAX_PER_BUCKET = 50;
const MIN_PER_BUCKET = 1;
const PAGE_PER_BUCKET: Record<1 | 2, number> = { 1: 25, 2: 25 };
const CURSOR_BUCKETS = [
  "authored",
  "assigned",
  "reviewRequested",
  "reviewed",
] as const;
type CursorBucket = (typeof CURSOR_BUCKETS)[number];

function asInteger(value: string | null): number | null {
  if (value === null) return null;
  if (!/^-?\d+$/.test(value)) return null;
  return Number(value);
}

export async function GET(request: Request) {
  try {
    const session = await readGitHubSession();
    if (!session) return notConnected();

    const url = new URL(request.url);
    const params = url.searchParams;
    const pageParam = asInteger(params.get("page"));
    if (pageParam === 1 || pageParam === 2) {
      const perBucket = PAGE_PER_BUCKET[pageParam];
      const cursors: Partial<Record<CursorBucket, string>> = {};
      for (const bucket of CURSOR_BUCKETS) {
        const cursor = params.get(`${bucket}After`);
        if (cursor) cursors[bucket] = cursor;
      }
      return Response.json(
        await loadInboxPageWithToken(
          session.tokenSet.accessToken,
          { perBucket, cursors },
          request.signal,
        ),
      );
    }

    const perBucketRaw = asInteger(params.get("perBucket")) ?? DEFAULT_PER_BUCKET;
    if (
      perBucketRaw < MIN_PER_BUCKET ||
      perBucketRaw > MAX_PER_BUCKET
    ) {
      return jsonError(
        Object.assign(new Error("Invalid inbox pagination parameters."), {
          code: "invalid_pagination",
          status: 400,
        }),
      );
    }
    if (perBucketRaw === DEFAULT_PER_BUCKET) {
      return Response.json(
        await loadInboxWithToken(session.tokenSet.accessToken, request.signal),
      );
    }
    const cursors: Partial<Record<CursorBucket, string>> = {};
    for (const bucket of CURSOR_BUCKETS) {
      const cursor = params.get(`${bucket}After`);
      if (cursor) cursors[bucket] = cursor;
    }
    return Response.json(
      await loadInboxPageWithToken(
        session.tokenSet.accessToken,
        { perBucket: perBucketRaw, cursors },
        request.signal,
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
