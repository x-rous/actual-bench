"use client";

import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUERY_PACK_GROUPS } from "../lib/queryPacks";
import type { QueryPack } from "../lib/queryPacks";

interface QueryExamplesPanelProps {
  onInsert: (query: string) => void;
}

// ─── Group header ─────────────────────────────────────────────────────────────

function GroupHeader({ label }: { label: string }) {
  return (
    <div className="mx-3 mb-1 border-b border-border pb-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
    </div>
  );
}

// ─── Example item ─────────────────────────────────────────────────────────────

function ExampleItem({
  pack,
  onInsert,
}: {
  pack: QueryPack;
  onInsert: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onInsert}
      className={cn(
        "group flex w-full items-start gap-2 border-l-2 border-transparent px-3 py-2 text-left transition-colors",
        "hover:border-primary/40 hover:bg-accent/60"
      )}
    >
      {/* Text block */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium leading-snug text-foreground/90 group-hover:text-foreground">
          {pack.name}
        </div>
        {pack.description && (
          <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/70">
            {pack.description}
          </div>
        )}
      </div>

      {/* Insert affordance — always visible, signals the action */}
      <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary/70" />
    </button>
  );
}

// ─── QueryExamplesPanel ───────────────────────────────────────────────────────

export function QueryExamplesPanel({ onInsert }: QueryExamplesPanelProps) {
  return (
    <div className="flex flex-col pb-3">
      {QUERY_PACK_GROUPS.map((group) => (
        <div key={group.id} className="mt-4 first:mt-2">
          <GroupHeader label={group.label} />
          {group.packs.map((pack) => (
            <ExampleItem
              key={pack.id}
              pack={pack}
              onInsert={() => onInsert(typeof pack.query === "function" ? pack.query() : pack.query)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
