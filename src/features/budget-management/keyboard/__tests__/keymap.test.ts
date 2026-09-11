import { matchAction, DEFAULT_KEYMAP, type KeymapBinding } from "../keymap";
import { ACTION_META } from "../actions";

/**
 * The keymap is data, so it is tested as data.
 *
 * This used to be forty-odd one-line tests, each restating one row of
 * DEFAULT_KEYMAP in prose. That is a second copy of the table maintained by
 * hand, and when a binding moved it failed one assertion at a time. The tables
 * below are asserted whole, so a scope or modifier change reports every chord it
 * affected in one diff instead of the first one alphabetically.
 *
 * The tests that are NOT tables are the ones that catch real bugs: the
 * integrity checks over DEFAULT_KEYMAP, and the collision guards where two
 * bindings could plausibly claim the same chord.
 */

type Scope = "cell" | "group-cell" | "row-label" | "workspace" | "cell-edit";
type Action = string | null;
/** [chord, scope, expected action] — null means "deliberately unbound here". */
type Row = [string, Scope, Action];

const ALL_GRID_SCOPES: Scope[] = ["cell", "group-cell", "row-label"];

/**
 * "Ctrl+Shift+ArrowLeft" → the event shape matchAction reads.
 *
 * The separator is also a bindable key, so a spec ending in "+" means the plus
 * key itself ("+" and "Ctrl++" both work).
 */
function chord(spec: string) {
  const endsWithPlus = spec.endsWith("+");
  const cut = endsWithPlus ? spec.length - 1 : spec.lastIndexOf("+") + 1;
  const key = endsWithPlus ? "+" : spec.slice(cut);
  const mods = spec.slice(0, Math.max(0, cut - 1)).split("+");
  const has = (m: string) => mods.includes(m);
  return {
    key: key === "Space" ? " " : key,
    ctrlKey: has("Ctrl"),
    metaKey: has("Cmd"),
    shiftKey: has("Shift"),
    altKey: has("Alt"),
  };
}

/**
 * Assert a whole table at once. Comparing arrays rather than looping with a
 * bare expect() means the failure output is the table with the wrong rows in
 * it, not "expected null, received cell.move-up" with no chord attached.
 */
function expectBindings(rows: Row[]) {
  const actual = rows.map(([spec, scope]) => [spec, scope, matchAction(chord(spec) as never, scope)]);
  expect(actual).toEqual(rows.map((r) => [...r]));
}

/** The same chord expected to resolve identically in several scopes. */
function inScopes(scopes: Scope[], entries: [string, Action][]): Row[] {
  return scopes.flatMap((scope) => entries.map(([spec, action]): Row => [spec, scope, action]));
}

describe("matchAction — argument handling", () => {
  it("accepts a React-event-shaped argument with nativeEvent", () => {
    const reactish = { nativeEvent: chord("Enter") } as unknown as KeyboardEvent;
    expect(matchAction(reactish, "cell")).toBe("cell.start-edit");
  });

  it("accepts a custom keymap override, ignoring the default bindings", () => {
    const custom: KeymapBinding[] = [
      { action: "cell.start-edit", chord: { key: "i" }, scopes: ["cell"] },
    ];
    expect(matchAction(chord("i") as never, "cell", custom)).toBe("cell.start-edit");
    expect(matchAction(chord("Enter") as never, "cell", custom)).toBeNull();
  });
});

describe("DEFAULT_KEYMAP integrity", () => {
  it("every binding's action exists in ACTION_META", () => {
    const orphans = DEFAULT_KEYMAP.filter((b) => !ACTION_META[b.action]).map((b) => b.action);
    expect(orphans).toEqual([]);
  });

  it("every action in ACTION_META has at least one binding", () => {
    const bound = new Set(DEFAULT_KEYMAP.map((b) => b.action));
    const unbound = Object.keys(ACTION_META).filter((id) => !bound.has(id as keyof typeof ACTION_META));
    expect(unbound).toEqual([]);
  });

  it("binds both halves of the order-sensitive Tab pair", () => {
    // First-match semantics: the modifier match is exclusive so either order is
    // fine, but both bindings must exist or Shift+Tab silently becomes Tab.
    const tabBindings = DEFAULT_KEYMAP.filter((b) => b.chord.key === "Tab").map((b) => b.action);
    expect(tabBindings).toEqual(expect.arrayContaining(["cell.tab-forward", "cell.tab-backward"]));
  });
});

