"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  TEXT_TARGET_PRESETS,
  type TextTargetPreset,
} from "@/lib/reconciliation/match/config";
import type { MatchConfig } from "@/lib/reconciliation/types";

/**
 * Matching options, saved with the import profile.
 *
 * Which Actual field carries the merchant text is a property of *how the user
 * creates transactions*, not a global preference: entered by hand it is the
 * payee, imported by bank sync it is the imported payee, created by SMS/n8n
 * automation it is the notes. So the choice is explicit rather than a hidden
 * weight (RD-071 §5.3).
 */

/**
 * A typed day count: no spinner arrows, which are a click-by-click walk through
 * a range nobody wants to traverse. `appearance: textfield` covers Firefox, the
 * pseudo-elements cover WebKit and Blink.
 */
const NUMBER_FIELD =
  "h-7 w-full rounded-md border border-input bg-background px-2 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/**
 * Label on the left, control on the right in a column of fixed width.
 *
 * Declared once so every setting's control has the same width and the same left
 * edge: sized individually they stagger, and a column of ragged inputs reads as
 * carelessness before it reads as anything else.
 *
 * The width is set by the longest thing any of them has to display — "All
 * fields, best match wins" — because a preset the user cannot read in full is a
 * preset they cannot choose with confidence. It gives way to the label first
 * when the pane is narrow.
 */
const SETTING_ROW =
  "grid grid-cols-[minmax(0,1fr)_minmax(7rem,12.5rem)] items-center gap-x-2";

const PRESETS: { id: TextTargetPreset; label: string; hint: string }[] = [
  {
    id: "all-best-match",
    label: "All fields, best match wins",
    hint: "Safest default - an empty or irrelevant field simply contributes nothing.",
  },
  {
    id: "notes",
    label: "Notes",
    hint: "For transactions created by SMS, n8n or Shortcuts, where the note holds the bank's own text.",
  },
  {
    id: "payee-only",
    label: "Payee only",
    hint: "For transactions entered by hand, where the payee is the curated name.",
  },
  {
    id: "imported-payee",
    label: "Imported payee",
    hint: "For transactions brought in by bank sync, which keep the raw merchant text.",
  },
];

export type MatchOptionsProps = {
  config: MatchConfig;
  preset: TextTargetPreset;
  onChange: (preset: TextTargetPreset, config: MatchConfig) => void;
  /** Omit the heading where the surrounding surface already carries one. */
  headingLevel?: "section" | "none";
};

/**
 * One compact layout everywhere it appears.
 *
 * The import screen shows this in a narrow column that must not scroll, and the
 * workbench shows it in a popover; a wide three-column grid served neither. The
 * two settings people actually reach for are on top, and the two that describe
 * how *text* is handled — which most users set once and forget — sit behind a
 * disclosure rather than taking six lines of permanent height with them.
 */
export function MatchOptions({
  config,
  preset,
  onChange,
  headingLevel = "section",
}: MatchOptionsProps) {
  function setPreset(next: TextTargetPreset) {
    onChange(next, {
      ...config,
      // Preserve the tag choice across preset changes: it describes the user's
      // notes, not the field they compare against.
      text: { ...TEXT_TARGET_PRESETS[next], ignoreTagsInNotes: config.text.ignoreTagsInNotes },
    });
  }

  function patch(next: Partial<MatchConfig>) {
    onChange(preset, { ...config, ...next });
  }

  return (
    <div className={cn(headingLevel === "section" && "rounded-md border border-border/60 p-3")}>
      {headingLevel === "section" && (
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Matching
        </h3>
      )}

      <div className="flex flex-col gap-3">
        {/*
          One shape for all three settings: the label on the left, the control on
          the right, and the explanation across the full width beneath them. The
          control column is a fixed width shared by all three rows, so the select
          and the two day fields line up on both edges however long their labels
          run — an alignment that has to be declared once rather than left to
          each control's own size.
        */}
        <div className="flex flex-col gap-1">
          <div className={SETTING_ROW}>
            <Label htmlFor="match-preset" className="min-w-0 text-xs">
              Compare statement text against
            </Label>
            <select
              id="match-preset"
              className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
              value={preset}
              onChange={(event) => setPreset(event.target.value as TextTargetPreset)}
            >
              {PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {PRESETS.find((entry) => entry.id === preset)?.hint}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className={SETTING_ROW}>
            <Label htmlFor="match-tolerance" className="min-w-0 text-xs">
              Match transactions within (days)
            </Label>
            <input
              id="match-tolerance"
              type="number"
              inputMode="numeric"
              min={0}
              max={30}
              value={config.dateToleranceDays}
              onChange={(event) =>
                patch({ dateToleranceDays: Math.max(0, Number(event.target.value) || 0) })
              }
              className={NUMBER_FIELD}
            />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            A bank&apos;s posting date often differs from the date you recorded it.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className={SETTING_ROW}>
            <Label htmlFor="match-padding" className="min-w-0 text-xs">
              Look beyond the statement period (days)
            </Label>
            <input
              id="match-padding"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              value={config.candidatePaddingDays}
              onChange={(event) =>
                patch({ candidatePaddingDays: Math.max(0, Number(event.target.value) || 0) })
              }
              className={NUMBER_FIELD}
            />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Loads transactions this many days before and after the statement period for matching.
            Extra transactions are shown separately and aren&rsquo;t counted as missing. Increase it
            for a wider match window.
          </p>
        </div>

        {/*
          Behind a disclosure, not removed: these two describe how text is
          handled and are typically set once for an account, so they do not earn
          permanent height in a pane that must fit without scrolling.
        */}
        <details className="border-t border-border/50 pt-2">
          <summary className="cursor-pointer text-xs font-medium">
            Advanced matching options
          </summary>

          <fieldset className="mt-2 flex flex-col gap-2">
            <legend className="sr-only">Text handling</legend>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={config.text.ignoreTagsInNotes}
                onChange={(event) =>
                  patch({ text: { ...config.text, ignoreTagsInNotes: event.target.checked } })
                }
              />
              <span>
                Ignore <span className="font-mono">#tags</span> in notes
                <span className="block text-[11px] text-muted-foreground">
                  Workflow tags such as <span className="font-mono">#API</span> are not part of the
                  bank&apos;s text, so comparing them weakens every score.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={config.matchOriginalCurrencyAmount}
                onChange={(event) => patch({ matchOriginalCurrencyAmount: event.target.checked })}
              />
              <span>
                Match foreign transactions on their original amount
                <span className="block text-[11px] text-muted-foreground">
                  A purchase abroad posts as a converted figure while your recorded transaction often
                  holds the original. Still an exact match, against the amount the bank printed.
                </span>
              </span>
            </label>
          </fieldset>
        </details>
      </div>
    </div>
  );
}
