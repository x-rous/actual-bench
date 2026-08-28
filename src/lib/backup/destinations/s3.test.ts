/**
 * @jest-environment node
 */
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import type { JsonObject } from "@/lib/app-db/types";
import { S3DestinationAdapter } from "./s3";
import { DestinationError } from "./types";

function destination(config: JsonObject): BackupDestination {
  return {
    id: "dest-s3",
    name: "Off-site",
    kind: "s3",
    enabled: true,
    config: { version: 1, data: config },
    credentialRef: "cred-1",
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

const credentials = { accessKeyId: "AKIA", secretAccessKey: "secret" };

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function mockFetch(handler: (call: Call) => Response): { calls: Call[] } {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { calls };
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("S3 destination addressing", () => {
  it("uses path style against a custom endpoint, which is what self-hosted providers need", async () => {
    const { calls } = mockFetch(() => new Response("", { status: 200 }));
    const adapter = new S3DestinationAdapter(
      destination({ bucket: "bench", endpoint: "https://minio.lan:9000", prefix: "budgets" }),
      credentials
    );

    await adapter.put("2026/august.zip", Buffer.from("x"));

    expect(calls[0].url).toBe("https://minio.lan:9000/bench/budgets/2026/august.zip");
    expect(calls[0].headers.host).toBe("minio.lan:9000");
  });

  it("uses virtual-host style against AWS", async () => {
    const { calls } = mockFetch(() => new Response("", { status: 200 }));
    const adapter = new S3DestinationAdapter(
      destination({ bucket: "bench", region: "eu-west-1" }),
      credentials
    );

    await adapter.put("a.zip", Buffer.from("x"));

    expect(calls[0].url).toBe("https://bench.s3.eu-west-1.amazonaws.com/a.zip");
  });

  it("signs every request", async () => {
    const { calls } = mockFetch(() => new Response("", { status: 200 }));
    const adapter = new S3DestinationAdapter(destination({ bucket: "bench" }), credentials);

    await adapter.put("a.zip", Buffer.from("payload"));

    expect(calls[0].headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIA\//);
    // The content hash is of the real body, not the empty-payload constant.
    expect(calls[0].headers["x-amz-content-sha256"]).not.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});

describe("S3 destination behaviour", () => {
  it("reports a missing object as missing instead of failing the run", async () => {
    mockFetch(() => new Response("", { status: 404 }));
    const adapter = new S3DestinationAdapter(destination({ bucket: "bench" }), credentials);

    expect(await adapter.head("gone.zip")).toBeNull();
  });

  it("refuses to call an object gone when the bucket only refused to answer", async () => {
    // A 403 is "you may not look", not "it is not there". Reading it as absence
    // would have scrub reporting copies missing that are sitting safely in the
    // bucket, and a refused delete recorded as done.
    mockFetch(() => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }));
    const adapter = new S3DestinationAdapter(destination({ bucket: "bench" }), credentials);

    await expect(adapter.head("private.zip")).rejects.toThrow(/AccessDenied/);
    await expect(adapter.remove("private.zip")).rejects.toThrow(/AccessDenied/);
  });

  it("surfaces the provider's own error text, which is the only useful diagnostic", async () => {
    mockFetch(
      () =>
        new Response(
          "<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>",
          { status: 403 }
        )
    );
    const adapter = new S3DestinationAdapter(destination({ bucket: "bench" }), credentials);

    await expect(adapter.get("a.zip")).rejects.toThrow(/SignatureDoesNotMatch/);
  });

  it("marks server errors retryable and permission errors not", async () => {
    mockFetch(() => new Response("<Error><Code>InternalError</Code></Error>", { status: 503 }));
    const adapter = new S3DestinationAdapter(destination({ bucket: "bench" }), credentials);
    await expect(adapter.get("a.zip")).rejects.toMatchObject({ retryable: true });

    mockFetch(() => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }));
    await expect(adapter.get("a.zip")).rejects.toMatchObject({ retryable: false });
  });

  it("pages through a truncated listing and strips the prefix from keys", async () => {
    let page = 0;
    mockFetch(() => {
      page += 1;
      return page === 1
        ? new Response(
            `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok</NextContinuationToken>
             <Contents><Key>budgets/one.zip</Key><Size>10</Size><LastModified>2026-08-01T00:00:00.000Z</LastModified></Contents>
             </ListBucketResult>`,
            { status: 200 }
          )
        : new Response(
            `<ListBucketResult><IsTruncated>false</IsTruncated>
             <Contents><Key>budgets/two.zip</Key><Size>20</Size><LastModified>2026-08-02T00:00:00.000Z</LastModified></Contents>
             </ListBucketResult>`,
            { status: 200 }
          );
    });

    const adapter = new S3DestinationAdapter(
      destination({ bucket: "bench", prefix: "budgets" }),
      credentials
    );
    const listed = await adapter.list("");

    expect(listed.map((entry) => entry.key)).toEqual(["one.zip", "two.zip"]);
    expect(listed[1].sizeBytes).toBe(20);
  });

  it("treats a bucket that will not delete as a warning, not a failure", async () => {
    // Immutable / write-once buckets are a real configuration. Backups still
    // work there; only retention cannot prune, and the user should be told that
    // rather than being blocked from using the destination at all.
    mockFetch((call) =>
      call.method === "DELETE"
        ? new Response("<Error><Code>AccessDenied</Code></Error>", { status: 405 })
        : new Response(Buffer.from("probe"), { status: 200 })
    );

    const adapter = new S3DestinationAdapter(destination({ bucket: "bench" }), credentials);
    // Read-back compares checksums, so a fixed body fails that check; assert on
    // the delete check specifically.
    const result = await adapter.test();

    expect(result.checks.find((check) => check.name === "Delete")?.status).toBe("warn");
    expect(result.checks.find((check) => check.name === "Delete")?.detail).toMatch(/retention/);
  });

  it("says which destination could not be reached when the network fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND minio.lan");
    }) as unknown as typeof fetch;

    const adapter = new S3DestinationAdapter(
      destination({ bucket: "bench", endpoint: "https://minio.lan:9000" }),
      credentials
    );

    await expect(adapter.put("a.zip", Buffer.from("x"))).rejects.toThrow(DestinationError);
    await expect(adapter.put("a.zip", Buffer.from("x"))).rejects.toThrow(/minio\.lan:9000/);
  });
});