describe("grid navigation", () => {
  it("moves and tabs identically in every grid scope", () => {
    expectBindings(
      inScopes(ALL_GRID_SCOPES, [
        ["ArrowUp", "cell.move-up"],
        ["Tab", "cell.tab-forward"],
        ["Shift+Tab", "cell.tab-backward"],
        ["PageUp", "cell.move-page-up"],
        ["PageDown", "cell.move-page-down"],
        ["Ctrl+Home", "cell.move-grid-start"],
        ["Ctrl+End", "cell.move-grid-end"],
        ["Ctrl+ArrowUp", "cell.move-section-up"],
        ["Ctrl+ArrowDown", "cell.move-section-down"],
      ])
    );
  });

  it("restricts row-edge moves to the scopes that have row edges", () => {
    expectBindings([
      ["Home", "cell", "cell.move-row-start"],
      ["End", "cell", "cell.move-row-end"],
      ["Home", "group-cell", "cell.move-row-start"],
      ["End", "group-cell", "cell.move-row-end"],
      // A row label has no row edges of its own.
      ["Home", "row-label", null],
      ["End", "row-label", null],
    ]);
  });

  it("treats Ctrl+Arrow as an alias for Home/End without shadowing single steps", () => {
    expectBindings([
      ["Ctrl+ArrowLeft", "cell", "cell.move-row-start"],
      ["Ctrl+ArrowRight", "cell", "cell.move-row-end"],
      ["ArrowLeft", "cell", "cell.move-left"],
      ["ArrowRight", "cell", "cell.move-right"],
    ]);
  });

  it("accepts Cmd wherever it accepts Ctrl, for macOS", () => {
    expectBindings([
      ["Cmd+Home", "cell", "cell.move-grid-start"],
      ["Cmd+End", "cell", "cell.move-grid-end"],
      ["Cmd+Enter", "workspace", "selection.fill-from-active"],
      ["Cmd+d", "workspace", "selection.fill-down"],
      ["Cmd+r", "workspace", "selection.fill-right"],
      ["Cmd+/", "workspace", "help.open-shortcuts"],
    ]);
  });
});

describe("range extension is cell-scoped only", () => {
  it("extends in cell scope and nowhere else", () => {
    // Extending a selection from a group row or a row label has no meaning, and
    // a stray binding there would move the grid instead of extending.
    expectBindings([
      ["Shift+ArrowUp", "cell", "cell.extend-up"],
      ["Shift+PageUp", "cell", "cell.extend-page-up"],
      ["Shift+Home", "cell", "cell.extend-row-start"],
      ["Shift+End", "cell", "cell.extend-row-end"],
      ["Ctrl+Shift+ArrowLeft", "cell", "cell.extend-row-start"],
      ["Ctrl+Shift+ArrowRight", "cell", "cell.extend-row-end"],
      ["Ctrl+Shift+Home", "cell", "cell.extend-grid-start"],
      ["Ctrl+Shift+End", "cell", "cell.extend-grid-end"],

      ["Shift+ArrowUp", "group-cell", null],
      ["Shift+ArrowUp", "row-label", null],
      ["Shift+PageUp", "group-cell", null],
      ["Ctrl+Shift+Home", "group-cell", null],
    ]);
  });
});

describe("editing entry points", () => {
  it("starts and commits an edit in the right scope", () => {
    expectBindings([
      ["Enter", "cell", "cell.start-edit"],
      ["Enter", "cell-edit", "edit.commit-down"],
      ["Enter", "workspace", null],
    ]);
  });

  it("starts an edit from any character that could begin an amount", () => {
    expectBindings([
      ...(["0", "5", ".", "+", "-", "("].map((k): Row => [k, "cell", "cell.start-edit-with-char"])),
      // "+" is both this table's separator and a real binding; the chord parser
      // above resolves that, and this row is what proves it.
      // Not while already editing, and not from the workspace.
      ["5", "cell-edit", null],
      ["5", "workspace", null],
    ]);
  });

  it("toggles a group from the label or the group cell, but not from a value cell", () => {
    expectBindings([
      ["Space", "group-cell", "group.toggle-collapse"],
      ["Space", "row-label", "group.toggle-collapse"],
      ["Space", "cell", null],
      ["Space", "workspace", null],
    ]);
  });
});

