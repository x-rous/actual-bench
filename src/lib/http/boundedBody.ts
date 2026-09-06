/**
 * Reading a request body without letting it decide how much memory to take.
 *
 * `Request.formData()` and `Request.arrayBuffer()` buffer the whole body before
 * returning, so a size check that runs afterwards has already paid the cost it
 * was meant to prevent. A `Content-Length` header is worth checking first
 * because it is cheap, but it is the client's claim: it can be wrong, and a
 * chunked request has none at all.
 *
 * So the body is read through a counter that stops the moment the limit is
 * passed. Nothing here ever holds more than the limit allows.
 */

export class BodyTooLargeError extends Error {
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super(
      `The upload is larger than the ${Math.round(limitBytes / 1024 / 1024)}MB this endpoint accepts.`
    );
    this.name = "BodyTooLargeError";
    this.limitBytes = limitBytes;
  }
}

export class MissingBodyError extends Error {
  constructor() {
    super("The upload carried no body.");
    this.name = "MissingBodyError";
  }
}

/** True when the declared length alone is already over the limit. */
export function declaredLengthExceeds(request: Request, limitBytes: number): boolean {
  const declared = Number(request.headers.get("content-length"));
  return Number.isFinite(declared) && declared > limitBytes;
}

/**
 * The body as bytes, refused as soon as it passes `limitBytes`.
 *
 * Throws `BodyTooLargeError` rather than truncating: a partial upload is not a
 * smaller upload, and storing half an archive would be worse than refusing it.
 */
export async function readBoundedBody(
  request: Request,
  limitBytes: number
): Promise<ArrayBuffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new MissingBodyError();

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      // Stop the sender rather than draining what is left of it.
      await reader.cancel();
      throw new BodyTooLargeError(limitBytes);
    }
    chunks.push(value);
  }

  // A fresh buffer rather than a view over the chunks: `Request` accepts one
  // directly, and its size is bounded by the check above.
  const body = new ArrayBuffer(total);
  const view = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
