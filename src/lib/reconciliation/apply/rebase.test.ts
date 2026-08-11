import { rebaseNotes } from "./rebase";

describe("replaying a staged note change onto one that moved underneath it", () => {
  it("keeps text added in Actual while still renaming the tag", () => {
    // The case from the feature spec: the session staged #One → #Two, and
    // meanwhile the user appended a remark of their own in Actual.
    expect(
      rebaseNotes("Imported #One", "Imported #Two", "Imported #One | Manual text")
    ).toEqual({ status: "rebased", notes: "Imported #Two | Manual text" });
  });

  it("renames the tag where it stood rather than moving it to the end", () => {
    // Position matters: a tag that migrates to the end of the note is a change
    // the user did not ask for, even though the words are all present.
    expect(rebaseNotes("#API SHOP", "#2026-07 SHOP", "#API SHOP DUBAI")).toEqual({
      status: "rebased",
      notes: "#2026-07 SHOP DUBAI",
    });
  });

  it("keeps an appended remark appended", () => {
    expect(rebaseNotes("SHOP", "SHOP | checked", "SHOP DUBAI UAE")).toEqual({
      status: "rebased",
      notes: "SHOP DUBAI UAE | checked",
    });
  });

  it("drops a removed tag in place", () => {
    expect(rebaseNotes("#API SHOP", "SHOP", "#API SHOP DUBAI")).toEqual({
      status: "rebased",
      notes: "SHOP DUBAI",
    });
  });

  it("refuses when the words the change touched are no longer there", () => {
    // The user renamed the same tag themselves. Two people editing the same
    // words is precisely what this must not resolve on its own.
    const result = rebaseNotes("Imported #One", "Imported #Two", "Imported #Three");
    expect(result.status).toBe("conflict");
  });

  it("treats an untouched note as needing no rebase", () => {
    expect(rebaseNotes("Imported #One", "Imported #Two", "Imported #One")).toEqual({
      status: "unchanged",
      notes: "Imported #Two",
    });
  });

  it("stands aside when nothing was staged", () => {
    expect(rebaseNotes("Imported #One", "Imported #One", "Imported #One | edited")).toEqual({
      status: "unchanged",
      notes: "Imported #One | edited",
    });
  });

  it("recognises that Actual already says what was staged", () => {
    expect(rebaseNotes("Imported #One", "Imported #Two", "Imported #Two")).toEqual({
      status: "unchanged",
      notes: "Imported #Two",
    });
  });

  it("handles a note that was empty at snapshot time", () => {
    expect(rebaseNotes(null, "#2026-07", "written elsewhere")).toEqual({
      status: "rebased",
      notes: "written elsewhere #2026-07",
    });
  });

  it("reports a rebase that empties the note as null rather than an empty string", () => {
    // `null` and `""` are different instructions to the transport; only one of
    // them means "no note".
    expect(rebaseNotes("#API", "", "#API")).toEqual({ status: "unchanged", notes: "" });
    expect(rebaseNotes("#API extra", "extra", "#API")).toEqual({
      status: "rebased",
      notes: null,
    });
  });

  it("is stable when run against its own output", () => {
    const first = rebaseNotes("Imported #One", "Imported #Two", "Imported #One | Manual text");
    if (first.status !== "rebased") throw new Error("expected a rebase");
    // Re-running with the rebased text now current must not rename anything a
    // second time or duplicate the tag.
    expect(rebaseNotes("Imported #One", "Imported #Two", first.notes)).toEqual({
      status: "conflict",
      reason: expect.any(String),
    });
  });

  it("does not duplicate an addition Actual already made", () => {
    expect(rebaseNotes("SHOP", "SHOP | checked", "SHOP | checked | twice")).toEqual({
      status: "unchanged",
      notes: "SHOP | checked | twice",
    });
  });
});
