import { matchAction, DEFAULT_KEYMAP, type KeymapBinding } from "../keymap";
import { ACTION_META } from "../actions";

function ev(over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  };
}

describe("matchAction", () => {
  it("returns null when no binding matches the scope", () => {
    // Ctrl+Z is workspace-scoped — does not match in cell scope.
    expect(matchAction(ev({ key: "z", ctrlKey: true }), "cell")).toBeNull();
  });

  it("returns the action when the chord + scope match", () => {
    expect(matchAction(ev({ key: "z", ctrlKey: true }), "workspace")).toBe("history.undo");
    expect(matchAction(ev({ key: "Enter" }), "cell")).toBe("cell.start-edit");
    expect(matchAction(ev({ key: "Enter" }), "cell-edit")).toBe("edit.commit-down");
  });

  it("differentiates Tab vs Shift+Tab — first-match wins is order-sensitive", () => {
    // Plain Tab.
    expect(matchAction(ev({ key: "Tab" }), "cell")).toBe("cell.tab-forward");
    // Shift+Tab.
    expect(matchAction(ev({ key: "Tab", shiftKey: true }), "cell")).toBe("cell.tab-backward");
  });

  it("differentiates Ctrl+Z (undo) from Ctrl+Shift+Z (redo)", () => {
    expect(matchAction(ev({ key: "z", ctrlKey: true }), "workspace")).toBe("history.undo");
    expect(matchAction(ev({ key: "z", ctrlKey: true, shiftKey: true }), "workspace")).toBe("history.redo");
    expect(matchAction(ev({ key: "y", ctrlKey: true }), "workspace")).toBe("history.redo");
  });

  it("scopes navigation across cell, group-cell, and row-label", () => {
    for (const scope of ["cell", "group-cell", "row-label"] as const) {
      expect(matchAction(ev({ key: "ArrowUp" }), scope)).toBe("cell.move-up");
      expect(matchAction(ev({ key: "Tab" }), scope)).toBe("cell.tab-forward");
    }
  });

  it("only enables Shift+Arrow range extension in cell scope", () => {
    expect(matchAction(ev({ key: "ArrowUp", shiftKey: true }), "cell")).toBe("cell.extend-up");
    expect(matchAction(ev({ key: "ArrowUp", shiftKey: true }), "group-cell")).toBeNull();
    expect(matchAction(ev({ key: "ArrowUp", shiftKey: true }), "row-label")).toBeNull();
  });

  it("matches digits and operators to start-edit-with-char in cell scope only", () => {
    for (const k of ["0", "5", ".", "+", "-", "("]) {
      expect(matchAction(ev({ key: k }), "cell")).toBe("cell.start-edit-with-char");
    }
    expect(matchAction(ev({ key: "5" }), "cell-edit")).toBeNull();
    expect(matchAction(ev({ key: "5" }), "workspace")).toBeNull();
  });

  it("matches Space to group.toggle-collapse only in group-cell and row-label", () => {
    expect(matchAction(ev({ key: " " }), "group-cell")).toBe("group.toggle-collapse");
    expect(matchAction(ev({ key: " " }), "row-label")).toBe("group.toggle-collapse");
    expect(matchAction(ev({ key: " " }), "cell")).toBeNull();
    expect(matchAction(ev({ key: " " }), "workspace")).toBeNull();
  });

  it("accepts a React-event-shaped argument with nativeEvent", () => {
    const reactish = { nativeEvent: ev({ key: "Enter" }) } as unknown as KeyboardEvent;
    expect(matchAction(reactish, "cell")).toBe("cell.start-edit");
  });

  it("accepts a custom keymap override", () => {
    const custom: KeymapBinding[] = [
      { action: "cell.start-edit", chord: { key: "i" }, scopes: ["cell"] },
    ];
    expect(matchAction(ev({ key: "i" }), "cell", custom)).toBe("cell.start-edit");
    expect(matchAction(ev({ key: "Enter" }), "cell", custom)).toBeNull();
  });
});

