"use client";

import { BookOpen, Info, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FeatureDefinition } from "@/lib/features/catalogue";

/** Shared external links; absent feedback is intentional (Budget File Health). */
export function FeatureLinks({ feature }: { feature: FeatureDefinition }) {
  return (
    <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
      <a href={feature.docsUrl} target="_blank" rel="noopener noreferrer"
        aria-label={`${feature.label} documentation (opens in a new tab)`}
        className="inline-flex min-h-7 items-center gap-1.5 rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> Docs
      </a>
      {feature.feedbackUrl && (
        <a href={feature.feedbackUrl} target="_blank" rel="noopener noreferrer"
          aria-label={`${feature.label} feedback (opens in a new tab)`}
          className="inline-flex min-h-7 items-center gap-1.5 rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Feedback
        </a>
      )}
    </div>
  );
}

export function FeatureMaturity({ feature }: { feature: FeatureDefinition }) {
  return feature.maturity === "experimental"
    ? <Badge variant="status-warning" className="h-4 px-1.5 text-[9px]">Experimental</Badge>
    : null;
}

/** Page information lives in the existing top bar, leaving feature panels intact. */
export function FeatureInformation({ feature, compact = false }: { feature: FeatureDefinition; compact?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`About ${feature.label}${feature.maturity === "experimental" ? " (Experimental)" : ""}`}
        title={`About ${feature.label}`}
        className={cn("inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground", compact ? "h-5 w-5" : "h-7 w-7")}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-4" aria-label={`${feature.label} information`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 text-sm font-semibold">{feature.label}</h2>
          <FeatureMaturity feature={feature} />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{feature.description}</p>
        <div><h3 className="mb-1 text-xs font-medium">Actual data</h3><p className="text-xs leading-5 text-muted-foreground">{feature.accessSummary}</p></div>
        <FeatureLinks feature={feature} />
      </PopoverContent>
    </Popover>
  );
}
