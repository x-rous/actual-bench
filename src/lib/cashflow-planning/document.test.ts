import { addGroup, createPlanDocument, createRow, moveRowBefore, placeRow, setGroupColor } from "./document";

const ids = (doc: ReturnType<typeof createPlanDocument>) => doc.rows.map((r) => `${r.name}:${r.groupId ?? "-"}`);

function sample() {
  let doc = createPlanDocument({ name: "t", startMonth: "2026-01", years: 1, useActuals: false });
  const g = addGroup(doc, "expenses", "G");
  doc = g.doc;
  const mk = (name: string, groupId: string | null) => createRow({ name, section: "expenses", groupId });
  const [a, b, c] = [mk("a", g.groupId), mk("b", g.groupId), mk("c", null)];
  doc = { ...doc, rows: [a, b, c] };
  return { doc, g: g.groupId, a, b, c };
}

describe("dragging rows", () => {
  it("drops below a row, in its group", () => {
    const { doc, g, a, c } = sample();
    expect(ids(moveRowBefore(doc, c.id, a.id, "after"))).toEqual([`a:${g}`, `c:${g}`, `b:${g}`]);
  });
  it("drops above a row, in its group", () => {
    const { doc, g, a, c } = sample();
    expect(ids(moveRowBefore(doc, c.id, a.id, "before"))).toEqual([`c:${g}`, `a:${g}`, `b:${g}`]);
  });
  it("puts a row first or last in a group", () => {
    const { doc, g, c } = sample();
    expect(ids(placeRow(doc, c.id, "expenses", g, "start"))[0]).toBe(`c:${g}`);
    expect(ids(placeRow(doc, c.id, "expenses", g, "end")).at(-1)).toBe(`c:${g}`);
  });
});

describe("groups", () => {
  it("adds a group after another and colours it", () => {
    const { doc, g } = sample();
    const first = addGroup(doc, "expenses", "H").doc;
    const next = addGroup(first, "expenses", "I", g);
    expect(next.doc.groups.map((x) => x.name)).toEqual(["G", "I", "H"]);
    const colored = setGroupColor(next.doc, g, "#3b82f6");
    expect(colored.groups[0].color).toBe("#3b82f6");
    expect(setGroupColor(colored, g, null).groups[0].color).toBeUndefined();
  });
});
