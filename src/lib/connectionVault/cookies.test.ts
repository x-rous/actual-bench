import { NextRequest, NextResponse } from "next/server";
import { VAULT_COOKIE, clearSessionCookie, setSessionCookie } from "./cookies";

function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

function setCookieHeader(response: NextResponse): string {
  return response.headers.get("set-cookie") ?? "";
}

describe("vault session cookie", () => {
  it("is Secure, HttpOnly and SameSite=Strict over HTTPS", () => {
    const response = NextResponse.json({});
    setSessionCookie(request("https://bench.example/api/x"), response, "token");
    const header = setCookieHeader(response);
    expect(header).toContain(`${VAULT_COOKIE}=token`);
    expect(header).toMatch(/; Secure/i);
    expect(header).toMatch(/; HttpOnly/i);
    expect(header).toMatch(/; SameSite=Strict/i);
    expect(header).toMatch(/; Path=\//i);
  });

  it("is Secure behind a proxy that terminated HTTPS", () => {
    const response = NextResponse.json({});
    setSessionCookie(request("http://bench:3000/api/x", { "x-forwarded-proto": "https" }), response, "token");
    expect(setCookieHeader(response)).toMatch(/; Secure/i);
  });

  it("still works over plain HTTP on a LAN", () => {
    const response = NextResponse.json({});
    setSessionCookie(request("http://192.168.1.20:3000/api/x"), response, "token");
    const header = setCookieHeader(response);
    expect(header).toContain(`${VAULT_COOKIE}=token`);
    expect(header).not.toMatch(/; Secure/i);
  });

  it("is cleared with the attributes it was set with", () => {
    const response = NextResponse.json({});
    clearSessionCookie(request("https://bench.example/api/x"), response);
    const header = setCookieHeader(response);
    expect(header).toMatch(/Max-Age=0/i);
    expect(header).toMatch(/; Secure/i);
    expect(header).toMatch(/; HttpOnly/i);
    expect(header).toMatch(/; SameSite=Strict/i);
  });
});
