import type { DebtCard, DebtChoice, Dated, ProgressCard } from "@/lib/financial-insights/progress";
import type { ShapePalette } from "../lib/progressPalette";
import { CompositionBars, StripChart } from "./charts/ProgressShapes";
import { ShapeChart, ShapeGauge, type Frame } from "./charts/ShapeChart";

/** What is shown for a line that may name months: the months, or "Month N". */
export const textOf = (line: Dated, showDates: boolean): string => (showDates ? line.on : line.off);

/** The debt choice a card shows: the one picked, else its default. */
export function chosenDebt(card: DebtCard, picked: string | null): DebtChoice {
  return card.choices.find((c) => c.id === picked) ?? card.choices.find((c) => c.id === card.defaultChoice) ?? card.choices[0];
}

/** The short lines under a card's title: at most three. */
export function labelsOf(card: ProgressCard, choice: DebtChoice | null, showDates: boolean, showText = true): string[] {
  // With the text off, a card keeps its picture and its title; a reason a figure is missing is not a figure, so it stays.
  if (!showText && !(card.kind === "buffer" && card.state === "unavailable")) return [];
  switch (card.kind) {
    case "netWorth": case "savings": case "property": case "consistency": case "composition": case "journey": return card.labels.map((l) => textOf(l, showDates));
    case "debt": return (choice ?? chosenDebt(card, null)).labels.map((l) => textOf(l, showDates));
    case "buffer": return card.state === "ready" ? card.labels.map((l) => textOf(l, showDates)) : [card.reason];
  }
}

/** Short notes about how a chart is drawn (a month left blank, a rate drawn at -100%). */
export function notesOf(card: ProgressCard, showText = true): string[] {
  return showText && card.kind === "savings" && !card.empty ? [card.provisionalNote, card.belowNote, card.aboveNote, card.gapNote].filter((n): n is string => n !== null) : [];
}

/** The words a screen reader gets for a chart: the card's title and its labels. */
export function summaryOf(card: ProgressCard, choice: DebtChoice | null, showDates: boolean, showText = true): string {
  const lines = labelsOf(card, choice, showDates, showText).join(", ");
  const subject = card.kind === "debt" ? `${card.title}, ${(choice ?? chosenDebt(card, null)).label}` : card.title;
  return lines ? `${subject}: ${lines}` : subject;
}

/** What a card's chart is drawn from; null for a card without one (an unavailable buffer, a series with nothing to show). */
export function CardChart({ card, choice, showDates, showText = true, palette, frame }: { card: ProgressCard; choice: DebtChoice | null; showDates: boolean; /** Off: no percentage marks on the chart (the 0% of the savings rate), except the loan-to-value of a property, which is always there. */ showText?: boolean; palette: ShapePalette; frame?: Frame }) {
  const aria = summaryOf(card, choice, showDates, showText);
  const names = (axis: { months: Dated[] }) => axis.months.map((m) => textOf(m, showDates));
  switch (card.kind) {
    case "netWorth":
      return card.chart ? <ShapeChart mode="line" area="split" points={card.chart.points} zero={card.chart.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} zeroLabel="0" /> : null;
    case "debt": {
      const c = choice ?? chosenDebt(card, null);
      return <ShapeChart mode="line" area="under" points={c.chart.points} zero={c.chart.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} peak={c.peak} zeroLabel="0" />;
    }
    case "savings":
      return card.empty ? null : <ShapeChart mode="bars" points={card.bars} zero={card.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} zeroLabel={showText ? "0%" : undefined} />;
    case "property": {
      // Linked to a loan: the loan-to-value as the line on its own 0 to 100% scale, over the value as a shape. Otherwise the value alone.
      if (card.ltv) {
        return <ShapeChart mode="line" points={card.ltv.chart.points} zero={card.ltv.chart.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} window={[0, 1]} references={[card.ltv.reference]} padLeft={46} padTop={34} pointLabel={card.ltv.latest}
          backdrop={card.valueShape?.points} legend={[{ label: "Value", area: true }, { label: "Loan-to-value", area: false }]} gutterLabels={[{ at: 0, label: "0%" }, { at: card.ltv.full.at, label: card.ltv.full.label }]} />;
      }
      return card.valueShape ? <ShapeChart mode="line" area="under" points={card.valueShape.points} zero={card.valueShape.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} zeroLabel="0" /> : null;
    }
    case "buffer":
      return card.state === "ready" ? <ShapeGauge fill={card.fill} reachFill={card.accessibleFill} marks={card.marks} palette={palette} ariaLabel={aria} frame={frame} endLabels={{ start: "0", end: "12 months" }} /> : null;
    case "consistency":
      return <StripChart strip={card.strip} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} />;
    case "composition":
      return <CompositionBars classes={card.classes} startName={card.startName} endName={card.endName} start={card.start} end={card.end} palette={palette} ariaLabel={aria} frame={frame} />;
    case "journey":
      return <ShapeChart mode="line" area="under" points={card.chart.points} zero={card.chart.zero} partial={card.axis.partial} xLabels={names(card.axis)} palette={palette} ariaLabel={aria} frame={frame} zeroLabel="0" references={showText && card.goal ? [card.goal] : []} />;
  }
}
