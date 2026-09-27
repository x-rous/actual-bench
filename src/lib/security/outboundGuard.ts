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
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return ipv4Blocked(mapped[1]);
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
    target = new URL(location, target).toString();
    const method = (options.method ?? "GET").toUpperCase();
    // As fetch itself does: a 303, or a 301/302 after a POST, continues as GET.
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      options = { ...options, method: "GET", body: undefined };
    }
  }
}
