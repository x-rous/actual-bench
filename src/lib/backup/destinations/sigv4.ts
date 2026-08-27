import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for S3 (RD-077 / PR-047b).
 *
 * Written out rather than pulled in: the AWS SDK is tens of megabytes of
 * dependency for four HTTP verbs, and Bench ships as a small self-hosted image.
 * Signing is a hash chain over a canonical form of the request — mechanical,
 * fully specified, and verified here against AWS's own published test vector,
 * which is the only reason writing it by hand is defensible.
 *
 * Deliberately supports the whole S3-compatible family (MinIO, Backblaze B2,
 * Cloudflare R2, Wasabi, Garage) by never assuming an AWS hostname.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";

export const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type SigV4Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type SigV4Request = {
  method: string;
  /** Already-encoded path, beginning with `/`. */
  path: string;
  /** Query parameters, unencoded. */
  query?: Record<string, string | undefined>;
  headers: Record<string, string>;
  /** Hex SHA-256 of the body. */
  payloadSha256: string;
  region: string;
  service?: string;
  credentials: SigV4Credentials;
  /** Injectable so the test vector is reproducible. */
  now?: Date;
};

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function hex(value: Buffer): string {
  return value.toString("hex");
}

/**
 * Percent-encode per RFC 3986. S3 requires object keys to be encoded in the
 * canonical URI, but slashes stay as path separators.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const char of Buffer.from(value, "utf8")) {
    const c = String.fromCharCode(char);
    if (/[A-Za-z0-9\-._~]/.test(c)) {
      out += c;
    } else if (c === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      out += `%${char.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export function encodeS3Path(key: string): string {
  return `/${key
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/")}`;
}

function canonicalQuery(query: Record<string, string | undefined>): string {
  return Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export type SignedRequest = {
  headers: Record<string, string>;
  amzDate: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
};

/**
 * Returns the headers to send, plus the intermediate forms — the canonical
 * request and string to sign — because when a provider rejects a signature the
 * only way to find out why is to compare those against what it echoes back.
 */
export function signS3Request(request: SigV4Request): SignedRequest {
  const service = request.service ?? "s3";
  const now = request.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = { ...request.headers };
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = request.payloadSha256;
  if (request.credentials.sessionToken) {
    headers["x-amz-security-token"] = request.credentials.sessionToken;
  }

  const canonicalHeaderEntries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalHeaders = canonicalHeaderEntries.map(([key, value]) => `${key}:${value}\n`).join("");
  const signedHeaders = canonicalHeaderEntries.map(([key]) => key).join(";");

  const canonicalRequest = [
    request.method.toUpperCase(),
    request.path,
    canonicalQuery(request.query ?? {}),
    canonicalHeaders,
    signedHeaders,
    request.payloadSha256,
  ].join("\n");

  const scope = `${dateStamp}/${request.region}/${service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    hex(createHash("sha256").update(canonicalRequest, "utf8").digest()),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${request.credentials.secretAccessKey}`, dateStamp), request.region), service),
    "aws4_request"
  );
  const signature = hex(hmac(signingKey, stringToSign));

  headers.Authorization =
    `${ALGORITHM} Credential=${request.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers, amzDate, canonicalRequest, stringToSign, signature };
}