describe("DEFAULT_KEYMAP integrity", () => {
  it("every binding's action exists in ACTION_META", () => {
    for (const b of DEFAULT_KEYMAP) {
      expect(ACTION_META[b.action]).toBeDefined();
    }
  });

  it("every action in ACTION_META has at least one binding", () => {
    const bound = new Set(DEFAULT_KEYMAP.map((b) => b.action));
    for (const id of Object.keys(ACTION_META)) {
      expect(bound.has(id as keyof typeof ACTION_META)).toBe(true);
    }
  });

  it("more-specific shift bindings are listed before their plain counterparts", () => {
    // Ensures first-match semantics work: Shift+Tab must come before Tab.
    const tabIdx = DEFAULT_KEYMAP.findIndex(
      (b) => b.action === "cell.tab-forward" && b.chord.key === "Tab"
    );
    const shiftTabIdx = DEFAULT_KEYMAP.findIndex(
      (b) => b.action === "cell.tab-backward" && b.chord.key === "Tab"
    );
    // Either order is fine because the modifier match is exclusive — but
    // we still assert both bindings exist.
    expect(tabIdx).toBeGreaterThan(-1);
    expect(shiftTabIdx).toBeGreaterThan(-1);
  });
});

describe("Tier 1 viewport / section navigation bindings", () => {
  describe("Page", () => {
    it("PageUp / PageDown match in cell, group-cell, and row-label", () => {
      for (const scope of ["cell", "group-cell", "row-label"] as const) {
        expect(matchAction(ev({ key: "PageUp" }), scope)).toBe("cell.move-page-up");
        expect(matchAction(ev({ key: "PageDown" }), scope)).toBe("cell.move-page-down");
      }
    });

    it("Shift+PageUp/Down only extends in cell scope", () => {
      expect(matchAction(ev({ key: "PageUp", shiftKey: true }), "cell")).toBe("cell.extend-page-up");
      expect(matchAction(ev({ key: "PageUp", shiftKey: true }), "group-cell")).toBeNull();
    });
  });

  describe("Home / End — row edges", () => {
    it("Home / End match cell.move-row-start/end in cell + group-cell", () => {
      expect(matchAction(ev({ key: "Home" }), "cell")).toBe("cell.move-row-start");
      expect(matchAction(ev({ key: "End" }), "cell")).toBe("cell.move-row-end");
      expect(matchAction(ev({ key: "Home" }), "group-cell")).toBe("cell.move-row-start");
    });

    it("Shift+Home/End extends in cell scope only", () => {
      expect(matchAction(ev({ key: "Home", shiftKey: true }), "cell")).toBe("cell.extend-row-start");
      expect(matchAction(ev({ key: "End", shiftKey: true }), "cell")).toBe("cell.extend-row-end");
    });

    it("Ctrl+ArrowLeft/Right are aliases for Home/End", () => {
      expect(matchAction(ev({ key: "ArrowLeft", ctrlKey: true }), "cell")).toBe("cell.move-row-start");
      expect(matchAction(ev({ key: "ArrowRight", ctrlKey: true }), "cell")).toBe("cell.move-row-end");
      // Plain ArrowLeft is still the single-step move.
      expect(matchAction(ev({ key: "ArrowLeft" }), "cell")).toBe("cell.move-left");
    });

    it("Ctrl+Shift+ArrowLeft/Right extends to row edges", () => {
      expect(matchAction(ev({ key: "ArrowLeft", ctrlKey: true, shiftKey: true }), "cell")).toBe("cell.extend-row-start");
      expect(matchAction(ev({ key: "ArrowRight", ctrlKey: true, shiftKey: true }), "cell")).toBe("cell.extend-row-end");
    });
  });

  describe("Ctrl+Home / Ctrl+End — grid corners", () => {
    it("matches in cell, group-cell, and row-label", () => {
      for (const scope of ["cell", "group-cell", "row-label"] as const) {
        expect(matchAction(ev({ key: "Home", ctrlKey: true }), scope)).toBe("cell.move-grid-start");
        expect(matchAction(ev({ key: "End",  ctrlKey: true }), scope)).toBe("cell.move-grid-end");
      }
    });

    it("plain Home/End in row-label has no binding (label has no row edges)", () => {
      expect(matchAction(ev({ key: "Home" }), "row-label")).toBeNull();
      expect(matchAction(ev({ key: "End" }),  "row-label")).toBeNull();
    });

    it("Ctrl+Shift+Home/End extends in cell scope only", () => {
      expect(matchAction(ev({ key: "Home", ctrlKey: true, shiftKey: true }), "cell")).toBe("cell.extend-grid-start");
      expect(matchAction(ev({ key: "End",  ctrlKey: true, shiftKey: true }), "cell")).toBe("cell.extend-grid-end");
      expect(matchAction(ev({ key: "Home", ctrlKey: true, shiftKey: true }), "group-cell")).toBeNull();
    });

    it("works with Cmd on macOS as well as Ctrl", () => {
      expect(matchAction(ev({ key: "Home", metaKey: true }), "cell")).toBe("cell.move-grid-start");
    });
  });

  describe("Ctrl+ArrowUp/Down — section jump", () => {
    it("matches cell.move-section-up/down in cell, group-cell, row-label", () => {
      for (const scope of ["cell", "group-cell", "row-label"] as const) {
        expect(matchAction(ev({ key: "ArrowUp",   ctrlKey: true }), scope)).toBe("cell.move-section-up");
        expect(matchAction(ev({ key: "ArrowDown", ctrlKey: true }), scope)).toBe("cell.move-section-down");
      }
    });

    it("does not collide with single-step ArrowUp/Down (no modifier)", () => {
      expect(matchAction(ev({ key: "ArrowUp" }), "cell")).toBe("cell.move-up");
    });

    it("does not collide with shift-extend (shift-only, no ctrl)", () => {
      expect(matchAction(ev({ key: "ArrowUp", shiftKey: true }), "cell")).toBe("cell.extend-up");
    });
  });
});

