import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareRows, familyStatus, FixtureError, listFamilies, loadFamily, loadFixture, parseCsv } from "./harness";

function writeFixture(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

const COMPLETE_SOURCE = [
  "id: demo",
  "country: AU",
  "currency: AUD",
  "source-name: Demo",
  "source-url: n/a",
  "source-type: synthetic-oracle",
  "verified: 2026-09-29",
  "conventions: actual-365-fixed",
  "engine-versions: daycount-act365f@1",
  "coverage: synthetic",
].join("\n");

const BASE = {
  "input.json": "{}",
  "events.csv": "date,kind,amount_minor\n",
  "expected.csv": "start,end,days,interest_minor\n2024-01-01,2024-01-02,1,100\n",
};

describe("fixture harness", () => {
  it("loads every committed fixture with a complete source record", () => {
    const families = listFamilies();
    expect(families).toEqual(expect.arrayContaining(["act360", "act365f", "actact", "au-daily", "canada-j2", "monthly-alloc", "30u360"]));
    for (const family of families) {
      familyStatus(family);
      for (const fixture of loadFamily(family)) {
        expect(fixture.source.id).toBeTruthy();
        expect(fixture.expected.length).toBeGreaterThan(0);
      }
    }
  });

  it("refuses a fixture with no source.md", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "rd084-")), "family", "no-source");
    writeFixture(dir, BASE);
    expect(() => loadFixture(dir)).toThrow(FixtureError);
    expect(() => loadFixture(dir)).toThrow(/no source.md/);
  });

  it("refuses a source.md missing a required key", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "rd084-")), "family", "partial");
    writeFixture(dir, { ...BASE, "source.md": COMPLETE_SOURCE.replace("verified: 2026-09-29\n", "") });
    expect(() => loadFixture(dir)).toThrow(/missing: verified/);
  });

  it("refuses a missing data file or an unknown coverage class", () => {
    const root = mkdtempSync(join(tmpdir(), "rd084-"));
    const noEvents = join(root, "family", "no-events");
    writeFixture(noEvents, { "input.json": "{}", "expected.csv": BASE["expected.csv"], "source.md": COMPLETE_SOURCE });
    expect(() => loadFixture(noEvents)).toThrow(/no events.csv/);
    const badCoverage = join(root, "family", "bad-coverage");
    writeFixture(badCoverage, { ...BASE, "source.md": COMPLETE_SOURCE.replace("coverage: synthetic", "coverage: probably") });
    expect(() => loadFixture(badCoverage)).toThrow(/coverage/);
  });

  it("loads a complete fixture", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "rd084-")), "family", "ok");
    writeFixture(dir, { ...BASE, "source.md": COMPLETE_SOURCE });
    const fixture = loadFixture(dir);
    expect(fixture).toMatchObject({ family: "family", name: "ok", source: { id: "demo", coverage: "synthetic" } });
    expect(fixture.expected).toEqual([{ start: "2024-01-01", end: "2024-01-02", days: "1", interest_minor: "100" }]);
  });

  it("compares rows to the minor unit and counts missing rows", () => {
    const expected = parseCsv("a,b\n1,100\n2,200\n");
    expect(compareRows(expected, parseCsv("a,b\n1,100\n2,200\n"))).toEqual([]);
    expect(compareRows(expected, parseCsv("a,b\n1,101\n2,200\n"))).toEqual([{ row: 1, column: "b", expected: "100", actual: "101" }]);
    expect(compareRows(expected, parseCsv("a,b\n1,100\n"))).toHaveLength(2);
  });

  it("rejects malformed CSV", () => {
    expect(() => parseCsv("a,b\n1\n")).toThrow(FixtureError);
    expect(() => parseCsv('a,b\n"1",2\n')).toThrow(FixtureError);
    expect(() => parseCsv("")).toThrow(FixtureError);
  });
});
