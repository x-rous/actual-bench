/**
 * Default matching configuration and the profile presets (RD-071 §5.3).
 *
 * Which Actual field carries the merchant text is a property of *how the user
 * creates transactions*, and it differs per user and per account:
 *
 * - entered by hand, or via Actual's own import → the curated payee;
 * - from a bank-sync/import path → the imported payee;
 * - created by SMS/n8n/Shortcuts automation → the notes hold the bank's text.
 *
 * None of these is "the" default, so the choice is a first-class profile
 * setting rather than a hidden weight.
 */

import type {
  MatchConfig,
  NeedleFloor,
  TextMatchConfig,
  TextTarget,
  TextTargetField,
} from "../types";

export const DEFAULT_NEEDLE_FLOOR: NeedleFloor = {
  minChars: 6,
  minTokens: 2,
  maxCorpusFrequency: 0.3,
};

function payeeTarget(field: Exclude<TextTargetField, "notes">, priority: number): TextTarget {
  return { field, enabled: true, priority, weight: 1, mode: "symmetric", preprocess: [] };
}

function notesTarget(priority: number): TextTarget {
  return {
    field: "notes",
    enabled: true,
    priority,
    weight: 1,
    // Asymmetric: the note may legitimately carry the bank text *plus* the
    // user's own words, and those additions must not cost anything.
    mode: "containment",
    // Tags are never bank text, so removing them sharpens the comparison.
    preprocess: ["strip-tags"],
  };
}

export type TextTargetPreset =
  | "payee-only"
  | "imported-payee"
  | "notes"
  | "all-best-match";

/**
 * The presets offered in the reconciliation profile editor. An *Advanced*
 * disclosure exposes per-target enable/priority/weight/mode for anything these
 * do not cover.
 */
export const TEXT_TARGET_PRESETS: Record<TextTargetPreset, TextMatchConfig> = {
  "payee-only": {
    targets: [payeeTarget("payeeName", 1)],
    combine: "best-of",
    priorityFirstThreshold: 0.6,
  },
  "imported-payee": {
    targets: [payeeTarget("importedPayee", 1), payeeTarget("payeeName", 2)],
    combine: "priority-first",
    priorityFirstThreshold: 0.6,
  },
  notes: {
    targets: [notesTarget(1), payeeTarget("payeeName", 2)],
    combine: "priority-first",
    priorityFirstThreshold: 0.6,
  },
  "all-best-match": {
    targets: [notesTarget(1), payeeTarget("importedPayee", 2), payeeTarget("payeeName", 3)],
    combine: "best-of",
    priorityFirstThreshold: 0.6,
  },
};

/**
 * A new profile defaults to `all-best-match` because it assumes nothing about
 * the user's workflow: `best-of` takes the maximum, so a field that is empty or
 * irrelevant contributes nothing rather than diluting the score. The user then
 * narrows it — or runs detect-best-field — once they can see which field
 * actually carries their evidence.
 */
export const DEFAULT_TEXT_PRESET: TextTargetPreset = "all-best-match";

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  // Actual's own fuzzy matcher uses ±7 days; matching a narrower window while
  // claiming parity would be misleading (V2 §9).
  dateToleranceDays: 7,
  autoMatchFloor: 60,
  ambiguityDelta: 8,
  text: TEXT_TARGET_PRESETS[DEFAULT_TEXT_PRESET],
  needleFloor: DEFAULT_NEEDLE_FLOOR,
  requireExactAmount: true,
};
