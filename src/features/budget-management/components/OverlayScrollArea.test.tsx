/**
 * The thumbs are revealed by hovering and by scrolling. Scrolling also starts
 * an idle timer that hides them again; hovering had no such counterpart, so a
 * pointer crossing the grid without scrolling left them on indefinitely.
 *
 * jsdom reports every element as zero-sized and has no ResizeObserver, so both
 * are supplied here - without them the component measures nothing and renders
 * no thumbs at all, which is exactly why the geometry lives in a pure module.
 */
import { render, fireEvent } from "@testing-library/react";
import { OverlayScrollArea } from "./OverlayScrollArea";

const sizes = { clientHeight: 100, scrollHeight: 300, clientWidth: 100, scrollWidth: 100 };
const originals: Record<string, PropertyDescriptor | undefined> = {};

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  for (const [key, value] of Object.entries(sizes)) {
    originals[key] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get: () => value,
    });
  }
});

afterAll(() => {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
});

function renderArea() {
  const { container } = render(
    <OverlayScrollArea className="h-full">
      <div>rows</div>
    </OverlayScrollArea>
  );
  const root = container.firstElementChild as HTMLElement;
  const thumb = () => root.querySelector("[aria-hidden='true'].rounded-full") as HTMLElement;
  return { root, thumb };
}

describe("OverlayScrollArea thumb visibility", () => {
  it("draws a thumb once the content overflows", () => {
    const { thumb } = renderArea();
    expect(thumb()).not.toBeNull();
  });

  it("reveals the thumb on hover", () => {
    const { root, thumb } = renderArea();
    fireEvent.mouseEnter(root);
    expect(thumb().className).toContain("opacity-100");
  });

  it("hides it again when the pointer leaves", () => {
    const { root, thumb } = renderArea();
    fireEvent.mouseEnter(root);
    expect(thumb().className).toContain("opacity-100");

    fireEvent.mouseLeave(root);
    expect(thumb().className).toContain("opacity-0");
  });

  it("takes no width from the content", () => {
    // The whole point: the scrolling element is full width and the thumbs are
    // painted over it, so opening a group cannot reflow the grid.
    const { root } = renderArea();
    const scroller = root.querySelector(".overflow-auto") as HTMLElement;
    expect(scroller.className).toContain("w-full");
    expect(scroller.className).toContain("[&::-webkit-scrollbar]:hidden");
  });
});