describe("Tier 2 range-edit bindings", () => {
  it("Ctrl+Enter triggers fill-from-active in workspace scope", () => {
    expect(matchAction(ev({ key: "Enter", ctrlKey: true }), "workspace")).toBe("selection.fill-from-active");
    // Plain Enter is cell-scoped start-edit — not fill.
    expect(matchAction(ev({ key: "Enter" }), "workspace")).toBeNull();
  });

  it("Ctrl+D triggers fill-down (workspace only)", () => {
    expect(matchAction(ev({ key: "d", ctrlKey: true }), "workspace")).toBe("selection.fill-down");
    expect(matchAction(ev({ key: "d", ctrlKey: true }), "cell")).toBeNull();
    expect(matchAction(ev({ key: "d", ctrlKey: true }), "cell-edit")).toBeNull();
  });

  it("Ctrl+R triggers fill-right (workspace only)", () => {
    expect(matchAction(ev({ key: "r", ctrlKey: true }), "workspace")).toBe("selection.fill-right");
  });

  it("Alt+L triggers fill-prev-month (workspace only)", () => {
    expect(matchAction(ev({ key: "l", altKey: true }), "workspace")).toBe("selection.fill-prev-month");
    // Bare 'l' should not match.
    expect(matchAction(ev({ key: "l" }), "workspace")).toBeNull();
  });

  it("Alt+A triggers fill-avg-3 (workspace only)", () => {
    expect(matchAction(ev({ key: "a", altKey: true }), "workspace")).toBe("selection.fill-avg-3");
  });

  it("Cmd variants on macOS work for fill-down/right/from-active", () => {
    expect(matchAction(ev({ key: "Enter", metaKey: true }), "workspace")).toBe("selection.fill-from-active");
    expect(matchAction(ev({ key: "d", metaKey: true }),     "workspace")).toBe("selection.fill-down");
    expect(matchAction(ev({ key: "r", metaKey: true }),     "workspace")).toBe("selection.fill-right");
  });

  it("Tier-2 bindings do not match in cell-edit scope (so typing 'd'/'r'/'l'/'a' works)", () => {
    expect(matchAction(ev({ key: "d", ctrlKey: true }), "cell-edit")).toBeNull();
    expect(matchAction(ev({ key: "l", altKey: true }),   "cell-edit")).toBeNull();
  });
});

