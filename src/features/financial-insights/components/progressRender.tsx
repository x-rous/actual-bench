import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { DebtChoice, ProgressCard } from "@/lib/financial-insights/progress";
import { ProgressArt, type ImageOptions } from "./ProgressArt";

/**
 * Draws a card as the picture that is saved, off screen, and returns its SVG. It is made synchronously, so a click handler can start the
 * export (and a Safari clipboard write) before it awaits anything. `dispose` removes it once the picture has been made.
 */
export function drawCard(card: ProgressCard, choice: DebtChoice | null, options: ImageOptions): { svg: SVGSVGElement; dispose: () => void } {
  const root = createRoot(document.createElement("div"));
  let svg: SVGSVGElement | null = null;
  flushSync(() => root.render(<ProgressArt card={card} choice={choice} options={options} svgRef={(node) => { if (node) svg = node; }} />));
  if (!svg) { root.unmount(); throw new Error("The picture could not be drawn"); }
  return { svg, dispose: () => root.unmount() };
}
