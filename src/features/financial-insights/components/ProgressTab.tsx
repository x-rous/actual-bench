"use client";

import { useRef, useState } from "react";
import { Copy, Download, Share2 } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PillGroup } from "@/components/ui/pill-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { DebtCard, DebtChoiceId, ProgressCard, ProgressView } from "@/lib/financial-insights/progress";
import { canCopyImage, copyPng, downloadPng, svgToPng } from "../lib/progressImage";
import type { ProgressSwitches } from "../hooks/useProgressSwitches";
import { THEME_PALETTE } from "../lib/progressPalette";
import { CardTitle } from "./InfoTip";
import { ProgressArt, type ImageOptions } from "./ProgressArt";
import { CardChart, chosenDebt, labelsOf, notesOf, summaryOf } from "./ProgressCharts";

type Props = {
  /** Everything this tab draws. It holds shapes, percentages, months and counts, and no amount or name: that is all the tab can be given. */
  view: ProgressView;
  /** Switches the page to all available history. */
  onSeeAllTime?: () => void;
  switches: Switches;
  onSwitches: (change: Partial<Switches>) => void;
};

type Switches = ProgressSwitches;

/** The Show dates switch. It sits at the top right of the tab, opposite the intro text, and sets how every card, preview and saved image names its months. */
export function ProgressDatesSwitch({ showDates, onChange }: { showDates: boolean; onChange: (showDates: boolean) => void }) {
  return <label className="flex shrink-0 items-center gap-2 text-xs"><Switch checked={showDates} onCheckedChange={onChange} aria-label="Show dates" />Show dates</label>;
}

/**
 * The Progress tab: cards that can be shared as images. It receives only the share-safe `ProgressView`, so it cannot draw a money
 * amount, a currency or the name of an account, payee, loan or asset. Nothing here reads or writes Actual or the app database.
 */
export function ProgressTab({ view, onSeeAllTime, switches, onSwitches }: Props) {
  const [picked, setPicked] = useState<Record<string, DebtChoiceId>>({});
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Cards to share your progress. They show shapes, percentages and months, never amounts. Select Share on a card to copy or download it as an image.</p>
          <p>To see the amounts behind a card, open the tab it comes from: Summary, Loans &amp; cards or Property &amp; assets.</p>
          {view.equityPending && <p role="status">Reading property values…</p>}
          {view.equityUnavailable && <p role="status">Home cards are unavailable because property values could not be read.</p>}
        </div>
        {/* One switch for the whole tab: the cards, the previews and the saved images all follow it. */}
        <ProgressDatesSwitch showDates={switches.showDates} onChange={(showDates) => onSwitches({ showDates })} />
      </div>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {view.cards.map((card) => (
          <ProgressCardView
            key={card.id} card={card} switches={switches} onSwitches={onSwitches}
            choice={card.kind === "debt" ? picked[card.id] ?? null : null} onChoice={(id) => setPicked((p) => ({ ...p, [card.id]: id }))} onSeeAllTime={onSeeAllTime}
          />
        ))}
      </div>
    </div>
  );
}

