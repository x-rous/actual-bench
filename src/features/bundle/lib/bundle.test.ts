/**
 * @jest-environment node
 */
import { zipSync, unzipSync, strToU8 } from "fflate";
import { exportBundle, ALL_BUNDLE_ENTITY_KEYS, type BundleEntityKey } from "./bundleExport";
import { readBundleZip } from "./bundleImport";
import { importAccountsFromCsv } from "@/features/accounts/csv/accountsCsvImport";

/**
 * The bundle is the one importer in the repository that ingests an *archive*
 * rather than a CSV, and it had no tests at all. `readBundleZip` takes a file
 * the user picked off their disk and hands its contents to six entity importers
 * that stage writes against a real budget, so what it does with a malformed,
 * hostile or merely unexpected archive is worth stating.
 */

/** A `File`-shaped object over a byte array — enough for `readBundleZip`. */
function zipFile(entries: Record<string, string>): File {
  const zipped = zipSync(
    Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, strToU8(text)]))
  );
  return { arrayBuffer: async () => zipped.buffer } as unknown as File;
}

function rawFile(bytes: Uint8Array): File {
  return { arrayBuffer: async () => bytes.buffer } as unknown as File;
}

const staged = <T extends { id: string }>(entities: T[]) =>
  Object.fromEntries(
    entities.map((entity) => [
      entity.id,
      { entity, original: entity, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} },
    ])
  );

/** Every staged map empty — the baseline each export test varies one slot of. */
const emptyInput = {
  accounts: {},
  payees: {},
  categoryGroups: {},
  categories: {},
  tags: {},
  schedules: {},
  rules: {},
};

