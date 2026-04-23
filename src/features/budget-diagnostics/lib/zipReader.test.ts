import { strFromU8, strToU8, zipSync } from "fflate";
import { unzipSnapshot } from "./zipReader";

function zip(files: Record<string, string>): ArrayBuffer {
  const zipped = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, strToU8(content)])
    )
  );
  const out = new ArrayBuffer(zipped.byteLength);
  new Uint8Array(out).set(zipped);
  return out;
}

describe("unzipSnapshot", () => {
  it("extracts db.sqlite and metadata.json", () => {
    const snapshot = unzipSnapshot(
      zip({
        "db.sqlite": "sqlite-bytes",
        "metadata.json": JSON.stringify({ budgetName: "Test Budget" }),
      })
    );

    expect(strFromU8(snapshot.dbBytes)).toBe("sqlite-bytes");
    expect(snapshot.hadMetadata).toBe(true);
    expect(snapshot.metadata).toEqual({ budgetName: "Test Budget" });
  });

  it("allows snapshots without metadata.json", () => {
    const snapshot = unzipSnapshot(zip({ "db.sqlite": "sqlite-bytes" }));

    expect(snapshot.hadMetadata).toBe(false);
    expect(snapshot.metadata).toBeNull();
  });

  it("rejects ZIP files without db.sqlite", () => {
    expect(() => unzipSnapshot(zip({ "metadata.json": "{}" }))).toThrow(
      "Export ZIP is missing db.sqlite"
    );
  });

  it("rejects non-object metadata", () => {
    expect(() =>
      unzipSnapshot(zip({ "db.sqlite": "sqlite-bytes", "metadata.json": "[]" }))
    ).toThrow("metadata.json must contain a JSON object");
  });
});
