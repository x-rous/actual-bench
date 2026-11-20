import { createHash, randomBytes } from "node:crypto";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import type { S3Credentials } from "@/lib/credentials/backupSecrets";
import { EMPTY_PAYLOAD_SHA256, encodeS3Path, signS3Request } from "./sigv4";
import {
  DestinationError,
  type DestinationAdapter,
  type DestinationCheck,
  type DestinationFacts,
  type DestinationTestResult,
  type StoredObject,
} from "./types";
import { OutboundBlockedError, guardedFetch } from "@/lib/security/outboundGuard";

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

/**
 * How long one request may take.
 *
 * A fixed minute for the request itself, plus time for the body at a slow
 * uplink's pace. Without any limit a stalled endpoint held a run until the
 * job's hour-long deadline, after the first write had started, so it ended
 * "indeterminate" and was never retried.
 */
const BASE_TIMEOUT_MS = 60_000;
const SLOWEST_BYTES_PER_SECOND = 512 * 1024;

export function requestTimeoutMs(bodyBytes: number): number {
  return BASE_TIMEOUT_MS + Math.ceil((bodyBytes / SLOWEST_BYTES_PER_SECOND) * 1000);
}

/** Waits between attempts of a request that failed in a way worth repeating. */
export const DEFAULT_RETRY_DELAYS_MS = [1_000, 4_000];

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type S3AdapterOptions = {
  /** The run's own signal: a cancel or deadline stops the request. */
  signal?: AbortSignal;
  /** Override for tests. */
  retryDelaysMs?: number[];
};

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

type SendOptions = {
  method: string;
  key?: string;
  query?: Record<string, string | undefined>;
  body?: Uint8Array;
  extraHeaders?: Record<string, string>;
  expectMissing?: boolean;
};

export class S3DestinationAdapter implements DestinationAdapter {
  readonly kind = "s3" as const;
  readonly destinationId: string;
  readonly name: string;
  private readonly config: S3DestinationConfig;
  private readonly credentials: S3Credentials;
  private readonly signal: AbortSignal | undefined;
  private readonly retryDelaysMs: number[];

  constructor(destination: BackupDestination, credentials: S3Credentials, options: S3AdapterOptions = {}) {
    this.destinationId = destination.id;
    this.name = destination.name;
    this.config = readS3Config(destination);
    this.credentials = credentials;
    this.signal = options.signal;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
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

  /**
   * One request, repeated when it failed in a way worth repeating: a network
   * error, a timeout, a 5xx or throttling. A refusal (4xx) is final, and a
   * stop asked for by the run is never retried.
   */
  private async send(options: SendOptions): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.sendOnce(options);
      } catch (error) {
        const retryable = error instanceof DestinationError && error.retryable;
        if (!retryable || this.signal?.aborted || attempt >= this.retryDelaysMs.length) throw error;
        await sleep(this.retryDelaysMs[attempt], this.signal);
      }
    }
  }

  private async sendOnce(options: SendOptions): Promise<Response> {
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

    const timeout = AbortSignal.timeout(requestTimeoutMs(body?.byteLength ?? 0));
    const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await guardedFetch(url, {
        method: options.method,
        headers: signed.headers,
        // The bytes as they are: copying them into a Buffer first doubled the
        // memory a large upload needed.
        body: body as BodyInit | undefined,
        signal,
      });
    } catch (error) {
      if (error instanceof OutboundBlockedError) {
        throw new DestinationError(error.message, { cause: error, retryable: false });
      }
      if (this.signal?.aborted) {
        throw new DestinationError("Stopped before the request finished.", { cause: error, retryable: false });
      }
      if (timeout.aborted) {
        throw new DestinationError(`${this.host} did not answer in time.`, { cause: error, retryable: true });
      }
      throw new DestinationError(
        `Could not reach ${this.host}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, retryable: true }
      );
    }

    if (response.ok) return response;
    // Only 404 counts as absent. A 403 means Bench was refused, and treating
    // that as "gone" is the dangerous direction: scrub would report copies as
    // missing that are sitting safely in the bucket, and a delete that was
    // refused would be recorded as done.
    if (options.expectMissing && response.status === 404) return response;

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

  /** The object as a stream, so a download is not held in memory first. */
  async getStream(key: string): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number }> {
    const response = await this.send({ method: "GET", key });
    if (!response.body) throw new DestinationError(`${key} came back with no body.`);
    const size = Number(response.headers.get("content-length") ?? "0");
    return { stream: response.body, sizeBytes: Number.isFinite(size) ? size : 0 };
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
