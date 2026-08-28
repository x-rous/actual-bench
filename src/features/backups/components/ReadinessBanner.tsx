"use client";

import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BackupReadiness } from "@/lib/backup/readiness";

/**
 * The readiness statement (RD-077 / PR-047e).
 *
 * The first thing on the page, and the only sentence most people will read:
 * *if this budget disappeared right now, what would I get back, and how old
 * would it be?* Everything below is evidence for it.
 *
 * It is deliberately pessimistic. A backup screen that reassures you is worse
 * than no backup screen, so anything Bench cannot presently prove pulls this
 * line down rather than being rounded up — and the issues that pulled it down
 * are listed underneath rather than left for the user to hunt for.
 */

const TONE = {
  protected: {
    icon: ShieldCheck,
    wrapper: "border-green-500/30 bg-green-50 dark:bg-green-950/20",
    accent: "text-green-700 dark:text-green-400",
  },
  "at-risk": {
    icon: AlertTriangle,
    wrapper: "border-amber-400/40 bg-amber-50 dark:bg-amber-950/20",
    accent: "text-amber-800 dark:text-amber-300",
  },
  unprotected: {
    icon: ShieldAlert,
    wrapper: "border-destructive/30 bg-destructive/5",
    accent: "text-destructive",
  },
} as const;

export function ReadinessBanner({ readiness }: { readiness: BackupReadiness }) {
  const tone = TONE[readiness.status];
  const Icon = tone.icon;

  return (
    <section
      className={cn("border-b px-4 py-3", tone.wrapper)}
      aria-labelledby="backup-readiness-heading"
    >
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", tone.accent)} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="backup-readiness-heading" className={cn("text-sm font-semibold", tone.accent)}>
            {readiness.headline}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{readiness.detail}</p>

          {readiness.issues.length > 0 && (
            <ul className="mt-2 space-y-1">
              {readiness.issues.map((issue) => (
                <li key={issue} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-current" />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
