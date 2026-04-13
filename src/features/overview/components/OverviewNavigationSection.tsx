import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ADVANCED_TOOLS_DESCRIPTION,
  ENTITY_CARDS,
  MANAGE_DATA_DESCRIPTION,
  MANAGE_DATA_TITLE,
  TOOL_CARDS,
} from "../lib/overviewCards";
import type { OverviewActionCard } from "../types";

function ActionCard({ card }: { card: OverviewActionCard }) {
  const isDisabled = Boolean(card.comingSoon);
  const isTool = card.tone === "tool";

  const className = cn(
    "group rounded-xl border px-4 py-3 transition-colors",
    isDisabled
      ? "cursor-default border-dashed border-border/50 bg-background/25 opacity-55"
      : isTool
        ? "border-border/70 bg-muted/14 hover:border-foreground/15 hover:bg-muted/22"
        : "border-border/70 bg-background hover:border-foreground/15 hover:bg-accent/15"
  );

  const content = (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "rounded-lg border p-2",
          isDisabled
            ? "border-border/40 bg-background/45"
            : isTool
              ? "border-border/60 bg-background/70"
              : "border-border/70 bg-muted/25"
        )}
      >
        <card.icon
          className={cn(
            "h-4 w-4 text-muted-foreground",
            isDisabled && "text-muted-foreground/55"
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "text-[15px] font-semibold tracking-tight text-foreground/95",
              isDisabled && "text-foreground/60"
            )}
          >
            {card.label}
          </div>
          {isDisabled && (
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
              Planned
            </span>
          )}
        </div>
        <p
          className={cn(
            "mt-1 min-h-[3.75rem] text-[13px] leading-5 text-muted-foreground/85",
            isDisabled && "text-muted-foreground/70"
          )}
        >
          {card.description}
        </p>
      </div>

      {!isDisabled && (
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </div>
  );

  if (!card.href || isDisabled) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Link href={card.href} className={className}>
      {content}
    </Link>
  );
}

export function OverviewNavigationSection() {
  return (
    <div className="space-y-6">
      <section className="space-y-3 pt-1">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{MANAGE_DATA_TITLE}</h2>
          <p className="max-w-5xl text-[13px] leading-5 text-muted-foreground/80">{MANAGE_DATA_DESCRIPTION}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ENTITY_CARDS.map((card) => (
            <ActionCard key={card.id} card={card} />
          ))}
        </div>
      </section>

      <section className="space-y-3 pt-1">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Advanced Tools</h2>
          <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground/80">{ADVANCED_TOOLS_DESCRIPTION}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {TOOL_CARDS.map((card) => (
            <ActionCard key={card.id} card={card} />
          ))}
        </div>
      </section>
    </div>
  );
}
