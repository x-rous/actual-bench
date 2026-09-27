import { isIP } from "node:net";

/**
 * One check before Bench's server connects to an address a user typed: an
 * HTTP API server, a Direct Actual Server run on the server, an S3 endpoint
 * (F-194). Private LAN addresses and localhost stay allowed, because that is
 * where most self-hosted Actual servers live. What is always refused is the
 * cloud metadata endpoints: on a cloud host, `169.254.169.254` hands out the
 * machine's own credentials, and no Actual or S3 server lives there.
 *
 * Checked: an address written as an IP, directly or in a redirect, which is how
 * these endpoints are reached in practice. A host *name* is not looked up: one
 * that resolves to a metadata address needs someone controlling its DNS, and
 * sign-in already limits who can make Bench connect anywhere. That keeps the
 * check free of lookups, caches and their timing.
 *
 * Node-only; must never be imported into client code.
 */

export class OutboundBlockedError extends Error {
  constructor(host: string) {
    super(
      `Actual Bench does not connect to ${host}: it is a cloud metadata address, where no Actual or storage server runs.`
    );
  }
}

/**
 * The cloud metadata endpoints, exactly. Not all of link-local: container
 * runtimes use it for the host (rootless Podman's `host.containers.internal`
 * is 169.254.1.2), which is exactly where an Actual server may run.
 */
const BLOCKED_IPV4 = new Set([
  "169.254.169.254", // AWS, GCP, Azure, Oracle, DigitalOcean, Hetzner, OpenStack
  "169.254.170.2", // AWS ECS task credentials
  "169.254.170.23", // AWS EKS pod identity
  "100.100.100.200", // Alibaba Cloud
]);
const BLOCKED_IPV6 = new Set(["fd00:ec2::254", "fd00:ec2::23"]); // AWS over IPv6

function ipv4Blocked(address: string): boolean {
  return BLOCKED_IPV4.has(address);
}

function ipv6Blocked(address: string): boolean {
  const lower = address.toLowerCase();
  // An IPv4 address inside IPv6, dotted (`::ffff:169.254.169.254`) or as the
  // URL parser writes it back (`::ffff:a9fe:a9fe`).
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return ipv4Blocked(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return ipv4Blocked(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return BLOCKED_IPV6.has(lower);
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4Blocked(address);
  if (family === 6) return ipv6Blocked(address);
  return false;
}

/** Throws `OutboundBlockedError` when the URL's host is a refused IP address. */
export function assertAllowedOutbound(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return; // Not a URL: the request itself will fail and say so.
  }
  if (isBlockedAddress(host)) throw new OutboundBlockedError(host);
}

const MAX_REDIRECTS = 5;

/**
 * `fetch` for an address a user typed, checked before connecting and again at
 * every redirect, so a server can't bounce Bench on to a refused address.
 *
 * A redirect is followed only on the same host, and never from https to http:
 * these requests carry an API key or a budget password, which must not go to
 * another server or travel unencrypted. `http://host` to `https://host` is
 * fine. Any other redirect is handed back as it is.
 */
export async function guardedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let target = url;
  let options = init;
  for (let hop = 0; ; hop += 1) {
    assertAllowedOutbound(target);
    const response = await fetch(target, { ...options, redirect: "manual" });
    if (response.status < 300 || response.status >= 400 || hop >= MAX_REDIRECTS) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const from = new URL(target);
    const next = new URL(location, from);
    if (next.hostname !== from.hostname || (from.protocol === "https:" && next.protocol !== "https:")) {
      return response;
    }
    target = next.toString();
    const method = (options.method ?? "GET").toUpperCase();
    // As fetch itself does: a 303, or a 301/302 after a POST, continues as GET.
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      options = { ...options, method: "GET", body: undefined };
    }
  }
}

/**
 * A redirect `guardedFetch` didn't follow (to another server, or from https to
 * http): say where it points, so the address can be corrected in Bench.
 */
export function unfollowedRedirectMessage(response: Response): string | null {
  if (response.status < 300 || response.status >= 400) return null;
  const location = response.headers.get("location");
  return location
    ? `The server redirected to ${location}. Actual Bench doesn't send your credentials on to another address; use that address for this connection instead.`
    : `The server answered with a redirect (HTTP ${response.status}).`;
}
