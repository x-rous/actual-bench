import { NextResponse } from "next/server";
import { DIRECT_MODE_HEADERS, isDirectBrowserApiEnabled } from "@/lib/directMode";

function applyDirectModeHeaders(response: NextResponse): void {
  for (const [key, value] of Object.entries(DIRECT_MODE_HEADERS)) {
    response.headers.set(key, value);
  }
}

export function proxy() {
  const response = NextResponse.next();

  if (isDirectBrowserApiEnabled()) {
    applyDirectModeHeaders(response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api/).*)"],
};

// Note: in Next.js 16 the Proxy (middleware) always runs on the Node.js
// runtime, so it reads the same server-side runtime env (`DIRECT_BROWSER_API`)
// as the rest of the app — which is why a single variable is sufficient.
