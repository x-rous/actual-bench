import { IMAGE_HEIGHT, IMAGE_WIDTH, SHEET_MAX_PIXELS, SHEET_MAX_SIDE, sheetScale, svgsToSheetPng } from "./progressImage";

const svg = () => new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675"><rect width="1200" height="675"/></svg>`, "image/svg+xml").documentElement as unknown as SVGSVGElement;

describe("the sheet of pictures", () => {
  let made: string[];
  let revoked: string[];
  let sizes: { width: number; height: number }[];
  let draws: { x: number; y: number; w: number; h: number }[];
  let failAt: number | null;
  beforeEach(() => {
    made = []; revoked = []; sizes = []; draws = []; failAt = null;
    let n = 0;
    URL.createObjectURL = jest.fn(() => { const url = `blob:${n++}`; made.push(url); return url; });
    URL.revokeObjectURL = jest.fn((url: string) => { revoked.push(url); });
    class FakeImage {
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { setTimeout(() => (failAt !== null && value === `blob:${failAt}` ? this.onerror?.() : this.onload?.()), value === "blob:0" ? 10 : 0); }
    }
    (global as unknown as { Image: unknown }).Image = FakeImage;
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      // The canvas is measured when the first card is drawn on it.
      const measure = () => ({ width: this.width, height: this.height });
      return { fillRect: jest.fn(), set fillStyle(_v: string) {}, drawImage: (_i: unknown, x: number, y: number, w: number, h: number) => { draws.push({ x, y, w, h }); if (sizes.length === 0) sizes.push(measure()); } } as never;
    });
    jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["png"], { type: "image/png" })));
  });
  afterEach(() => jest.restoreAllMocks());

  it("is not scaled when it fits, and is scaled to fit the browser's canvas when it does not", () => {
    expect(sheetScale(2448, 2820)).toBe(1);
    const huge = sheetScale(2448, 20 * 699 + 24);
    expect(huge).toBeLessThan(1);
    expect(2448 * huge).toBeLessThanOrEqual(SHEET_MAX_SIDE);
    expect((20 * 699 + 24) * huge).toBeLessThanOrEqual(SHEET_MAX_SIDE);
    expect(2448 * huge * (20 * 699 + 24) * huge).toBeLessThanOrEqual(SHEET_MAX_PIXELS + 1);
  });

  it("keeps every card on a sheet of thirty, scaled down so the canvas is within its limits", async () => {
    await svgsToSheetPng(Array.from({ length: 30 }, svg), "#ccc");
    expect(draws).toHaveLength(30);
    const { width, height } = sizes[0];
    expect(Math.max(width, height)).toBeLessThanOrEqual(SHEET_MAX_SIDE);
    expect(width * height).toBeLessThanOrEqual(SHEET_MAX_PIXELS);
    // Each card is drawn at the same smaller size, still in the 16:9 shape.
    expect(draws[0].w).toBeLessThan(IMAGE_WIDTH);
    expect(draws[0].w / draws[0].h).toBeCloseTo(IMAGE_WIDTH / IMAGE_HEIGHT, 3);
    // Every card is inside the canvas, and none overlaps another.
    for (const d of draws) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.x + d.w).toBeLessThanOrEqual(width + 1e-6);
      expect(d.y + d.h).toBeLessThanOrEqual(height + 1e-6);
    }
    for (let i = 0; i < draws.length; i++) for (let j = i + 1; j < draws.length; j++) {
      const a = draws[i], b = draws[j];
      const apart = a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6 || a.y + a.h <= b.y + 1e-6 || b.y + b.h <= a.y + 1e-6;
      expect(apart).toBe(true);
    }
  });

  it("is drawn at full size when it fits", async () => {
    await svgsToSheetPng(Array.from({ length: 7 }, svg), "#ccc");
    expect(draws.every((d) => d.w === IMAGE_WIDTH && d.h === IMAGE_HEIGHT)).toBe(true);
    expect(sizes[0].width).toBe(2 * IMAGE_WIDTH + 3 * 24);
  });

  it("releases every address it made when all of the pictures loaded", async () => {
    await svgsToSheetPng(Array.from({ length: 5 }, svg), "#ccc");
    expect([...revoked].sort()).toEqual([...made].sort());
  });

  it("releases every address it made, including those that finish loading after another failed", async () => {
    failAt = 2;
    await expect(svgsToSheetPng(Array.from({ length: 5 }, svg), "#ccc")).rejects.toThrow("The picture could not be drawn");
    // The first picture loads late (after the failure): its address is still released.
    expect(made).toHaveLength(5);
    expect([...revoked].sort()).toEqual([...made].sort());
    expect(draws).toHaveLength(0);
  });
});
