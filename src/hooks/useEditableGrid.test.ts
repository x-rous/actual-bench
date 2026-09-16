/**
 * @jest-environment jsdom
 */
import { isFormField } from "./useEditableGrid";

/*
 * The grid's key handler sits on a container that also holds the filter bar, so
 * every keystroke in the search box bubbles through it. While a cell is
 * selected - which it is after any rename - a printable character was read as
 * "start editing that cell", so searching after renaming a payee typed into the
 * payee. Arrow keys moved the selection instead of the caret; Tab went nowhere.
 *
 * Four tables share the hook and all four behaved this way: accounts,
 * categories, payees and tags.
 */
describe("isFormField", () => {
  function el(tag: string, contentEditable = false): HTMLElement {
    const node = document.createElement(tag);
    if (contentEditable) node.setAttribute("contenteditable", "true");
    return node;
  }

  it("claims the controls a user types into", () => {
    expect(isFormField(el("input"))).toBe(true);
    expect(isFormField(el("textarea"))).toBe(true);
    expect(isFormField(el("select"))).toBe(true);
  });

  it("claims a checkbox, so Space toggles it rather than starting an edit", () => {
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(isFormField(box)).toBe(true);
  });

  it("claims a contenteditable element", () => {
    const node = el("div", true);
    // jsdom does not derive `isContentEditable` from the attribute.
    Object.defineProperty(node, "isContentEditable", { value: true });
    expect(isFormField(node)).toBe(true);
  });

  it("leaves the grid's own cells alone, so navigation still works", () => {
    expect(isFormField(el("td"))).toBe(false);
    expect(isFormField(el("div"))).toBe(false);
    expect(isFormField(el("button"))).toBe(false);
  });

  it("is safe when the event has no element target", () => {
    expect(isFormField(null)).toBe(false);
    expect(isFormField(document)).toBe(false);
  });
});
