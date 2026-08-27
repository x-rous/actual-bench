import { createHash, randomBytes } from "node:crypto";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import type { S3Credentials } from "@/lib/app-db/backupCredentialRepository";
import { EMPTY_PAYLOAD_SHA256, encodeS3Path, signS3Request } from "./sigv4";
import {
  DestinationError,
  type DestinationAdapter,
  type DestinationCheck,
  type DestinationFacts,
  type DestinationTestResult,
  type StoredObject,
} from "./types";

/**
 * An S3-compatible destination (RD-077 / PR-047b).
 *
 * "S3-compatible" rather than "AWS S3" throughout: the same four verbs reach
 * MinIO on a NAS, Backblaze B2, Cloudflare R2, Wasabi and Garage, and for a
 * self-hosted budget tool those are more likely than AWS itself. Nothing here
 * assumes an amazonaws.com hostname, and path-style addressing is the default
 * whenever a custom endpoint is given, because most of those providers need it.
 */

export type S3DestinationConfig = {
  bucket: string;
  region: string;
  endpoint: string | null;
  prefix: string;
  forcePathStyle: boolean;
  storageClass: string | null;
};

export function readS3Config(destination: BackupDestination): S3DestinationConfig {
  const data = destination.config.data as Record<string, unknown>;
  const bucket = typeof data.bucket === "string" ? data.bucket.trim() : "";
  if (!bucket) throw new DestinationError("This destination has no bucket configured.");
  const endpoint = typeof data.endpoint === "string" && data.endpoint.trim() ? data.endpoint.trim() : null;
  return {
    bucket,
    region: typeof data.region === "string" && data.region.trim() ? data.region.trim() : "us-east-1",
    endpoint,
    prefix: normalizePrefix(typeof data.prefix === "string" ? data.prefix : ""),
    // Custom endpoints are overwhelmingly path-style; virtual-host style against
    // a self-hosted MinIO needs wildcard DNS that almost nobody sets up.
    forcePathStyle: data.forcePathStyle === undefined ? endpoint !== null : data.forcePathStyle === true,
    storageClass:
      typeof data.storageClass === "string" && data.storageClass.trim() ? data.storageClass.trim() : null,
  };
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed ? `${trimmed}/` : "";
}

