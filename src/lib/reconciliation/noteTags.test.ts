import {
  addNoteTag,
  appendNoteText,
  findNoteTags,
  prependNoteText,
  removeNoteTag,
  replaceNoteTag,
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

describe("addNoteTag (feature spec §26)", () => {
  it("appends a tag", () => {
    expect(addNoteTag("Family dinner", "#Two")).toBe("Family dinner #Two");
  });

  it("does not add a tag the note already carries", () => {
    expect(addNoteTag("Dinner #Two", "#Two")).toBe("Dinner #Two");
  });

  it("does not treat a longer tag as the one being added", () => {
    expect(addNoteTag("Dinner #TwoDrive", "#Two")).toBe("Dinner #TwoDrive #Two");
  });

  it("writes the tag alone into an empty note", () => {
    expect(addNoteTag(null, "#Two")).toBe("#Two");
    expect(addNoteTag("", "Two")).toBe("#Two");
  });

  it("matches case-insensitively when deciding whether it is present", () => {
    expect(addNoteTag("Dinner #two", "#Two")).toBe("Dinner #two");
  });
});

describe("removeNoteTag (feature spec §26)", () => {
  it("removes the tag and the space it leaves behind", () => {
    expect(removeNoteTag("Imported #One Family dinner", "#One")).toBe("Imported Family dinner");
  });

  it("removes every occurrence", () => {
    expect(removeNoteTag("Dinner #One #Two", "#One")).toBe("Dinner #Two");
  });

  it("leaves a note without the tag alone", () => {
    expect(removeNoteTag("Dinner #Two", "#One")).toBe("Dinner #Two");
  });

  it("does not remove a longer tag that starts the same way", () => {
    expect(removeNoteTag("#OneDrive payment", "#One")).toBe("#OneDrive payment");
  });

  it("keeps the user's own words and punctuation", () => {
    expect(removeNoteTag("Imported via n8n #One | Family dinner", "#One")).toBe(
      "Imported via n8n | Family dinner"
    );
  });
});

describe("replaceNoteTag — the operation this module exists for", () => {
  it("replaces a lone tag", () => {
    expect(replaceNoteTag("#One", "#One", "#Two")).toBe("#Two");
  });

  it("replaces in place, leaving every other character alone", () => {
    expect(replaceNoteTag("Imported via n8n #One | Family dinner", "#One", "#Two")).toBe(
      "Imported via n8n #Two | Family dinner"
    );
  });

  it("does not touch a longer tag that starts the same way", () => {
    expect(replaceNoteTag("#OneDrive payment", "#One", "#Two")).toBe("#OneDrive payment");
  });

  it("renames a workflow tag to a month, which is the real use", () => {
    expect(replaceNoteTag("#API ADNOC AL CORNICHE 933", "#API", "#2026-07")).toBe(
      "#2026-07 ADNOC AL CORNICHE 933"
    );
  });

  it("is safe to run twice", () => {
    const once = replaceNoteTag("#API Dinner", "#API", "#2026-07");
    expect(replaceNoteTag(once, "#API", "#2026-07")).toBe(once);
  });

  it("leaves a note without the tag alone", () => {
    expect(replaceNoteTag("Dinner", "#One", "#Two")).toBe("Dinner");
  });

  it("does nothing when the two tags are the same", () => {
    expect(replaceNoteTag("#One Dinner", "#One", "#one")).toBe("#One Dinner");
  });

  it("does not leave a duplicate when the replacement is already present", () => {
    expect(replaceNoteTag("#One Dinner #Two", "#One", "#Two")).toBe("Dinner #Two");
  });

  it("returns an empty note untouched", () => {
    expect(replaceNoteTag(null, "#One", "#Two")).toBe("");
  });
});

describe("appendNoteText (feature spec §26)", () => {
  it("appends after a separator", () => {
    expect(appendNoteText("Family dinner #Two", "Checked against statement")).toBe(
      "Family dinner #Two | Checked against statement"
    );
  });

  it("writes the text alone into an empty note", () => {
    expect(appendNoteText(null, "Checked")).toBe("Checked");
  });

  it("does not append text the note already contains", () => {
    expect(appendNoteText("Dinner | Checked", "Checked")).toBe("Dinner | Checked");
  });

  it("ignores empty text", () => {
    expect(appendNoteText("Dinner", "   ")).toBe("Dinner");
  });

  it("accepts a different separator", () => {
    expect(appendNoteText("Dinner", "Checked", " - ")).toBe("Dinner - Checked");
  });
});

describe("user text always survives (feature spec §49)", () => {
  it("keeps everything around a tag through a rename", () => {
    const original = "Imported via n8n #API | Dinner with Ahmad, paid for Dad";
    expect(replaceNoteTag(original, "#API", "#2026-07")).toBe(
      "Imported via n8n #2026-07 | Dinner with Ahmad, paid for Dad"
    );
  });

  it("keeps a multi-line note's shape when a tag is removed", () => {
    const original = "Line one #One\nLine two";
    expect(removeNoteTag(original, "#One")).toBe("Line one\nLine two");
  });
});

describe("tag position and prepending", () => {
  it("puts a tag at the front when asked", () => {
    // The convention among users who tag by workflow: the tag leads.
    expect(addNoteTag("ADNOC AL CORNICHE 933", "#2026-07", "start")).toBe(
      "#2026-07 ADNOC AL CORNICHE 933"
    );
  });

  it("still appends by default", () => {
    expect(addNoteTag("Dinner", "#2026-07")).toBe("Dinner #2026-07");
  });

  it("does not duplicate whichever end it is asked for", () => {
    expect(addNoteTag("#2026-07 Dinner", "#2026-07", "start")).toBe("#2026-07 Dinner");
  });

  it("prepends text before what is already there", () => {
    expect(prependNoteText("Dinner", "Checked")).toBe("Checked | Dinner");
  });

  it("writes prepended text alone into an empty note", () => {
    expect(prependNoteText(null, "Checked")).toBe("Checked");
  });
});
