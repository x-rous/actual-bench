import { mergeDescriptionIntoNotes } from "./mergeDescription";

describe("bringing a note's merchant text up to the statement's", () => {
  it("extends a shortened merchant name", () => {
    // The case this exists for: automation captured less than the bank printed.
    const result = mergeDescriptionIntoNotes(
      "ROYAL CATERING SERVICE",
      "ROYAL CATERING SERVICE ABU DHABI UAE"
    );
    expect(result).toEqual({ changed: true, notes: "ROYAL CATERING SERVICE ABU DHABI UAE" });
  });

  it("keeps a workflow tag in front of it", () => {
    const result = mergeDescriptionIntoNotes(
      "#API ROYAL CATERING SERVICE",
      "ROYAL CATERING SERVICE ABU DHABI UAE"
    );
    expect(result).toEqual({
      changed: true,
      notes: "#API ROYAL CATERING SERVICE ABU DHABI UAE",
    });
  });

  it("keeps the user's own words after it", () => {
    // The whole reason this replaces a run rather than the note: these words are
    // the part worth keeping.
    const result = mergeDescriptionIntoNotes(
      "#API ROYAL CATERING SERVICE | dinner with Ahmad",
      "ROYAL CATERING SERVICE ABU DHABI UAE"
    );
    expect(result).toEqual({
      changed: true,
      notes: "#API ROYAL CATERING SERVICE ABU DHABI UAE | dinner with Ahmad",
    });
  });

  it("does nothing when the note already carries the full description", () => {
    const result = mergeDescriptionIntoNotes(
      "#API ROYAL CATERING SERVICE ABU DHABI UAE | dinner",
      "ROYAL CATERING SERVICE ABU DHABI UAE"
    );
    expect(result).toEqual({ changed: false, reason: "already-matches" });
  });

  it("is safe to run twice", () => {
    const once = mergeDescriptionIntoNotes(
      "#API ROYAL CATERING SERVICE",
      "ROYAL CATERING SERVICE ABU DHABI UAE"
    );
    if (!once.changed) throw new Error("expected a change");
    expect(mergeDescriptionIntoNotes(once.notes, "ROYAL CATERING SERVICE ABU DHABI UAE")).toEqual({
      changed: false,
      reason: "already-matches",
    });
  });

  it("writes the description into an empty note", () => {
    expect(mergeDescriptionIntoNotes(null, "ROYAL CATERING SERVICE ABU DHABI UAE")).toEqual({
      changed: true,
      notes: "ROYAL CATERING SERVICE ABU DHABI UAE",
    });
  });

  it("leaves a note alone when it shares nothing with the description", () => {
    // Rather than guessing where merchant text ends and the user's words begin.
    expect(mergeDescriptionIntoNotes("Dinner with Ahmad", "CARREFOUR MARKET DUBAI")).toEqual({
      changed: false,
      reason: "no-shared-text",
    });
  });

  it("does not treat an incidental short word as merchant text", () => {
    // "AE" appears in both but says nothing about the merchant.
    expect(mergeDescriptionIntoNotes("Paid AE", "TALABAT AE 88721")).toEqual({
      changed: false,
      reason: "no-shared-text",
    });
  });

  it("requires the shared words to be consecutive", () => {
    // Scattered coincidences are not the automation's capture of a name.
    expect(
      mergeDescriptionIntoNotes("ROYAL something SERVICE", "ROYAL CATERING SERVICE ABU DHABI")
    ).toEqual({ changed: false, reason: "no-shared-text" });
  });

  it("does nothing when there is no description to use", () => {
    expect(mergeDescriptionIntoNotes("#API ROYAL CATERING SERVICE", "  ")).toEqual({
      changed: false,
      reason: "nothing-to-add",
    });
  });

  it("matches regardless of case and punctuation", () => {
    const result = mergeDescriptionIntoNotes(
      "#API Royal Catering Service",
      "ROYAL CATERING SERVICE ABU DHABI UAE"
    );
    expect(result).toEqual({
      changed: true,
      notes: "#API ROYAL CATERING SERVICE ABU DHABI UAE",
    });
  });

  it("replaces the longest shared run, not the first short one", () => {
    const result = mergeDescriptionIntoNotes(
      "S103 TAMIMI MARKETS",
      "S103 TAMIMI MARKETS KHOBAR SAU"
    );
    expect(result).toEqual({ changed: true, notes: "S103 TAMIMI MARKETS KHOBAR SAU" });
  });
});

describe("notes whose merchant text is a single word", () => {
  it("extends a one-word note carrying a workflow tag", () => {
    // Real case: the automation captured only the merchant's short name.
    expect(
      mergeDescriptionIntoNotes("#2026-08 MOHESR", "MOHESR ABU DHABI AB")
    ).toEqual({ changed: true, notes: "#2026-08 MOHESR ABU DHABI AB" });
  });

  it("extends a bare one-word note", () => {
    expect(mergeDescriptionIntoNotes("STARBUCKS", "STARBUCKS MALL OF EMIRATES")).toEqual({
      changed: true,
      notes: "STARBUCKS MALL OF EMIRATES",
    });
  });

  it("keeps the user's own words after a one-word merchant", () => {
    expect(
      mergeDescriptionIntoNotes("STARBUCKS | paid by me", "STARBUCKS MALL OF EMIRATES")
    ).toEqual({ changed: true, notes: "STARBUCKS MALL OF EMIRATES | paid by me" });
  });

  it("still refuses when the note's matching words are scattered", () => {
    // The guard that made one-word runs suspect in the first place: another word
    // in the note also appears in the description, so the overlap is chance.
    expect(
      mergeDescriptionIntoNotes("ROYAL something SERVICE", "ROYAL CATERING SERVICE ABU DHABI")
    ).toEqual({ changed: false, reason: "no-shared-text" });
  });

  it("still refuses a word too short to identify anything", () => {
    expect(mergeDescriptionIntoNotes("AE", "TALABAT AE 88721")).toEqual({
      changed: false,
      reason: "no-shared-text",
    });
  });

  it("is still safe to run twice on a one-word note", () => {
    const once = mergeDescriptionIntoNotes("#2026-08 MOHESR", "MOHESR ABU DHABI AB");
    if (!once.changed) throw new Error("expected a change");
    expect(mergeDescriptionIntoNotes(once.notes, "MOHESR ABU DHABI AB")).toEqual({
      changed: false,
      reason: "already-matches",
    });
  });
});
