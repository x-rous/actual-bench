import { SIDEBAR_SECTIONS } from "@/components/layout/Sidebar";
import { ENTITY_CARDS, TOOL_CARDS } from "./overviewCards";

/**
 * The overview's cards are a second route to the same destinations as the
 * sidebar. Listing them in a different order makes the page read as a different
 * set of tools, and it drifts silently: nothing fails when someone adds a
 * navigation entry and forgets the card, or adds a card in the wrong place.
 */

function navHrefs(sectionLabel: string): string[] {
  const section = SIDEBAR_SECTIONS.find(
    (entry) => entry.type === "group" && entry.group.label === sectionLabel
  );
  if (!section || section.type !== "group") throw new Error(`no ${sectionLabel} section`);
  return section.group.items.map((item) => item.href);
}

/** Card order must appear in nav order, though not every entry needs a card. */
function isSubsequence(cards: string[], nav: string[]): boolean {
  let index = 0;
  for (const href of nav) {
    if (href === cards[index]) index += 1;
  }
  return index === cards.length;
}

describe("overview cards follow the sidebar", () => {
  it("lists the data-management cards in navigation order", () => {
    const cards = ENTITY_CARDS.map((card) => card.href!);
    expect(isSubsequence(cards, navHrefs("Data Management"))).toBe(true);
  });

  it("lists the tool cards in navigation order", () => {
    const cards = TOOL_CARDS.map((card) => card.href!);
    expect(isSubsequence(cards, navHrefs("Tools"))).toBe(true);
  });

  it("points every card at a real navigation destination", () => {
    const known = new Set([...navHrefs("Data Management"), ...navHrefs("Tools")]);
    for (const card of [...ENTITY_CARDS, ...TOOL_CARDS]) {
      expect(known.has(card.href!)).toBe(true);
    }
  });

  it("offers a card for bank reconciliation", () => {
    expect(TOOL_CARDS.some((card) => card.href === "/reconciliation")).toBe(true);
  });

  it("leaves FX Rates to the sidebar", () => {
    // It supports currency conversion in Budget File Sync rather than being
    // somewhere to go in its own right.
    expect(TOOL_CARDS.some((card) => card.href === "/fx-rates")).toBe(false);
    expect(navHrefs("Tools")).toContain("/fx-rates");
  });
});