function ProgressCardView({ card, switches, onSwitches, choice, onChoice, onSeeAllTime }: {
  card: ProgressCard; switches: Switches; onSwitches: (change: Partial<Switches>) => void; choice: DebtChoiceId | null; onChoice: (id: DebtChoiceId) => void; onSeeAllTime?: () => void;
}) {
  const chosen = card.kind === "debt" ? chosenDebt(card, choice) : null;
  const lines = labelsOf(card, chosen, switches.showDates);
  const hint = card.kind === "buffer" ? card.asOf : card.kind === "milestones" ? card.note : undefined;
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card" aria-label={card.title}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
        <CardTitle title={card.title} hint={hint} info={<p>{card.info}</p>} infoLabel={card.title} />
        <ShareButton card={card} choice={chosen?.id ?? null} switches={switches} onSwitches={onSwitches} />
      </header>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-2">
        {card.kind === "debt" && <DebtPicker card={card} value={chosen!.id} onChange={onChoice} />}
        {card.kind === "milestones" ? (
          <>
            {card.items.length > 0 ? (
              <ul className="space-y-1.5 text-sm">{lines.map((line) => <li key={line} className="flex items-start gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden />{line}</li>)}</ul>
            ) : <p className="text-sm text-muted-foreground">{card.empty}</p>}
            {card.canSeeAllTime && onSeeAllTime && <div><Button size="xs" variant="outline" onClick={onSeeAllTime}>See all time</Button></div>}
          </>
        ) : (
          <>
            <ul className="space-y-0.5 text-sm">{lines.map((line, i) => <li key={line} className={i === 0 ? "font-medium" : "text-muted-foreground"}>{line}</li>)}</ul>
            {chartOf(card) ? (
              <>
                {/* Pinned to the bottom of the card, so cards side by side share one x-axis line whatever sits above the chart. */}
                <div className="mt-auto"><CardChart card={card} choice={chosen} showDates={switches.showDates} palette={THEME_PALETTE} /></div>
                <p className="sr-only">{summaryOf(card, chosen, switches.showDates)}</p>
              </>
            ) : card.kind === "netWorth" || card.kind === "savings" ? <p className="text-sm text-muted-foreground">{card.empty}</p> : null}
            {notesOf(card).map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
            {card.kind === "equity" && <p className="text-xs text-muted-foreground">Dashed line: 80% loan-to-value.</p>}
          </>
        )}
      </div>
    </section>
  );
}

/** Whether a card has a drawing at all (an unavailable buffer and an empty series have only words). */
function chartOf(card: ProgressCard): boolean {
  if (card.kind === "netWorth") return card.chart !== null;
  if (card.kind === "savings") return card.empty === null;
  if (card.kind === "buffer") return card.state === "ready";
  return card.kind !== "milestones";
}

function DebtPicker({ card, value, onChange }: { card: DebtCard; value: DebtChoiceId; onChange: (id: DebtChoiceId) => void }) {
  if (card.choices.length < 2) return null;
  return <PillGroup options={card.choices.map((c) => ({ value: c.id, label: c.label }))} value={value} onChange={onChange} className="self-start" />;
}

function ShareButton({ card, choice, switches, onSwitches }: { card: ProgressCard; choice: DebtChoiceId | null; switches: Switches; onSwitches: (change: Partial<Switches>) => void }) {
  const { resolvedTheme } = useTheme();
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement | null>(null);
  const options: ImageOptions = { showDates: switches.showDates, footer: switches.footer, theme: theme ?? (resolvedTheme === "dark" ? "dark" : "light") };
  const debt = card.kind === "debt" ? chosenDebt(card, choice) : null;

  const make = (action: "copy" | "download") => {
    if (!svg.current || busy) return;
    setBusy(true);
    // Safari only allows a clipboard write that starts inside the click, so the picture is handed over as a promise, before anything is awaited.
    const png = svgToPng(svg.current);
    const done = action === "copy"
      ? copyPng(png).then(() => toast.success("Image copied"))
      : png.then((blob) => { downloadPng(blob, `financial-insights-progress-${card.id}.png`); toast.success("Image downloaded"); });
    done.catch((error: unknown) => toast.error(error instanceof Error ? error.message : "The image could not be made")).finally(() => setBusy(false));
  };

  return (
    <Popover>
      <PopoverTrigger render={<Button size="xs" variant="outline" aria-label={`Share ${card.title}`}><Share2 className="size-3.5" aria-hidden />Share</Button>} />
      <PopoverContent align="end" className="w-[480px] max-w-[92vw] space-y-3 p-3">
        <p className="text-xs text-muted-foreground">Preview of the image. It shows what the card shows, never an amount.</p>
        <div className="overflow-hidden rounded-md border border-border">
          <ProgressArt card={card} choice={debt} options={options} svgRef={(node) => { svg.current = node; }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <label className="flex items-center gap-2"><Switch checked={switches.footer} onCheckedChange={(checked) => onSwitches({ footer: checked })} aria-label="Footer: Made with Actual Bench" />Footer</label>
          <span className="flex items-center gap-2">Theme<PillGroup options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} value={options.theme} onChange={setTheme} /></span>
        </div>
        <div className="flex justify-end gap-2">
          {canCopyImage() && <Button size="xs" variant="outline" disabled={busy} onClick={() => make("copy")}><Copy className="size-3.5" aria-hidden />Copy image</Button>}
          <Button size="xs" disabled={busy} onClick={() => make("download")}><Download className="size-3.5" aria-hidden />Download PNG</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
