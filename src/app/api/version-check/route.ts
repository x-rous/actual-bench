import { NextResponse } from "next/server";

const RELEASES_URL = "https://api.github.com/repos/x-rous/actual-bench/releases/latest";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cached: { latestVersion: string; fetchedAt: number } | null = null;

export async function GET() {
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ currentVersion, latestVersion: cached.latestVersion });
  }

  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);

    const data = (await res.json()) as { tag_name?: string };
    const latestVersion = (data.tag_name ?? "").replace(/^v/, "");
    if (!latestVersion) throw new Error("Empty tag_name");

    cached = { latestVersion, fetchedAt: Date.now() };
    return NextResponse.json({ currentVersion, latestVersion });
  } catch {
    // Return current version as latest so the client doesn't show a false alert.
    return NextResponse.json({ currentVersion, latestVersion: currentVersion });
  }
}
