"use client";

import { useState } from "react";
import { Copy, Download } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { Switch } from "@/components/ui/switch";
import type { DebtCard, DebtChoice, DebtChoiceId, ProgressCard, ProgressView } from "@/lib/financial-insights/progress";
import { canCopyImage, copyPng, downloadPng, svgToPng, svgsToSheetPng } from "../lib/progressImage";
import type { ProgressSwitches } from "../hooks/useProgressSwitches";
import { IMAGE_PALETTES, THEME_PALETTE } from "../lib/progressPalette";
import { CardTitle } from "./InfoTip";
import type { ImageOptions } from "./ProgressArt";
import { drawCard } from "./progressRender";
import { CardChart, chosenDebt, labelsOf, notesOf, summaryOf } from "./ProgressCharts";

type Props = {
  /** Everything this tab draws. It holds shapes, percentages, months and counts, and no amount or name: that is all the tab can be given. */
  view: ProgressView;
  switches: Switches;
  onSwitches: (change: Partial<Switches>) => void;
};

type Switches = ProgressSwitches;

/** A tab-wide switch at the top right of the tab: the cards, the previews and the saved images all follow it. */
function TabSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex shrink-0 items-center gap-2 text-xs"><Switch checked={checked} onCheckedChange={onChange} aria-label={label} />{label}</label>;
}

/**
 * The Progress tab: cards that can be shared as images. It receives only the share-safe `ProgressView`, so it cannot draw a money
 * amount, a currency or the name of an account, payee, loan or asset. Nothing here reads or writes Actual or the app database.
 */
export function ProgressTab({ view, switches, onSwitches }: Props) {
  const [picked, setPicked] = useState<Record<string, DebtChoiceId>>({});
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Cards to share your progress. They show shapes, percentages and months, never amounts. Use Copy image or Download PNG on a card to share it as a picture, or Copy all images for the cards together.</p>
          <p>To see the amounts behind a card, open the tab it comes from: Summary, Loans &amp; cards or Property &amp; assets.</p>
          {view.equityPending && <p role="status">Reading property values…</p>}
          {view.equityUnavailable && <p role="status">Some property cards may be missing because property values could not be read. See Property &amp; assets for details.</p>}
          {view.propertiesUnregistered && <p role="status">A property is not registered in Assets, so it has no card here. Register it in Assets to add one.</p>}
        </div>
        {/* Show dates names the months or counts them; Show text keeps the words and percentages on the cards or takes them off */}
        <div className="flex shrink-0 flex-wrap items-center gap-4">
          <TabSwitch label="Show dates" checked={switches.showDates} onChange={(showDates) => onSwitches({ showDates })} />
          <TabSwitch label="Show text" checked={switches.showText} onChange={(showText) => onSwitches({ showText })} />
          <CopyAll cards={view.cards} picked={picked} switches={switches} theme={theme} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {view.cards.map((card) => (
          <ProgressCardView
            key={card.id} card={card} switches={switches}
            choice={card.kind === "debt" ? picked[card.id] ?? null : null} onChoice={(id) => setPicked((p) => ({ ...p, [card.id]: id }))}
          />
        ))}
      </div>
    </div>
  );
}

function ProgressCardView({ card, switches, choice, onChoice }: {
  card: ProgressCard; switches: Switches; choice: DebtChoiceId | null; onChoice: (id: DebtChoiceId) => void;
}) {
  const chosen = card.kind === "debt" ? chosenDebt(card, choice) : null;
  const lines = labelsOf(card, chosen, switches.showDates, switches.showText);
  const hint = card.kind === "buffer" ? card.asOf : card.kind === "consistency" || card.kind === "composition" || card.kind === "journey" ? card.note : undefined;
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card" aria-label={card.title}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
        <CardTitle title={card.title} hint={hint} info={<p>{card.info}</p>} infoLabel={card.title} />
        <ImageActions card={card} choice={chosen} switches={switches} />
      </header>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-2">
        {card.kind === "debt" && <DebtPicker card={card} value={chosen!.id} onChange={onChoice} />}
          {lines.length > 0 && <ul className="space-y-0.5 text-sm">{lines.map((line, i) => <li key={`${i}-${line}`} className={i === 0 ? "font-medium" : "text-muted-foreground"}>{line}</li>)}</ul>}
          {chartOf(card) ? (
            <>
              {/* Pinned to the bottom of the card, so cards side by side share one x-axis line whatever sits above the chart. */}
              <div className="mt-auto"><CardChart card={card} choice={chosen} showDates={switches.showDates} showText={switches.showText} palette={THEME_PALETTE} /></div>
              <p className="sr-only">{summaryOf(card, chosen, switches.showDates, switches.showText)}</p>
            </>
          ) : card.kind === "netWorth" || card.kind === "savings" ? <p className="text-sm text-muted-foreground">{card.empty}</p> : null}
          {notesOf(card, switches.showText).map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
          {card.kind === "property" && card.ltv && switches.showText && <p className="text-xs text-muted-foreground">Dashed line: 80% loan-to-value. The shaded area is the value as a shape, with no amount.</p>}
      </div>
    </section>
  );
}

