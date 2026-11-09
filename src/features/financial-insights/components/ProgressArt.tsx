import type { DebtChoice, ProgressCard } from "@/lib/financial-insights/progress";
import { FONT_STACK, IMAGE_PALETTES } from "../lib/progressPalette";
import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../lib/progressImage";
import { CardChart, labelsOf, notesOf } from "./ProgressCharts";

export type ImageOptions = { showDates: boolean; footer: boolean; theme: "light" | "dark" };

/** The line under the title: what the figure is as of, or the choice shown. */
function subtitleOf(card: ProgressCard, choice: DebtChoice | null): string | null {
  if (card.kind === "buffer") return card.asOf;
  if (card.kind === "milestones") return card.note;
  if (card.kind === "debt") return choice?.label ?? null;
  return null;
}

/**
 * A card as one picture, 1200 × 675: title, at most three lines, the chart and an optional footer. It is drawn only from the card's
 * `ProgressView` data, in colours written out for the theme (no stylesheet, no CSS variable), so the drawing can be saved as it
 * stands. It carries no title element, no `data-*` attribute and no hidden text: what is on the picture is all there is.
 */
export function ProgressArt({ card, choice, options, svgRef }: { card: ProgressCard; choice: DebtChoice | null; options: ImageOptions; svgRef?: (node: SVGSVGElement | null) => void }) {
  const palette = IMAGE_PALETTES[options.theme];
  const text = { fontFamily: FONT_STACK } as const;
  const lines = labelsOf(card, choice, options.showDates);
  const subtitle = subtitleOf(card, choice);
  const list = card.kind === "milestones" && card.items.length > 0;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}`} width="100%" style={{ display: "block" }} aria-hidden="true">
      <rect width={IMAGE_WIDTH} height={IMAGE_HEIGHT} fill={palette.surface} />
      <text x={60} y={78} fill={palette.ink} fontSize={36} fontWeight={700} {...text}>{card.title}</text>
      {subtitle && <text x={60} y={110} fill={palette.muted} fontSize={22} {...text}>{subtitle}</text>}
      {list ? lines.map((line, i) => (
        <g key={line}>
          <circle cx={70} cy={166 + i * 44} r={7} fill={palette.good} />
          <text x={94} y={174 + i * 44} fill={palette.ink} fontSize={28} {...text}>{line}</text>
        </g>
      )) : card.kind === "milestones" ? (
        <text x={60} y={174} fill={palette.muted} fontSize={28} {...text}>{lines[0]}</text>
      ) : (
        <>
          {lines.map((line, i) => <text key={line} x={60} y={(subtitle ? 160 : 134) + i * 34} fill={palette.ink} fontSize={26} fontWeight={i === 0 ? 600 : 400} {...text}>{line}</text>)}
          <CardChart card={card} choice={choice} showDates={options.showDates} palette={palette} frame={{ x: 120, y: 250, width: 960 }} />
        </>
      )}
      {notesOf(card).length > 0 && <text x={60} y={IMAGE_HEIGHT - 26} fill={palette.muted} fontSize={18} {...text}>{notesOf(card).join(" · ")}</text>}
      {options.footer && <text x={IMAGE_WIDTH - 60} y={IMAGE_HEIGHT - 26} textAnchor="end" fill={palette.muted} fontSize={20} {...text}>Made with Actual Bench</text>}
    </svg>
  );
}
