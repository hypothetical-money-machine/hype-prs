import {
  assertSameOrigin,
  clearGitHubSession,
} from "@/lib/server/github-session";
import { invalidOrigin } from "@/lib/server/responses";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return invalidOrigin();
  await clearGitHubSession();
  return new Response(null, { status: 204 });
}
