"use client";

import dynamic from "next/dynamic";

/**
 * Vercel Web Analytics — used ONLY on the hosted public demo.
 *
 * Gated on the build-time flag `NEXT_PUBLIC_ANALYTICS`, which is set exclusively
 * on the Vercel demo deployment. In every other build (self-hosted, Docker, CI)
 * the flag is unset, so `ENABLED` folds to `false` and the dynamic `import()`
 * below is dead-code-eliminated during minification: `@vercel/analytics` is
 * never bundled, no script loads, and no network request is ever made.
 *
 * In other words: self-hosters ship none of this and are never tracked.
 */
const ENABLED = process.env.NEXT_PUBLIC_ANALYTICS === "1";

const Analytics = ENABLED
  ? dynamic(() => import("@vercel/analytics/next").then((m) => m.Analytics))
  : () => null;

export function DemoAnalytics() {
  return <Analytics />;
}