/** Whether a card has a drawing at all (an unavailable buffer and an empty series have only words). */
function chartOf(card: ProgressCard): boolean {
  if (card.kind === "netWorth") return card.chart !== null;
  if (card.kind === "savings") return card.empty === null;
  if (card.kind === "buffer") return card.state === "ready";
  return true;
}

function DebtPicker({ card, value, onChange }: { card: DebtCard; value: DebtChoiceId; onChange: (id: DebtChoiceId) => void }) {
  if (card.choices.length < 2) return null;
  return <PillGroup options={card.choices.map((c) => ({ value: c.id, label: c.label }))} value={value} onChange={onChange} className="self-start" />;
}

/** Copy image and Download PNG, at the top right of a card. The picture follows the tab's switches and the theme the app is in. */
function ImageActions({ card, choice, switches }: { card: ProgressCard; choice: DebtChoice | null; switches: Switches }) {
  const { resolvedTheme } = useTheme();
  const [busy, setBusy] = useState(false);
  const options = imageOptions(switches, resolvedTheme === "dark" ? "dark" : "light");

  const make = (action: "copy" | "download") => {
    if (busy) return;
    let drawn: ReturnType<typeof drawCard>;
    try { drawn = drawCard(card, choice, options); } catch (error) { toast.error(error instanceof Error ? error.message : "The image could not be made"); return; }
    setBusy(true);
    // Safari only allows a clipboard write that starts inside the click, so the picture is handed over as a promise, before anything is awaited.
    const png = svgToPng(drawn.svg);
    const done = action === "copy"
      ? copyPng(png).then(() => toast.success("Image copied"))
      : png.then((blob) => { downloadPng(blob, `financial-insights-progress-${card.id}.png`); toast.success("Image downloaded"); });
    done.catch((error: unknown) => toast.error(error instanceof Error ? error.message : "The image could not be made")).finally(() => { drawn.dispose(); setBusy(false); });
  };

  return (
    <div className="flex items-center gap-2">
      {canCopyImage() && <Button size="xs" variant="outline" disabled={busy} aria-label={`Copy image of ${card.title}`} onClick={() => make("copy")}><Copy className="size-3.5" aria-hidden />Copy image</Button>}
      <Button size="xs" variant="outline" disabled={busy} aria-label={`Download PNG of ${card.title}`} onClick={() => make("download")}><Download className="size-3.5" aria-hidden />Download PNG</Button>
    </div>
  );
}

const imageOptions = (switches: Switches, theme: "light" | "dark"): ImageOptions => ({ showDates: switches.showDates, showText: switches.showText, theme });

/**
 * One button at the top right that copies every card. The clipboard holds a single image, so the
 * pictures are put on one sheet, two to a row, in the order of the tab, with the same switches and theme as each card's own picture.
 */
function CopyAll({ cards, picked, switches, theme }: { cards: ProgressCard[]; picked: Record<string, DebtChoiceId>; switches: Switches; theme: "light" | "dark" }) {
  const [busy, setBusy] = useState(false);
  if (cards.length === 0 || !canCopyImage()) return null;
  const copy = () => {
    if (busy) return;
    const options = imageOptions(switches, theme);
    const drawn: ReturnType<typeof drawCard>[] = [];
    try {
      for (const card of cards) drawn.push(drawCard(card, card.kind === "debt" ? chosenDebt(card, picked[card.id] ?? null) : null, options));
    } catch (error) {
      drawn.forEach((d) => d.dispose());
      toast.error(error instanceof Error ? error.message : "The images could not be made");
      return;
    }
    setBusy(true);
    // As for one card: the clipboard write starts inside the click, with the sheet as a promise, for Safari.
    copyPng(svgsToSheetPng(drawn.map((d) => d.svg), IMAGE_PALETTES[theme].rule))
      .then(() => toast.success(`${cards.length} images copied as one sheet`))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "The images could not be made"))
      .finally(() => { drawn.forEach((d) => d.dispose()); setBusy(false); });
  };
  return <Button size="xs" variant="outline" disabled={busy} aria-label="Copy all images" title="Copies all the cards as one sheet, two to a row." onClick={copy}><Copy className="size-3.5" aria-hidden />Copy all images</Button>;
}
