/**
 * @jest-environment node
 */
import { zipSync } from "fflate";
import { ARCHIVE_LIMITS, UnsafeArchiveError, unzipBounded, verifyBudgetArchive } from "./verify";

/**
 * Refusing an archive before expanding it (CWE-409).
 *
 * `unzipSync` allocates each entry's output buffer from the size declared in
 * that entry's header, so an archive claiming an enormous entry causes the
 * allocation before anything is decompressed. These limits are checked against
 * the declared sizes, in a filter fflate consults before inflating.
 *
 * Mirrors `@actual-app/core/src/server/util/zip.ts`, which guards the same three
 * things: zip-slip, decompression bombs, and duplicate entries.
 */
describe("expanding an archive under limits", () => {
  const small = { maxArchiveBytes: 4096, maxEntryBytes: 64, maxTotalBytes: 128, maxEntries: 3 };

  function bytes(n: number): Uint8Array {
    return new Uint8Array(n);
  }

  it("expands an ordinary export", () => {
    const archive = zipSync({ "db.sqlite": bytes(32), "metadata.json": bytes(16) });
    expect(Object.keys(unzipBounded(archive, small)).sort()).toEqual([
      "db.sqlite",
      "metadata.json",
    ]);
  });

  it("refuses an entry larger than the limit", () => {
    const archive = zipSync({ "db.sqlite": bytes(200) });
    expect(() => unzipBounded(archive, small)).toThrow(UnsafeArchiveError);
  });

  it("refuses entries that only exceed the limit together", () => {
    // Each fits; the archive as a whole does not. Checking entries in isolation
    // is how a bomb made of many medium files gets through.
    const archive = zipSync({ a: bytes(50), b: bytes(50), c: bytes(50) });
    expect(() => unzipBounded(archive, small)).toThrow(/of content/i);
  });

  it("refuses an archive with too many entries", () => {
    // The size caps bound expansion, not how many objects are asked for.
    const archive = zipSync({ a: bytes(1), b: bytes(1), c: bytes(1), d: bytes(1) });
    expect(() => unzipBounded(archive, small)).toThrow(/more than 3 entries/i);
  });

  it("refuses the archive before reading any entry when it is oversized", () => {
    const archive = zipSync({ "db.sqlite": bytes(8192) });
    expect(() => unzipBounded(archive, small)).toThrow(/beyond the/i);
  });

  it("refuses an entry name that would escape the directory", () => {
    // Not reachable from today's extraction, which writes by name - but that is
    // a property of the extraction code, not of the archive.
    for (const name of ["../escape.txt", "/etc/passwd", "a/../../b.txt"]) {
      expect(() => unzipBounded(zipSync({ [name]: bytes(1) }), small)).toThrow(
        /unsafe entry name/i
      );
    }
  });

  it("refuses two entries that resolve to the same file", () => {
    // Whichever is read second silently wins, which makes what was verified
    // depend on read order.
    const archive = zipSync({ "db.sqlite": bytes(4), "DB.sqlite": bytes(4) });
    expect(() => unzipBounded(archive, small)).toThrow(/duplicate entry/i);
  });

  it("matches the size Actual itself will open", () => {
    // A smaller cap would refuse a budget the user can use; a larger one would
    // accept bytes Actual's own guard rejects.
    expect(ARCHIVE_LIMITS.maxArchiveBytes).toBe(500 * 1024 * 1024);
    expect(ARCHIVE_LIMITS.maxEntryBytes).toBe(500 * 1024 * 1024);
    expect(ARCHIVE_LIMITS.maxTotalBytes).toBe(500 * 1024 * 1024);
  });

  it("reports a refusal as a failed verification, not as a corrupt archive", () => {
    // The archive parsed fine. Saying "not a readable ZIP" would send the
    // reader looking for corruption that is not there.
    const archive = zipSync({ "../escape.txt": bytes(1) });
    const outcome = verifyBudgetArchive(archive, "archive");

    expect(outcome.status).toBe("failed");
    expect(outcome.findings.join(" ")).toMatch(/unsafe entry name/i);
    expect(outcome.findings.join(" ")).not.toMatch(/not a readable zip/i);
  });
});
