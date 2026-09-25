export const dynamic = "force-dynamic";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * RFC 9116 `security.txt`. A route rather than a static file because the RFC
 * requires an `Expires` date, and a file baked into an image would go stale
 * on every install that doesn't upgrade. Points at the project, never at a
 * deployment: every self-hosted instance serves the same text.
 */
export function GET() {
  const expires = new Date(Date.now() + YEAR_MS).toISOString();
  const body = [
    "Contact: https://github.com/x-rous/actual-bench/security/advisories/new",
    `Expires: ${expires}`,
    "Policy: https://github.com/x-rous/actual-bench/blob/main/SECURITY.md",
    "Preferred-Languages: en",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
