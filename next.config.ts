import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8")
) as { version?: string };

const nextConfig: NextConfig = {
  // Emit a self-contained standalone server (server.js + only the traced
  // runtime node_modules) so the Docker runtime image doesn't carry the full
  // production dependency tree. Output lands in `${distDir}/standalone`.
  output: "standalone",
  // Enable React Compiler via the Turbopack/SWC-native path (top-level in
  // Next.js 16 — promoted out of experimental).
  // babel-plugin-react-compiler remains in devDependencies for Jest only.
  reactCompiler: true,
  // Use a fresh output directory so Turbopack doesn't try to acquire a
  // lockfile on the root-owned .next/dev/cache from a prior container run.
  // Exception: on Vercel, use the default ".next" — Vercel's Next.js builder
  // hard-expects ".next" and fails to locate a custom distDir, so the demo
  // deployment needs the standard path. CI/Docker keep ".next-build".
  distDir: process.env.VERCEL ? ".next" : ".next-build",
  // Allow the reverse-proxy hostname to reach dev-server infrastructure
  // (HMR, dev overlay, etc.). Without this, Next.js 16 blocks cross-origin
  // requests from origins other than localhost, preventing React from fully
  // hydrating behind a reverse proxy in dev mode.
  // Comma-separated list of hostnames allowed to reach the dev server's HMR
  // websocket. Set NEXT_DEV_ALLOWED_ORIGINS in .env.local when running behind
  // a reverse proxy (e.g. Traefik). Not needed for plain localhost.
  allowedDevOrigins: (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
  // Inject package.json version at build time so the UI always reflects the
  // current release without needing it set in .env files.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version ?? "0.0.0",
  },
};

export default nextConfig;