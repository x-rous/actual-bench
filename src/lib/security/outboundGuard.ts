import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * One check before Bench's server connects to an address a user typed: an
 * HTTP API server, a Direct Actual Server run on the server, an S3 endpoint
 * (F-194). Private LAN addresses and localhost stay allowed, because that is
 * where most self-hosted Actual servers live. What is always refused is the
 * cloud metadata endpoints: on a cloud host, `169.254.169.254` hands out the
 * machine's own credentials, and no Actual or S3 server lives there.
 *
 * The name is resolved and every address it resolves to is checked. A DNS
 * answer that changes between this check and the connection is not defended
 * against: sign-in already limits who can make Bench connect anywhere.
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

/** Throws `OutboundBlockedError` when the URL's host is, or resolves to, a refused address. */
export async function assertAllowedOutbound(url: string): Promise<void> {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return; // Not a URL: the request itself will fail and say so.
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new OutboundBlockedError(host);
    return;
  }
  if (await resolvesToBlocked(host)) throw new OutboundBlockedError(host);
}

const LOOKUP_CACHE_MS = 60_000;
const lookupCache = new Map<string, { blocked: boolean; until: number }>();

/**
 * Whether the name resolves to a refused address. Remembered for a minute per
 * name: every request to an HTTP API server passes through here, and a DNS
 * lookup each time would slow them all.
 */
async function resolvesToBlocked(host: string): Promise<boolean> {
  const now = Date.now();
  const cached = lookupCache.get(host);
  if (cached && cached.until > now) return cached.blocked;
  let blocked = false;
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    blocked = addresses.some(({ address }) => isBlockedAddress(address));
  } catch {
    // Unresolvable: the request fails with its own, clearer error.
  }
  if (lookupCache.size > 500) lookupCache.clear();
  lookupCache.set(host, { blocked, until: now + LOOKUP_CACHE_MS });
  return blocked;
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
    await assertAllowedOutbound(target);
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
