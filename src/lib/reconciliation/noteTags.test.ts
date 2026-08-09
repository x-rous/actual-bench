import {
  findNoteTags,
  hasNoteTag,
  noteTagNames,
  normalizeTagName,
  stripNoteTags,
} from "./noteTags";

describe("findNoteTags — token boundary (feature spec §25)", () => {
  it("finds a tag at the start, middle, and end of a note", () => {
    expect(findNoteTags("#One dinner #Two with family #Three").map((t) => t.name)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  it("treats #OneDrive as its own tag, never as #One", () => {
    const tags = findNoteTags("#OneDrive payment");
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("OneDrive");
  });

  it("does not treat a mid-token # as a tag", () => {
    // "AMZN*2J8G4#5" is bank noise, not a tag: the # is not preceded by space.
    expect(findNoteTags("AMZN*2J8G4#5")).toEqual([]);
  });

  it("ends a tag at sentence punctuation", () => {
    expect(findNoteTags("Paid #One, then left").map((t) => t.name)).toEqual(["One"]);
    expect(findNoteTags("Paid #One.").map((t) => t.name)).toEqual(["One"]);
  });

  it("reports offsets that slice the tag exactly", () => {
    const notes = "Imported via n8n #One | Family dinner";
    const [tag] = findNoteTags(notes);
    expect(notes.slice(tag.start, tag.end)).toBe("#One");
  });

  it("returns an empty list for nullish or tagless notes", () => {
    expect(findNoteTags(null)).toEqual([]);
    expect(findNoteTags(undefined)).toEqual([]);
    expect(findNoteTags("no tags here")).toEqual([]);
  });

  it("is not affected by a previous call (no shared regex state)", () => {
    const notes = "#One #Two";
    expect(findNoteTags(notes)).toHaveLength(2);
    expect(findNoteTags(notes)).toHaveLength(2);
  });
});

describe("hasNoteTag", () => {
  it("matches whole tokens case-insensitively, with or without the #", () => {
    expect(hasNoteTag("Dinner #One", "#One")).toBe(true);
    expect(hasNoteTag("Dinner #One", "one")).toBe(true);
    expect(hasNoteTag("Dinner #one", "#One")).toBe(true);
  });

  it("does not match a prefix of a longer tag", () => {
    expect(hasNoteTag("Dinner #OneDrive", "#One")).toBe(false);
  });

  it("is false for empty inputs", () => {
    expect(hasNoteTag(null, "#One")).toBe(false);
    expect(hasNoteTag("Dinner #One", "")).toBe(false);
  });
});

describe("noteTagNames", () => {
  it("de-duplicates case-insensitively", () => {
    expect(noteTagNames("#One dinner #one again")).toEqual(["one"]);
  });
});

describe("stripNoteTags — matching preprocessing", () => {
  it("removes tags and collapses the whitespace they leave behind", () => {
    expect(stripNoteTags("Imported #One Family dinner")).toBe("Imported Family dinner");
  });

  it("preserves the bank text and the user's own words around a tag", () => {
    expect(stripNoteTags("TALABAT AE 88721 #One | Dinner with family")).toBe(
      "TALABAT AE 88721 | Dinner with family"
    );
  });

  it("leaves #OneDrive alone only when it is not being stripped as a tag", () => {
    // #OneDrive *is* a tag, so it is stripped as a whole token — never partially.
    expect(stripNoteTags("#OneDrive payment")).toBe("payment");
  });

  it("returns the trimmed original when there are no tags", () => {
    expect(stripNoteTags("  CARREFOUR MARKET  ")).toBe("CARREFOUR MARKET");
  });

  it("returns an empty string for nullish notes", () => {
    expect(stripNoteTags(null)).toBe("");
    expect(stripNoteTags(undefined)).toBe("");
  });
});

describe("normalizeTagName", () => {
  it("drops a leading # and lower-cases", () => {
    expect(normalizeTagName("#Work")).toBe("work");
    expect(normalizeTagName(" Work ")).toBe("work");
    expect(normalizeTagName(null)).toBe("");
  });
});
