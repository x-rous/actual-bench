/**
 * @jest-environment node
 */
import { apiDownload } from "./client";
import type { ConnectionInstance } from "@/store/connection";
import type { ApiError } from "@/types/errors";

const connection: ConnectionInstance = {
  id: "c",
  label: "test",
  baseUrl: "http://example.test",
  apiKey: "key",
  budgetSyncId: "b1",
};

function bytesToBuffer(bytes: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function mockResponse(init: {
  status: number;
  bytes?: number[];
  json?: unknown;
  headers?: Record<string, string>;
}): Response {
  const headers = new Headers(init.headers ?? {});
  if (init.bytes) {
    return new Response(bytesToBuffer(init.bytes), { status: init.status, headers });
  }
  return new Response(init.json === undefined ? null : JSON.stringify(init.json), {
    status: init.status,
    headers: init.json !== undefined
      ? new Headers({ "content-type": "application/json", ...(init.headers ?? {}) })
      : headers,
  });
}

// jsdom does not expose `fetch` on the window, so we install a jest.fn on
// globalThis for the suite and reset it per test. Assigning via a cast avoids
// a type error while keeping the runtime behavior correct.
let fetchMock: jest.Mock;
const originalFetch = (globalThis as { fetch?: typeof fetch }).fetch;

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterAll(() => {
  if (originalFetch) {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  } else {
    delete (globalThis as { fetch?: unknown }).fetch;
  }
});

describe("apiDownload", () => {
  it("returns bytes, filename, and content-type on a 200", async () => {
    const payload = [0x50, 0x4b, 0x03, 0x04, 1, 2, 3];
    fetchMock.mockResolvedValue(
      mockResponse({
        status: 200,
        bytes: payload,
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="budget-abc.zip"',
        },
      })
    );

    const result = await apiDownload(connection, "/export");
    expect(Array.from(new Uint8Array(result.bytes))).toEqual(payload);
    expect(result.contentType).toBe("application/zip");
    expect(result.filename).toBe("budget-abc.zip");
  });

  it("parses RFC 5987 filename*= UTF-8 encodings", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        status: 200,
        bytes: [1],
        headers: {
          "content-type": "application/zip",
          "content-disposition":
            "attachment; filename=\"fallback.zip\"; filename*=UTF-8''budget%20%E2%9C%93.zip",
        },
      })
    );

    const result = await apiDownload(connection, "/export");
    expect(result.filename).toBe("budget ✓.zip");
  });

  it("parses RFC 5987 filename*= values with an optional language tag", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        status: 200,
        bytes: [1],
        headers: {
          "content-type": "application/zip",
          "content-disposition":
            "attachment; filename=\"fallback.zip\"; filename*=UTF-8'en'budget%20backup.zip",
        },
      })
    );

    const result = await apiDownload(connection, "/export");
    expect(result.filename).toBe("budget backup.zip");
  });

  it("returns filename=null when no content-disposition is present", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        status: 200,
        bytes: [1],
        headers: { "content-type": "application/zip" },
      })
    );

    const result = await apiDownload(connection, "/export");
    expect(result.filename).toBeNull();
  });

  it("throws a structured ApiError with the upstream message on 4xx", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        status: 404,
        json: { error: "Budget not found" },
      })
    );

    await expect(apiDownload(connection, "/export")).rejects.toMatchObject<Partial<ApiError>>({
      kind: "api",
      status: 404,
      message: "Budget not found",
    });
  });

  it("throws a structured ApiError on network failure", async () => {
    fetchMock.mockRejectedValue(new Error("econnrefused"));

    await expect(apiDownload(connection, "/export")).rejects.toMatchObject<Partial<ApiError>>({
      kind: "api",
      status: 0,
      message: "econnrefused",
    });
  });

  it("posts to /api/proxy/download with the expected body", async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 200, bytes: [0] }));

    await apiDownload(connection, "/export");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/download",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ connection, path: "/export", method: "GET" }),
      })
    );
  });
});
