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
    "group rounded-xl border px-4 py-3.5 transition-colors",
    isDisabled
      ? "cursor-default border-dashed border-border/60 bg-background/35 opacity-60"
      : isTool
        ? "border-border/70 bg-muted/16 hover:border-foreground/15 hover:bg-muted/24"
        : "border-border/70 bg-background hover:border-foreground/15 hover:bg-accent/15"
  );

  const content = (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "rounded-lg border p-2",
          isDisabled
            ? "border-border/50 bg-background/55"
            : isTool
              ? "border-border/60 bg-background/70"
              : "border-border/70 bg-muted/25"
        )}
      >
        <card.icon
          className={cn(
            "h-4 w-4 text-muted-foreground",
            isDisabled && "text-muted-foreground/70"
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium tracking-tight sm:text-[15px]">{card.label}</div>
          {isDisabled && (
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Planned
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{card.description}</p>
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
      <section className="space-y-3 pt-2">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{MANAGE_DATA_TITLE}</h2>
          <p className="max-w-6xl text-sm text-muted-foreground">{MANAGE_DATA_DESCRIPTION}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ENTITY_CARDS.map((card) => (
            <ActionCard key={card.id} card={card} />
          ))}
        </div>
      </section>

      <section className="space-y-3 border-t border-border/60 pt-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Advanced Tools</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{ADVANCED_TOOLS_DESCRIPTION}</p>
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
