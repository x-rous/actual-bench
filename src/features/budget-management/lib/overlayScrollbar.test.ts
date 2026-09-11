import { computeThumb, scrollPosFromThumbDelta, MIN_THUMB_PX } from "./overlayScrollbar";

describe("computeThumb", () => {
  it("draws nothing when the content fits", () => {
    expect(computeThumb(0, 500, 500, 500)).toBeNull();
    expect(computeThumb(0, 500, 400, 500)).toBeNull();
  });

  it("draws nothing before anything has been measured", () => {
    // jsdom reports zero sizes; so does the first paint before layout.
    expect(computeThumb(0, 0, 0, 0)).toBeNull();
  });

  it("sizes the thumb by how much of the content is visible", () => {
    // Half the content visible over a 400px track.
    expect(computeThumb(0, 500, 1000, 400)).toEqual({ offset: 0, size: 200 });
  });

  it("keeps a short thumb grabbable", () => {
    const thumb = computeThumb(0, 10, 100_000, 400);
    expect(thumb!.size).toBe(MIN_THUMB_PX);
  });

  it("lands flush with the end at full scroll, never past it", () => {
    const track = 400;
    const thumb = computeThumb(500, 500, 1000, track)!;
    expect(thumb.offset + thumb.size).toBe(track);
  });

  it("moves proportionally through the middle", () => {
    expect(computeThumb(250, 500, 1000, 400)!.offset).toBe(100);
  });
});

describe("scrollPosFromThumbDelta", () => {
  it("inverts computeThumb, so a drag tracks the pointer", () => {
    const [client, scroll, track] = [500, 1000, 400];
    const thumb = computeThumb(0, client, scroll, track)!;
    const travel = track - thumb.size;
    // Dragging the thumb its full travel scrolls the full content.
    expect(scrollPosFromThumbDelta(0, travel, client, scroll, track)).toBe(500);
  });

  it("clamps at both ends", () => {
    expect(scrollPosFromThumbDelta(0, -999, 500, 1000, 400)).toBe(0);
    expect(scrollPosFromThumbDelta(0, 9999, 500, 1000, 400)).toBe(500);
  });

  it("stays put when there is nothing to scroll", () => {
    expect(scrollPosFromThumbDelta(0, 50, 500, 500, 400)).toBe(0);
  });
});

describe("thumb never outgrows its track", () => {
  it("clamps to the track when the minimum would overflow it", () => {
    // A short pane: the 24px minimum is longer than the whole track.
    const thumb = computeThumb(0, 10, 100, 20)!;
    expect(thumb.size).toBe(20);
    expect(thumb.offset + thumb.size).toBeLessThanOrEqual(20);
  });

  it("leaves no travel in that case, so a drag cannot move the view", () => {
    expect(scrollPosFromThumbDelta(5, 100, 10, 100, 20)).toBe(5);
  });
});