/** Read a single XML element's text, without pulling in a parser. */
function tagValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export class S3DestinationAdapter implements DestinationAdapter {
  readonly kind = "s3" as const;
  readonly destinationId: string;
  readonly name: string;
  private readonly config: S3DestinationConfig;
  private readonly credentials: S3Credentials;

  constructor(destination: BackupDestination, credentials: S3Credentials) {
    this.destinationId = destination.id;
    this.name = destination.name;
    this.config = readS3Config(destination);
    this.credentials = credentials;
  }

  private get host(): string {
    if (this.config.endpoint) {
      const url = new URL(
        this.config.endpoint.includes("://") ? this.config.endpoint : `https://${this.config.endpoint}`
      );
      return this.config.forcePathStyle ? url.host : `${this.config.bucket}.${url.host}`;
    }
    return this.config.forcePathStyle
      ? `s3.${this.config.region}.amazonaws.com`
      : `${this.config.bucket}.s3.${this.config.region}.amazonaws.com`;
  }

  private get scheme(): string {
    if (!this.config.endpoint) return "https";
    if (!this.config.endpoint.includes("://")) return "https";
    return new URL(this.config.endpoint).protocol.replace(":", "");
  }

  /** Full object key including the configured prefix. */
  private fullKey(key: string): string {
    return `${this.config.prefix}${key.replace(/^\/+/, "")}`;
  }

  private async send(options: {
    method: string;
    key?: string;
    query?: Record<string, string | undefined>;
    body?: Uint8Array;
    extraHeaders?: Record<string, string>;
    expectMissing?: boolean;
  }): Promise<Response> {
    const objectPath = options.key === undefined ? "" : encodeS3Path(this.fullKey(options.key));
    const path = this.config.forcePathStyle
      ? `/${this.config.bucket}${objectPath}`
      : objectPath || "/";

    const body = options.body;
    const payloadSha256 = body
      ? createHash("sha256").update(body).digest("hex")
      : EMPTY_PAYLOAD_SHA256;

    const headers: Record<string, string> = { host: this.host, ...options.extraHeaders };
    if (body) headers["content-length"] = String(body.byteLength);

    const signed = signS3Request({
      method: options.method,
      path,
      query: options.query,
      headers,
      payloadSha256,
      region: this.config.region,
      credentials: this.credentials,
    });

    const query = Object.entries(options.query ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    );
    const search = query.length
      ? `?${query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
      : "";
    const url = `${this.scheme}://${this.host}${path}${search}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers: signed.headers,
        body: body ? Buffer.from(body) : undefined,
      });
    } catch (error) {
      throw new DestinationError(
        `Could not reach ${this.host}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, retryable: true }
      );
    }

    if (response.ok) return response;
    if (options.expectMissing && (response.status === 404 || response.status === 403)) return response;

    const text = await response.text().catch(() => "");
    const code = tagValue(text, "Code");
    const message = tagValue(text, "Message");
    throw new DestinationError(
      `${options.method} failed with ${response.status}${code ? ` (${code})` : ""}${
        message ? `: ${message}` : ""
      }`,
      // 5xx and throttling are worth retrying; a 403 will be a 403 forever.
      { retryable: response.status >= 500 || response.status === 429 }
    );
  }

  async put(key: string, bytes: Uint8Array, contentType = "application/octet-stream"): Promise<StoredObject> {
    const extraHeaders: Record<string, string> = { "content-type": contentType };
    if (this.config.storageClass) extraHeaders["x-amz-storage-class"] = this.config.storageClass;
    await this.send({ method: "PUT", key, body: bytes, extraHeaders });
    return { key, sizeBytes: bytes.byteLength, lastModified: new Date().toISOString() };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.send({ method: "GET", key });
    return Buffer.from(await response.arrayBuffer());
  }

  async head(key: string): Promise<StoredObject | null> {
    const response = await this.send({ method: "HEAD", key, expectMissing: true });
    if (!response.ok) return null;
    const size = Number(response.headers.get("content-length") ?? "0");
    const modified = response.headers.get("last-modified");
    return {
      key,
      sizeBytes: Number.isFinite(size) ? size : 0,
      lastModified: modified ? new Date(modified).toISOString() : null,
    };
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const results: StoredObject[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.send({
        method: "GET",
        query: {
          "list-type": "2",
          prefix: `${this.config.prefix}${prefix}`,
          "max-keys": "1000",
          "continuation-token": continuationToken,
        },
      });
      const xml = await response.text();

      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const entry = match[1];
        const key = tagValue(entry, "Key");
        if (!key) continue;
        results.push({
          // Report keys relative to the prefix so callers never have to know
          // about it — the prefix is where the destination lives, not part of
          // an artifact's identity.
          key: key.startsWith(this.config.prefix) ? key.slice(this.config.prefix.length) : key,
          sizeBytes: Number(tagValue(entry, "Size") ?? "0"),
          lastModified: tagValue(entry, "LastModified"),
        });
      }

      continuationToken =
        tagValue(xml, "IsTruncated") === "true"
          ? tagValue(xml, "NextContinuationToken") ?? undefined
          : undefined;
    } while (continuationToken);

    return results;
  }

  async remove(key: string): Promise<void> {
    await this.send({ method: "DELETE", key, expectMissing: true });
  }

  async facts(): Promise<DestinationFacts> {
    return {
      location: `${this.config.bucket}/${this.config.prefix}`.replace(/\/$/, ""),
      // Object storage has no meaningful free-space number, and inventing one
      // would be worse than admitting there isn't one.
      freeBytes: null,
      totalBytes: null,
    };
  }

  async test(): Promise<DestinationTestResult> {
    const checks: DestinationCheck[] = [];
    const facts = await this.facts();

    const probeKey = `.bench-destination-test-${randomBytes(6).toString("hex")}`;
    const payload = randomBytes(64);

    try {
      await this.put(probeKey, payload);
      checks.push({ name: "Write", status: "pass", detail: `Wrote a test object to ${facts.location}.` });
    } catch (error) {
      checks.push({
        name: "Write",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, checks, facts };
    }

    try {
      const readBack = await this.get(probeKey);
      const same =
        createHash("sha256").update(payload).digest("hex") ===
        createHash("sha256").update(readBack).digest("hex");
      checks.push({
        name: "Read back",
        status: same ? "pass" : "fail",
        detail: same ? "Read the test object back and the checksums matched." : "The test object read back with different contents.",
      });
    } catch (error) {
      checks.push({
        name: "Read back",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await this.remove(probeKey);
      checks.push({ name: "Delete", status: "pass", detail: "Removed the test object." });
    } catch (error) {
      // Write-without-delete is a real and sometimes deliberate configuration
      // (immutable buckets). It is a warning because backups still work; only
      // retention will not be able to prune.
      checks.push({
        name: "Delete",
        status: "warn",
        detail: `Bench could not delete its test object, so retention will not be able to prune here: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }

    return { ok: !checks.some((check) => check.status === "fail"), checks, facts };
  }
}
