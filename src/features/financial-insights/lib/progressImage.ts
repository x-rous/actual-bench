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

/** Draws the SVG on a 1200 × 675 canvas and returns it as a PNG. */
export async function svgToPng(svg: SVGSVGElement): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([serializeSvg(svg)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The picture could not be drawn"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_WIDTH;
    canvas.height = IMAGE_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot draw the picture");
    context.drawImage(image, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be saved"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
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