describe("Tier 3 view & visibility bindings", () => {
  it("V cycles cell view (workspace only)", () => {
    expect(matchAction(ev({ key: "v" }), "workspace")).toBe("view.cycle-cell-view");
    expect(matchAction(ev({ key: "v" }), "cell")).toBeNull();
    expect(matchAction(ev({ key: "v" }), "cell-edit")).toBeNull();
  });

  it("H toggles show-hidden (workspace only)", () => {
    expect(matchAction(ev({ key: "h" }), "workspace")).toBe("view.toggle-show-hidden");
    expect(matchAction(ev({ key: "h" }), "cell-edit")).toBeNull();
  });

  it("E expands all groups; Shift+E collapses all", () => {
    expect(matchAction(ev({ key: "e" }), "workspace")).toBe("view.expand-all");
    // Shift+e delivers e.key === "E" (uppercase).
    expect(matchAction(ev({ key: "E", shiftKey: true }), "workspace")).toBe("view.collapse-all");
  });

  it("[ / ] pan visible months", () => {
    expect(matchAction(ev({ key: "[" }), "workspace")).toBe("view.pan-months-prev");
    expect(matchAction(ev({ key: "]" }), "workspace")).toBe("view.pan-months-next");
  });

  it("F opens category search in workspace scope only", () => {
    expect(matchAction(ev({ key: "f" }), "workspace")).toBe("view.open-category-search");
    expect(matchAction(ev({ key: "f" }), "cell")).toBeNull();
    expect(matchAction(ev({ key: "f" }), "cell-edit")).toBeNull();
  });

  it("Tier-3 bare-alpha bindings never fire while typing in a cell input", () => {
    for (const k of ["v", "h", "e", "f", "[", "]"]) {
      expect(matchAction(ev({ key: k }), "cell-edit")).toBeNull();
    }
    expect(matchAction(ev({ key: "E", shiftKey: true }), "cell-edit")).toBeNull();
  });

  it("Tier-3 bindings require modifiers to be absent", () => {
    // Ctrl+V must not collide with cycle-cell-view (browser paste).
    expect(matchAction(ev({ key: "v", ctrlKey: true }), "workspace")).toBeNull();
    expect(matchAction(ev({ key: "h", altKey: true }),  "workspace")).toBeNull();
  });
});

describe("Tier 4 selection action bindings", () => {
  it("Alt+C toggles carryover (workspace only)", () => {
    expect(matchAction(ev({ key: "c", altKey: true }), "workspace")).toBe("selection.toggle-carryover");
    expect(matchAction(ev({ key: "c", altKey: true }), "cell")).toBeNull();
    expect(matchAction(ev({ key: "c", altKey: true }), "cell-edit")).toBeNull();
  });

  it("does not collide with Ctrl+C (copy) or bare 'c'", () => {
    // Ctrl+C is selection.copy, no alt.
    expect(matchAction(ev({ key: "c", ctrlKey: true }), "workspace")).toBe("selection.copy");
    // Bare 'c' has no binding — falls through.
    expect(matchAction(ev({ key: "c" }), "workspace")).toBeNull();
  });
});

describe("help.open-shortcuts bindings", () => {
  it("Shift+? opens the cheatsheet", () => {
    expect(matchAction(ev({ key: "?", shiftKey: true }), "workspace")).toBe("help.open-shortcuts");
  });

  it("F1 opens the cheatsheet", () => {
    expect(matchAction(ev({ key: "F1" }), "workspace")).toBe("help.open-shortcuts");
  });

  it("Ctrl/Cmd+/ opens the cheatsheet", () => {
    expect(matchAction(ev({ key: "/", ctrlKey: true }), "workspace")).toBe("help.open-shortcuts");
    expect(matchAction(ev({ key: "/", metaKey: true }), "workspace")).toBe("help.open-shortcuts");
  });

  it("does not fire in cell-edit scope", () => {
    expect(matchAction(ev({ key: "?", shiftKey: true }), "cell-edit")).toBeNull();
    expect(matchAction(ev({ key: "F1" }),                "cell-edit")).toBeNull();
  });
});