describe("workspace commands", () => {
  it("binds the fill, view and selection commands to the workspace", () => {
    expectBindings([
      ["Ctrl+Enter", "workspace", "selection.fill-from-active"],
      ["Ctrl+d", "workspace", "selection.fill-down"],
      ["Ctrl+r", "workspace", "selection.fill-right"],
      ["Alt+l", "workspace", "selection.fill-prev-month"],
      ["Alt+a", "workspace", "selection.fill-avg-3"],
      ["Alt+c", "workspace", "selection.toggle-carryover"],
      ["Ctrl+c", "workspace", "selection.copy"],
      ["Ctrl+z", "workspace", "history.undo"],
      ["Ctrl+Shift+z", "workspace", "history.redo"],
      ["Ctrl+y", "workspace", "history.redo"],
      ["v", "workspace", "view.cycle-cell-view"],
      ["h", "workspace", "view.toggle-show-hidden"],
      ["e", "workspace", "view.expand-all"],
      // Shift+e delivers e.key === "E".
      ["Shift+E", "workspace", "view.collapse-all"],
      ["[", "workspace", "view.pan-months-prev"],
      ["]", "workspace", "view.pan-months-next"],
      ["f", "workspace", "view.open-category-search"],
      ["d", "workspace", "view.open-spending-details"],
      ["Shift+?", "workspace", "help.open-shortcuts"],
      ["F1", "workspace", "help.open-shortcuts"],
      ["Ctrl+/", "workspace", "help.open-shortcuts"],
    ]);
  });

  it("keeps workspace commands out of the cell scopes", () => {
    expectBindings([
      ["Ctrl+z", "cell", null],
      ["Ctrl+d", "cell", null],
      ["Alt+c", "cell", null],
      ["v", "cell", null],
      ["f", "cell", null],
    ]);
  });
});

describe("collision guards", () => {
  it("never fires a workspace command while the user is typing in a cell", () => {
    // The whole point of cell-edit scope: typing "d" into an amount must not
    // fill the column down, and Ctrl+D must not either.
    const typed: Row[] = ["v", "h", "e", "f", "[", "]", "5", "d", "r", "l", "a", "c"].map(
      (k): Row => [k, "cell-edit", null]
    );
    expectBindings([
      ...typed,
      ["Shift+E", "cell-edit", null],
      ["Ctrl+d", "cell-edit", null],
      ["Ctrl+r", "cell-edit", null],
      ["Alt+l", "cell-edit", null],
      ["Alt+c", "cell-edit", null],
      ["Shift+?", "cell-edit", null],
      ["F1", "cell-edit", null],
    ]);
  });

  it("requires bare-letter commands to have no modifier at all", () => {
    // Ctrl+V is the browser's paste; if it also cycled the cell view the user
    // would get both.
    expectBindings([
      ["Ctrl+v", "workspace", null],
      ["Alt+h", "workspace", null],
      // No bare binding at all: these letters exist only as Alt chords.
      ["l", "workspace", null],
      ["c", "workspace", null],
      ["a", "workspace", null],
    ]);
  });

  it("distinguishes the chords that differ only by a modifier", () => {
    expectBindings([
      ["Ctrl+z", "workspace", "history.undo"],
      ["Ctrl+Shift+z", "workspace", "history.redo"],
      ["Ctrl+c", "workspace", "selection.copy"],
      ["Alt+c", "workspace", "selection.toggle-carryover"],
      ["ArrowUp", "cell", "cell.move-up"],
      ["Shift+ArrowUp", "cell", "cell.extend-up"],
      ["Ctrl+ArrowUp", "cell", "cell.move-section-up"],
      ["Tab", "cell", "cell.tab-forward"],
      ["Shift+Tab", "cell", "cell.tab-backward"],
      // Bare "d" opens spending details; Ctrl+D fills the column down. One
      // modifier apart, and nothing in the old suite checked the bare half.
      ["d", "workspace", "view.open-spending-details"],
      ["Ctrl+d", "workspace", "selection.fill-down"],
    ]);
  });
});

describe("fill shortcuts", () => {
  it("binds each average window and the prior-year copy distinctly", () => {
    expectBindings([
      ["Alt+l",          "workspace", "selection.fill-prev-month"],
      ["Alt+a",          "workspace", "selection.fill-avg-3"],
      ["Alt+Shift+A",    "workspace", "selection.fill-avg-6"],
      ["Ctrl+Alt+a",     "workspace", "selection.fill-avg-12"],
      ["Alt+y",          "workspace", "selection.fill-prior-year"],
    ]);
  });

  it("keeps the fill chords out of the grid scopes", () => {
    expectBindings(
      inScopes(ALL_GRID_SCOPES, [
        ["Alt+Shift+A", null],
        ["Ctrl+Alt+a", null],
        ["Alt+y", null],
      ])
    );
  });

  it("does not let Alt+A shadow Alt+Shift+A", () => {
    // Modifier flags are exclusive, so the 3-month and 6-month fills stay
    // distinct even though they share a letter.
    expectBindings([
      ["Alt+a",       "workspace", "selection.fill-avg-3"],
      ["Alt+Shift+A", "workspace", "selection.fill-avg-6"],
    ]);
  });
});

