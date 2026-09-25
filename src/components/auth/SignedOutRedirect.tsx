"use client";

import { useEffect } from "react";
import { fullPageLoad } from "@/lib/auth/fullPageLoad";

const MARK = "__benchSignedOutWatch";

/**
 * When a session ends while the app is open (it timed out, or the password was
 * changed elsewhere), Bench's own API answers 401 with `X-Bench-Auth`. Any such
 * answer, from any request, takes the user to sign in and back (RD-096),
 * instead of every feature reporting its own failure. The header tells it apart
 * from a budget server's 401, which the HTTP API proxy passes through.
 */
export function SignedOutRedirect() {
  useEffect(() => {
    const target = window as unknown as Record<string, unknown>;
    if (target[MARK]) return;
    target[MARK] = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      if (
        response.status === 401 &&
        response.headers.get("x-bench-auth") === "signed-out" &&
        window.location.pathname !== "/login"
      ) {
        const next = `${window.location.pathname}${window.location.search}`;
        // A full load: this runs outside React, from whichever request noticed first.
        fullPageLoad(`/login?next=${encodeURIComponent(next)}`);
      }
      return response;
    };
  }, []);

  return null;
}
