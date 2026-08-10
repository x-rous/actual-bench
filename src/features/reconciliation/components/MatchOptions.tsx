"use client";

import { Label } from "@/components/ui/label";
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

const PRESETS: { id: TextTargetPreset; label: string; hint: string }[] = [
  {
    id: "all-best-match",
    label: "All fields, best match wins",
    hint: "Safest default — an empty or irrelevant field simply contributes nothing.",
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
};

export function MatchOptions({ config, preset, onChange }: MatchOptionsProps) {
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
    <div className="rounded-md border border-border/60 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Matching
      </h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="match-preset" className="text-xs">
            Compare statement text against
          </Label>
          <select
            id="match-preset"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={preset}
            onChange={(event) => setPreset(event.target.value as TextTargetPreset)}
          >
            {PRESETS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            {PRESETS.find((entry) => entry.id === preset)?.hint}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="match-tolerance" className="text-xs">
            Date tolerance (days)
          </Label>
          <input
            id="match-tolerance"
            type="number"
            min={0}
            max={30}
            value={config.dateToleranceDays}
            onChange={(event) =>
              patch({ dateToleranceDays: Math.max(0, Number(event.target.value) || 0) })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            A bank&apos;s posting date often differs from the date you recorded it.
          </p>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium">Text handling</legend>

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
      </div>
    </div>
  );
}
