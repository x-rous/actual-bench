import type { DebtCard, DebtChoice, Dated, ProgressCard } from "@/lib/financial-insights/progress";
import type { ShapePalette } from "../lib/progressPalette";
import { ShapeChart, ShapeGauge, type Frame } from "./charts/ShapeChart";

/** What is shown for a line that may name months: the months, or "Month N". */
export const textOf = (line: Dated, showDates: boolean): string => (showDates ? line.on : line.off);

/** The debt choice a card shows: the one picked, else its default. */
export function chosenDebt(card: DebtCard, picked: string | null): DebtChoice {
  return card.choices.find((c) => c.id === picked) ?? card.choices.find((c) => c.id === card.defaultChoice) ?? card.choices[0];
}

/** The short lines under a card's title: at most three. */
export function labelsOf(card: ProgressCard, choice: DebtChoice | null, showDates: boolean): string[] {
  switch (card.kind) {
    case "netWorth": case "savings": case "equity": return card.labels.map((l) => textOf(l, showDates));
    case "debt": return (choice ?? chosenDebt(card, null)).labels.map((l) => textOf(l, showDates));
    case "buffer": return card.state === "ready" ? card.labels.map((l) => textOf(l, showDates)) : [card.reason];
    case "milestones": return card.items.length ? card.items.map((l) => textOf(l, showDates)) : [card.empty];
  }
}

/** Short notes about how a chart is drawn (a month left blank, a rate drawn at -100%). */
export function notesOf(card: ProgressCard): string[] {
  return card.kind === "savings" && !card.empty ? [card.belowNote, card.gapNote].filter((n): n is string => n !== null) : [];
}

/** The words a screen reader gets for a chart: the card's title and its labels. */
export function summaryOf(card: ProgressCard, choice: DebtChoice | null, showDates: boolean): string {
  const lines = labelsOf(card, choice, showDates).join(", ");
  const subject = card.kind === "debt" ? `${card.title}, ${(choice ?? chosenDebt(card, null)).label}` : card.title;
  return lines ? `${subject}: ${lines}` : subject;
}

/** What a card's chart is drawn from; null for a card without one (milestones, an unavailable buffer, a series with nothing to show). */
export function CardChart({ card, choice, showDates, palette, frame }: { card: ProgressCard; choice: DebtChoice | null; showDates: boolean; palette: ShapePalette; frame?: Frame }) {
  const aria = summaryOf(card, choice, showDates);
  const names = (axis: { months: Dated[] }) => axis.months.map((m) => textOf(m, showDates));
  switch (card.kind) {
    case "netWorth":
      return card.chart ? <ShapeChart mode="line" area="split" points={card.chart.points} zero={card.chart.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} zeroLabel="0" /> : null;
    case "debt": {
      const c = choice ?? chosenDebt(card, null);
      return <ShapeChart mode="line" area="under" points={c.chart.points} zero={c.chart.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} peak={c.peak} zeroLabel="0" />;
    }
    case "savings":
      return card.empty ? null : <ShapeChart mode="bars" points={card.bars} zero={card.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} zeroLabel="0%" />;
    case "equity":
      return <ShapeChart mode="line" points={card.chart.points} zero={card.chart.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} window={[0, 1]} references={[card.reference]} padLeft={46} edgeLabels={{ bottom: "0%", top: "100%" }} />;
    case "buffer":
      return card.state === "ready" ? <ShapeGauge fill={card.fill} reachFill={card.accessibleFill} marks={card.marks} palette={palette} ariaLabel={aria} frame={frame} endLabels={{ start: "0", end: "12 months" }} /> : null;
    case "milestones":
      return null;
  }
}
