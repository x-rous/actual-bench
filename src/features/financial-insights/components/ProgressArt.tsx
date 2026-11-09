import type { DebtChoice, ProgressCard } from "@/lib/financial-insights/progress";
import { FONT_STACK, IMAGE_PALETTES } from "../lib/progressPalette";
import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../lib/progressImage";
import { ACTUAL_BENCH_ICON } from "../lib/progressIcon";
import { CardChart, labelsOf, notesOf } from "./ProgressCharts";

export type ImageOptions = { showDates: boolean; showText: boolean; theme: "light" | "dark" };

/** The line under the title: what the figure is as of, or the choice shown. */
function subtitleOf(card: ProgressCard, choice: DebtChoice | null): string | null {
  if (card.kind === "buffer") return card.asOf;
  if (card.kind === "consistency" || card.kind === "composition" || card.kind === "journey") return card.note;
  if (card.kind === "debt") return choice?.label ?? null;
  return null;
}

/**
 * A card as one picture, 1200 × 675: title, at most three lines, the chart, and the Actual Bench icon at the top left with the title to its right (always there). It is drawn only from the card's
 * `ProgressView` data, in colours written out for the theme (no stylesheet, no CSS variable), so the drawing can be saved as it
 * stands. It carries no title element, no `data-*` attribute and no hidden text: what is on the picture is all there is.
 */
export function ProgressArt({ card, choice, options, svgRef }: { card: ProgressCard; choice: DebtChoice | null; options: ImageOptions; svgRef?: (node: SVGSVGElement | null) => void }) {
  const palette = IMAGE_PALETTES[options.theme];
  const text = { fontFamily: FONT_STACK } as const;
  const lines = labelsOf(card, choice, options.showDates, options.showText);
  const subtitle = subtitleOf(card, choice);
  const notes = notesOf(card, options.showText);
  // The chart's frame: below the lines, and above the notes, which stack up from the foot of the picture (the chart keeps its 720 × 280 shape).
  const top = lines.length > 0 ? 250 : 150;
  const bottom = Math.min(lines.length > 0 ? 623 : 574, 661 - Math.max(0, notes.length - 1) * 20 - 22);
  const height = bottom - top;
  const width = Math.min(lines.length > 0 ? 960 : 1040, (height * 720) / 280);
  const frame = { x: (IMAGE_WIDTH - width) / 2, y: top, width };
  // A card with no chart to draw (no income, nothing to show) says why, whatever Show text says.
  const empty = (card.kind === "netWorth" && card.chart === null) || (card.kind === "savings" && card.empty !== null) ? (card as { empty: string | null }).empty : null;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}`} width="100%" style={{ display: "block" }} aria-hidden="true">
      <rect width={IMAGE_WIDTH} height={IMAGE_HEIGHT} fill={palette.surface} />
      {/* The icon is a dark tile: a hairline keeps its edge on a dark picture. */}
      <rect x={60} y={30} width={64} height={64} rx={15} fill="none" stroke={palette.rule} strokeWidth={1.5} />
      <image href={ACTUAL_BENCH_ICON} x={60} y={30} width={64} height={64} />
      <text x={144} y={76} fill={palette.ink} fontSize={36} fontWeight={700} {...text}>{card.title}</text>
      {subtitle && <text x={144} y={108} fill={palette.muted} fontSize={22} {...text}>{subtitle}</text>}
      {lines.map((line, i) => <text key={`${i}-${line}`} x={60} y={(subtitle ? 160 : 134) + i * 34} fill={palette.ink} fontSize={26} fontWeight={i === 0 ? 600 : 400} {...text}>{line}</text>)}
      {empty ? <text x={60} y={top + 40} fill={palette.muted} fontSize={28} {...text}>{empty}</text> : <CardChart card={card} choice={choice} showDates={options.showDates} showText={options.showText} palette={palette} frame={frame} />}
      {/* Notes stack up from the bottom, one to a line, so a long one never runs off the picture. */}
      {notes.map((note, i, all) => <text key={note} x={60} y={IMAGE_HEIGHT - 14 - (all.length - 1 - i) * 20} fill={palette.muted} fontSize={16} {...text}>{note}</text>)}
    </svg>
  );
}
