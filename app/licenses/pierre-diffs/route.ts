import license from "../../../node_modules/@pierre/diffs/LICENSE.md?raw";

export function GET() {
  return new Response(license, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
