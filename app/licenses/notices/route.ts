import notices from "../../../THIRD_PARTY_NOTICES.md?raw";

export function GET() {
  return new Response(notices, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