type ExportInput = Parameters<typeof exportBundle>[0];

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("readBundleZip", () => {
  it("reads every recognised member and reports its data-row count", async () => {
    const result = await readBundleZip(
      zipFile({
        "accounts.csv": "name\nChecking\nSavings",
        "payees.csv": "name\nAmazon",
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => [f.key, f.rowCount])).toEqual(
      expect.arrayContaining([
        ["accounts", 2],
        ["payees", 1],
      ])
    );
  });

  it("orders the files so each entity's dependencies are imported first", async () => {
    // Rules reference payees and categories by name, and schedules reference
    // accounts. Importing in archive order would resolve those against a budget
    // that does not have them yet.
    const result = await readBundleZip(
      zipFile({
        "rules.csv": "a\n1",
        "schedules.csv": "a\n1",
        "payees.csv": "a\n1",
        "accounts.csv": "a\n1",
        "category-groups-and-categories.csv": "a\n1",
        "tags.csv": "a\n1",
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.key)).toEqual([
      "categories",
      "accounts",
      "payees",
      "tags",
      "schedules",
      "rules",
    ]);
  });

  it("ignores members it does not recognise instead of failing the whole bundle", async () => {
    // Zip tools add their own entries (__MACOSX, .DS_Store), and a bundle may
    // legitimately gain a member a future version writes.
    const result = await readBundleZip(
      zipFile({
        "accounts.csv": "name\nChecking",
        "__MACOSX/._accounts.csv": "junk",
        "readme.txt": "hello",
        "transactions.csv": "not part of a bundle",
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.key)).toEqual(["accounts"]);
  });

  it("yields a usable header for a member written with a BOM", async () => {
    // The exporter writes a UTF-8 BOM so spreadsheets read the file correctly.
    // It must not reach the importers: the first column header would become
    // "\uFEFFname", which none of them match.
    //
    // fflate's strFromU8 decodes via TextDecoder, which already drops a leading
    // BOM, so `stripBom` in bundleImport is belt-and-braces rather than the
    // thing doing the work here. What this test pins is the outcome either way.
    const result = await readBundleZip(zipFile({ "accounts.csv": "\uFEFFname\nChecking" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files[0].csvText.startsWith("name")).toBe(true);
    expect(result.files[0].csvText.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("reports a readable error for something that is not a ZIP at all", async () => {
    const result = await readBundleZip(rawFile(strToU8("this is a plain text file")));
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/could not read the zip/i),
    });
  });

  it("reports a readable error for a truncated archive rather than throwing", async () => {
    const whole = zipSync({ "accounts.csv": strToU8("name\nChecking") });
    const result = await readBundleZip(rawFile(whole.slice(0, Math.floor(whole.length / 2))));
    expect(result.ok).toBe(false);
  });

  it("succeeds with nothing to import when the archive holds no bundle members", async () => {
    // Distinct from a corrupt file: the archive is fine, it just is not a
    // bundle. The caller shows "nothing to import", not "the file is broken".
    const result = await readBundleZip(zipFile({ "notes.txt": "hello" }));
    expect(result).toEqual({ ok: true, files: [] });
  });

  it("counts rows without being fooled by a trailing newline or blank lines", async () => {
    const result = await readBundleZip(
      zipFile({ "accounts.csv": "name\nChecking\n\nSavings\n" })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files[0].rowCount).toBe(2);
  });

  it("reports zero rows for a header-only export", async () => {
    const result = await readBundleZip(zipFile({ "accounts.csv": "name" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files[0].rowCount).toBe(0);
  });
});

describe("exportBundle", () => {
  it("writes only the entities the user selected", async () => {
    const blob = exportBundle(emptyInput as ExportInput, new Set<BundleEntityKey>(["accounts", "tags"]));
    const names = Object.keys(unzipSync(await bytesOf(blob)));
    expect(names.sort()).toEqual(["accounts.csv", "tags.csv"]);
  });

  it("names the combined groups-and-categories member the importer looks for", async () => {
    // The two sides of this pair are the only place the export filename and the
    // import filename are not the obvious plural of the key.
    const blob = exportBundle(emptyInput as ExportInput, new Set<BundleEntityKey>(["categories"]));
    expect(Object.keys(unzipSync(await bytesOf(blob)))).toEqual([
      "category-groups-and-categories.csv",
    ]);
  });

  it("prefixes every member with a UTF-8 BOM so spreadsheets read it correctly", async () => {
    // Asserted on the bytes, not the decoded string: TextDecoder strips a
    // leading BOM, so a decoded comparison would pass whether or not the
    // exporter wrote one.
    const blob = exportBundle(emptyInput as ExportInput, new Set(ALL_BUNDLE_ENTITY_KEYS));
    const unzipped = unzipSync(await bytesOf(blob));

    expect(Object.keys(unzipped)).toHaveLength(ALL_BUNDLE_ENTITY_KEYS.length);
    for (const [name, data] of Object.entries(unzipped)) {
      expect([name, [...data.slice(0, 3)]]).toEqual([name, [0xef, 0xbb, 0xbf]]);
    }
  });

  it("produces an archive its own reader accepts, for every entity", async () => {
    // The round trip is the contract: whatever export writes, import must
    // recognise. A filename drifting on one side is invisible until a user
    // tries to restore a bundle.
    const blob = exportBundle(emptyInput as ExportInput, new Set(ALL_BUNDLE_ENTITY_KEYS));
    const result = await readBundleZip(rawFile(await bytesOf(blob)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.key).sort()).toEqual([...ALL_BUNDLE_ENTITY_KEYS].sort());
  });

  it("round-trips real rows through the archive without losing a field", async () => {
    const input = {
      ...emptyInput,
      accounts: staged([
        { id: "a1", name: "Checking", offBudget: false, closed: false },
        { id: "a2", name: "Smith, John", offBudget: true, closed: true },
      ]),
    } as unknown as ExportInput;

    const blob = exportBundle(input, new Set<BundleEntityKey>(["accounts"]));
    const result = await readBundleZip(rawFile(await bytesOf(blob)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const accounts = result.files.find((f) => f.key === "accounts")!;
    expect(accounts.rowCount).toBe(2);

    // Read the member back through the importer that actually consumes it,
    // rather than asserting the CSV text: the contract is that what the bundle
    // writes can be imported again, and comparing whole entities means a
    // dropped or transposed boolean fails here instead of silently surviving.
    const imported = importAccountsFromCsv(accounts.csvText);
    expect("error" in imported).toBe(false);
    if ("error" in imported) return;
    expect(imported.accounts).toEqual([
      { name: "Checking", offBudget: false, closed: false },
      { name: "Smith, John", offBudget: true, closed: true },
    ]);
    // A name containing the delimiter survives quoting in both directions.
    expect(accounts.csvText).toContain('"Smith, John"');
  });

  it("writes an empty archive when nothing is selected", async () => {
    const blob = exportBundle(emptyInput as ExportInput, new Set<BundleEntityKey>());
    expect(Object.keys(unzipSync(await bytesOf(blob)))).toEqual([]);
  });
});
