/** Saving a Progress card as an image, with the browser's canvas and no library. The picture is the SVG the Share preview shows. */

export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 675;

/** The drawing as a standalone SVG file's text, at its full size and with nothing but what it draws. */
export function serializeSvg(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("width", String(IMAGE_WIDTH));
  copy.setAttribute("height", String(IMAGE_HEIGHT));
  copy.removeAttribute("style");
  copy.removeAttribute("aria-hidden");
  const text = new XMLSerializer().serializeToString(copy);
  // The serializer declares the namespace once on the root; a file without it would not load as a picture.
  return text.includes('xmlns="http://www.w3.org/2000/svg"') ? text : text.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
}

/** Loads a drawing as a picture the canvas can use. The caller revokes `url` when it is done. */
async function loadSvg(svg: SVGSVGElement): Promise<{ image: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(new Blob([serializeSvg(svg)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The picture could not be drawn"));
      image.src = url;
    });
    return { image, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be saved"))), "image/png"));
}

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the picture");
  return context;
}

/** Draws the SVG on a 1200 × 675 canvas and returns it as a PNG. */
export async function svgToPng(svg: SVGSVGElement): Promise<Blob> {
  const { image, url } = await loadSvg(svg);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_WIDTH;
    canvas.height = IMAGE_HEIGHT;
    contextOf(canvas).drawImage(image, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
    return await canvasPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The sheet of pictures: this many to a row, with this much space around and between them. */
export const SHEET_COLUMNS = 2;
export const SHEET_GAP = 24;

/** The most a canvas is trusted to hold: the larger side, and the number of pixels (browsers, Safari above all, refuse or blank a bigger one). */
export const SHEET_MAX_SIDE = 8192;
export const SHEET_MAX_PIXELS = 16_000_000;

/** How much to scale a sheet of this size down so it is within what a canvas can hold; 1 when it already is. */
export function sheetScale(width: number, height: number): number {
  return Math.min(1, SHEET_MAX_SIDE / width, SHEET_MAX_SIDE / height, Math.sqrt(SHEET_MAX_PIXELS / (width * height)));
}

/**
 * Puts several cards' pictures on one sheet, two to a row, as a single PNG. The clipboard holds one image, so this is how a set of cards is
 * copied at once. `background` fills the space between them. A sheet too big for a canvas is scaled down, so every card is still on it.
 */
export async function svgsToSheetPng(svgs: readonly SVGSVGElement[], background: string): Promise<Blob> {
  if (svgs.length === 0) throw new Error("There is no picture to copy");
  // Every picture is loaded before any is used, and every address made is released whether or not all of them loaded.
  const results = await Promise.allSettled(svgs.map(loadSvg));
  const loaded = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  try {
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
    const rows = Math.ceil(loaded.length / SHEET_COLUMNS);
    const width = SHEET_COLUMNS * IMAGE_WIDTH + (SHEET_COLUMNS + 1) * SHEET_GAP;
    const height = rows * IMAGE_HEIGHT + (rows + 1) * SHEET_GAP;
    const scale = sheetScale(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    const context = contextOf(canvas);
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    loaded.forEach(({ image }, i) => {
      const x = SHEET_GAP + (i % SHEET_COLUMNS) * (IMAGE_WIDTH + SHEET_GAP);
      const y = SHEET_GAP + Math.floor(i / SHEET_COLUMNS) * (IMAGE_HEIGHT + SHEET_GAP);
      context.drawImage(image, x * scale, y * scale, IMAGE_WIDTH * scale, IMAGE_HEIGHT * scale);
    });
    return await canvasPng(canvas);
  } finally {
    loaded.forEach(({ url }) => URL.revokeObjectURL(url));
  }
}

/** Whether the browser can put a PNG on the clipboard. */
export const canCopyImage = (): boolean => typeof navigator !== "undefined" && !!navigator.clipboard && typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined";

/** Puts a PNG on the clipboard. It takes the picture as a promise, not a finished blob: Safari ties a clipboard write to the click, and a write that waits for the picture first is refused. */
export async function copyPng(png: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export function downloadPng(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
