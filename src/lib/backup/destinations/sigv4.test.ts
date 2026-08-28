import { EMPTY_PAYLOAD_SHA256, encodeS3Path, signS3Request, uriEncode } from "./sigv4";

// AWS's published worked example for a signed GET Object request. Hand-written
// signing is only defensible if it is checked against the authority, and this
// vector is that check: if a future refactor changes a byte of the canonical
// form, the signature stops matching and this fails.
const AWS_EXAMPLE = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  date: new Date("2013-05-24T00:00:00Z"),
};

describe("SigV4 signing", () => {
  it("reproduces AWS's published GET Object signature", () => {
    const signed = signS3Request({
      method: "GET",
      path: "/test.txt",
      headers: { host: "examplebucket.s3.amazonaws.com", Range: "bytes=0-9" },
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      region: AWS_EXAMPLE.region,
      credentials: {
        accessKeyId: AWS_EXAMPLE.accessKeyId,
        secretAccessKey: AWS_EXAMPLE.secretAccessKey,
      },
      now: AWS_EXAMPLE.date,
    });

    expect(signed.signature).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
    expect(signed.headers.Authorization).toContain(
      "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request"
    );
  });

  it("signs a session token when one is present, so temporary credentials work", () => {
    const signed = signS3Request({
      method: "PUT",
      path: "/backups/x.zip",
      headers: { host: "bucket.example.com" },
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      region: "us-east-1",
      credentials: { accessKeyId: "a", secretAccessKey: "b", sessionToken: "session-token" },
      now: AWS_EXAMPLE.date,
    });

    expect(signed.headers["x-amz-security-token"]).toBe("session-token");
    expect(signed.headers.Authorization).toContain("x-amz-security-token");
  });

  it("changes when any part of the request changes", () => {
    const base = {
      method: "PUT",
      headers: { host: "bucket.example.com" },
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      region: "us-east-1",
      credentials: { accessKeyId: "a", secretAccessKey: "b" },
      now: AWS_EXAMPLE.date,
    } as const;

    const one = signS3Request({ ...base, path: "/a.zip" }).signature;
    const two = signS3Request({ ...base, path: "/b.zip" }).signature;
    const three = signS3Request({
      ...base,
      path: "/a.zip",
      payloadSha256: "0".repeat(64),
    }).signature;

    expect(new Set([one, two, three]).size).toBe(3);
  });
});

describe("key encoding", () => {
  it("encodes each segment but keeps slashes as separators", () => {
    expect(encodeS3Path("bench/Household budget/2026-08-27.zip")).toBe(
      "/bench/Household%20budget/2026-08-27.zip"
    );
  });

  it("leaves RFC 3986 unreserved characters alone and encodes everything else", () => {
    expect(uriEncode("a-b_c.d~e")).toBe("a-b_c.d~e");
    expect(uriEncode("a+b&c=d")).toBe("a%2Bb%26c%3Dd");
    // Non-ASCII is encoded per UTF-8 byte, which is what S3 expects.
    expect(uriEncode("é")).toBe("%C3%A9");
  });
});
