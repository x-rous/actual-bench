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
