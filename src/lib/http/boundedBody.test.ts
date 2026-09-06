/**
 * @jest-environment node
 */
import {
  BodyTooLargeError,
  MissingBodyError,
  declaredLengthExceeds,
  readBoundedBody,
} from "./boundedBody";

/**
 * The limit has to hold without trusting the sender.
 *
 * Tested here with a small limit rather than through the route, so the counting
 * path can be exercised without allocating the real one.
 */
describe("reading a request body under a limit", () => {
  /** A request whose body arrives in pieces, as a real upload does. */
  function streamed(chunks: number[], declaredLength?: number): Request {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    });
    return new Request("http://localhost/upload", {
      method: "POST",
      headers:
        declaredLength === undefined ? {} : { "content-length": String(declaredLength) },
      body: stream,
      // Required by undici for a streamed body.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  }

  it("returns a body that fits", async () => {
    const body = await readBoundedBody(streamed([10, 20, 30]), 100);
    expect(body.byteLength).toBe(60);
  });

  it("refuses one that does not, mid-stream", async () => {
    // The point of counting: this body never declares its size, and the limit
    // still holds. Nothing beyond the limit is ever held in memory.
    await expect(readBoundedBody(streamed([40, 40, 40]), 100)).rejects.toBeInstanceOf(
      BodyTooLargeError
    );
  });

  it("counts the whole stream, not the largest chunk", async () => {
    // Many small pieces add up. Checking each chunk against the limit instead
    // of the running total would let an unbounded body through.
    const chunks = Array.from({ length: 50 }, () => 10);
    await expect(readBoundedBody(streamed(chunks), 100)).rejects.toBeInstanceOf(
      BodyTooLargeError
    );
  });

  it("accepts a body exactly at the limit", async () => {
    const body = await readBoundedBody(streamed([50, 50]), 100);
    expect(body.byteLength).toBe(100);
  });

  describe("when the sender declares a length", () => {
    /*
     * A declared length is not trusted as a limit - the counter above is for
     * that - but it is a good hint for how much to allocate, which avoids
     * holding the body twice while the pieces are joined.
     *
     * These take that path and assert it cannot be told apart from the other
     * one. That is the whole requirement of an allocation strategy: the result
     * must not depend on what the sender claimed. The interesting case is a
     * claim shorter than the body, where the bug would be a silent truncation.
     */

    it("returns exactly what arrived when the length was right", async () => {
      const body = await readBoundedBody(streamed([20, 20, 20], 60), 100);
      expect(body.byteLength).toBe(60);
    });

    it("returns what arrived, not what was claimed, when the length was long", async () => {
      const body = await readBoundedBody(streamed([10, 10], 90), 100);
      expect(body.byteLength).toBe(20);
    });

    it("keeps everything when the length understated the body", async () => {
      // A short claim must not truncate: the buffer fills, and the rest is
      // collected as before.
      const body = await readBoundedBody(streamed([10, 10, 10], 15), 100);
      expect(body.byteLength).toBe(30);
    });

    it("still refuses a body past the limit however it was declared", async () => {
      await expect(readBoundedBody(streamed([60, 60], 20), 100)).rejects.toBeInstanceOf(
        BodyTooLargeError
      );
    });
  });

  it("says so when there is no body at all", async () => {
    const request = new Request("http://localhost/upload", { method: "POST" });
    await expect(readBoundedBody(request, 100)).rejects.toBeInstanceOf(MissingBodyError);
  });

  describe("the declared length", () => {
    function withLength(value: string | null): Request {
      return new Request("http://localhost/upload", {
        method: "POST",
        headers: value === null ? {} : { "content-length": value },
        body: "x",
      });
    }

    it("refuses early when it is already over", () => {
      expect(declaredLengthExceeds(withLength("999"), 100)).toBe(true);
    });

    it("does not refuse when it is absent, wrong or unparseable", () => {
      // A chunked request has no length, and a header is the client's claim
      // either way - which is why the counter above exists rather than this
      // being the only guard.
      expect(declaredLengthExceeds(withLength(null), 100)).toBe(false);
      expect(declaredLengthExceeds(withLength("not a number"), 100)).toBe(false);
      expect(declaredLengthExceeds(withLength("-5"), 100)).toBe(false);
    });
  });
});
