"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { generateId } from "@/lib/uuid";
import {
  fingerprintStatement,
  normalizeParseConfig,
  type NormalizedStatement,
  type SignConvention,
  type StatementDateFormat,
  type StatementFormat,
  type StatementParseConfig,
} from "@/lib/reconciliation/statement/normalize";
import {
  STATEMENT_FORMAT_LABELS,
  detectParseConfig,
  detectStatementFormat,
  hasAmbiguousDates,
  parseStatement,
} from "@/lib/reconciliation/statement/source";
import type { ApplyConfig } from "@/lib/reconciliation/session/plan";
import type { MatchConfig } from "@/lib/reconciliation/types";
import type { TextTargetPreset } from "@/lib/reconciliation/match/config";
import type { ReconciliationProfileRecord } from "../lib/reconciliationApi";
import { MatchOptions } from "./MatchOptions";
import { NewTransactionOptions } from "./NewTransactionOptions";
import { formatMinorUnits } from "../lib/format";

/**
 * Screen 2 — import and parse (UX §5).
 *
 * Answers one question before any matching happens: did Actual Bench read the
 * statement correctly? Wrong date interpretation, inverted debits, and
 * mis-parsed amounts all become visible here rather than as mysterious
 * non-matches later.
 *
 * The screen is a fixed desktop workbench: configuration on the left, sized to
 * fit without scrolling, and the parsed statement on the right as the only
 * scrolling surface. That constraint drives the shape of everything below — a
 * collapsed source, a compact matching section, and CSV column mapping that sits
 * above the preview columns it controls rather than in a form the user has to
 * cross-reference against them.
 */

const DATE_FORMATS: { value: StatementDateFormat; label: string }[] = [
  { value: "iso", label: "2026-07-03" },
  { value: "dmy", label: "03/07/2026 (day first)" },
  { value: "mdy", label: "07/03/2026 (month first)" },
  { value: "dmy-name", label: "03 Jul 2026" },
  { value: "ymd-compact", label: "20260703" },
];

const SIGN_CONVENTIONS: { value: SignConvention; label: string }[] = [
  { value: "signed", label: "One amount column, already signed" },
  { value: "debit-credit", label: "Separate debit and credit columns" },
  { value: "signed-inverted", label: "One amount column, spend shown positive" },
];

/** What the file picker offers, and what the paste box can also be. */
const ACCEPTED_EXTENSIONS = ".csv,.tsv,.txt,.ofx,.qfx,.qif";

/** One selectable source column, named by its header and a real value from it. */
type SourceColumn = { index: number; label: string };

/**
 * One setting as a label/value row.
 *
 * A narrow configuration column cannot afford a label stacked above every
 * control: side by side, the labels form a column the eye can run down.
 */
function FieldRow({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
      <Label htmlFor={id} className="text-xs leading-tight">
        {label}
      </Label>
      {children}
      {hint && <div className="col-start-2 -mt-0.5">{hint}</div>}
    </div>
  );
}

/** A bordered block with a heading, so the left pane reads as sections. */
function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border/60">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      <div className="flex flex-col gap-2 p-3">{children}</div>
    </section>
  );
}

/**
 * A source-column selector sitting directly above the column it feeds.
 *
 * Deliberately unlabelled: the semantic heading immediately above it — Date,
 * Imported payee — *is* the label, and that adjacency is the point. Change the
 * selector and the values underneath change, with nothing to cross-reference
 * against a form elsewhere on the screen.
 */
function MappingSelect({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  required,
}: {
  id: string;
  ariaLabel: string;
  value: number | undefined;
  options: SourceColumn[];
  onChange: (value: number | undefined) => void;
  required?: boolean;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className="h-6 w-full min-w-0 rounded border border-input bg-background px-1 text-[11px] font-normal"
      value={value ?? ""}
      onChange={(event) =>
        onChange(event.target.value === "" ? undefined : Number(event.target.value))
      }
    >
      {!required && <option value="">-</option>}
      {options.map((column) => (
        <option key={column.index} value={column.index}>
          {column.label}
        </option>
      ))}
    </select>
  );
}

export type ImportPanelProps = {
  accountName: string;
  matchConfig: MatchConfig;
  matchPreset: TextTargetPreset;
  /**
   * How a statement row becomes a transaction Actual does not have.
   *
   * Chosen here rather than at review time because the notes source feeds the
   * transformation engine, and a source picked after transformations have run
   * cannot reach the rows they touched.
   */
  applyConfig: ApplyConfig;
  onApplyConfigChange: (config: ApplyConfig) => void;
  /** Keep persisted write choices visible after Apply starts, but not editable. */
  writeSettingsLocked?: boolean;
  /** Saved profiles for this account, most recently used first. */
  profiles: ReconciliationProfileRecord[];
  onMatchConfigChange: (preset: TextTargetPreset, config: MatchConfig) => void;
  onApplyProfile: (profile: ReconciliationProfileRecord) => void;
  onSaveProfile: (name: string, parseConfig: StatementParseConfig) => void;
  isSavingProfile?: boolean;
  /**
   * The statement this session already holds, when re-importing.
   *
   * Named here so the screen can say which of the two statements it is talking
   * about: the session header goes on describing the old one, and two live
   * identities on one screen is how someone applies the wrong month.
   */
  previousStatement?: { name: string | null; start: string | null; end: string | null } | null;
  /**
   * Reports the parsed statement upward as it changes, so the phase button can
   * live in the page toolbar with the other navigation rather than at the foot
   * of this panel where it reads as one more control among many.
   */
  /**
   * The parsed statement, its name, and which kind of file it came from. The
   * format travels with the result because the session records it (F-136) and
   * only this panel knows it while a file is being read.
   */
  onReadyChange: (
    result: NormalizedStatement | null,
    statementName: string | null,
    format: StatementFormat | null
  ) => void;
  /**
   * Statements already imported, by fingerprint. Held here rather than resolved
   * by the caller because only this panel knows what has been parsed yet.
   */
  knownStatements?: {
    fingerprint: string;
    accountName: string | null;
    tag: string | null;
    createdAt: string;
  }[];
};

export function ImportPanel({
  accountName,
  matchConfig,
  matchPreset,
  applyConfig,
  onApplyConfigChange,
  writeSettingsLocked = false,
  profiles,
  onMatchConfigChange,
  onApplyProfile,
  onSaveProfile,
  isSavingProfile,
  previousStatement,
  onReadyChange,
  knownStatements,
}: ImportPanelProps) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [config, setConfig] = useState<StatementParseConfig | null>(null);
  const [appliedProfileId, setAppliedProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [rawOpen, setRawOpen] = useState(false);

  const source = useMemo(() => (text.trim() ? { text, fileName } : null), [text, fileName]);

  // What the file *is*, decided from its content and name — not from whatever
  // the last profile happened to be about. A saved CSV profile applied to an
  // OFX export must not read it as a table of one enormous column.
  const detectedFormat = useMemo(() => (source ? detectStatementFormat(source) : null), [source]);

  // Seeded by detection the first time a statement appears. Getting the
  // debit/credit case wrong here signs every outflow positive, and since
  // matching requires the exact signed amount, nothing would match at all.
  const effectiveConfig = useMemo<StatementParseConfig | null>(() => {
    if (!source || !detectedFormat) return null;
    if (config && config.format === detectedFormat) return config;
    return detectParseConfig(source);
  }, [source, detectedFormat, config]);

  const parsed = useMemo(() => {
    if (!source || !effectiveConfig) return null;
    return parseStatement(source, effectiveConfig, () => generateId());
  }, [source, effectiveConfig]);

  const table = parsed?.table ?? null;
  const isDelimited = effectiveConfig?.format === "delimited";

  // Unresolvable from the file, so it has to be said out loud: where every date
  // falls in the first twelve days of its month, `03/07` is either the 3rd of
  // July or the 7th of March and detection had to pick one.
  const datesAmbiguous = useMemo(
    () => (source && effectiveConfig ? hasAmbiguousDates(source, effectiveConfig) : false),
    [source, effectiveConfig]
  );

  /**
   * Source columns named by their header *and* a value from them.
   *
   * "Column 3" says nothing about which column it is; "Description · Account
   * Fee" is recognisable at a glance, and a mis-mapping is obvious before it
   * produces a screenful of wrong rows.
   */
  const sourceColumns = useMemo<SourceColumn[]>(() => {
    if (!table) return [];
    const widestRow = table.rows.reduce(
      (widest, row) => Math.max(widest, row.length),
      0
    );
    const width = Math.max(table.headers?.length ?? 0, widestRow);
    return Array.from({ length: width }, (_, index) => {
      const header = table.headers?.[index]?.trim();
      const sample = table.rows.find((row) => (row[index] ?? "").trim())?.[index]?.trim() ?? "";
      const name = header || `Column ${index + 1}`;
      const shortSample = sample.length > 18 ? `${sample.slice(0, 17)}…` : sample;
      return { index, label: shortSample ? `${name} · ${shortSample}` : name };
    });
  }, [table]);

  function update(patch: Partial<StatementParseConfig>) {
    if (!effectiveConfig) return;
    setConfig({ ...effectiveConfig, ...patch });
    // Once the user edits the settings they are no longer the saved profile, and
    // saying otherwise would be a lie about what is about to run.
    setAppliedProfileId(null);
  }

  function updateColumns(patch: Partial<StatementParseConfig["columns"]>) {
    if (!effectiveConfig) return;
    update({ columns: { ...effectiveConfig.columns, ...patch } });
  }

  function applyProfile(profile: ReconciliationProfileRecord) {
    // Checked rather than cast: a profile is JSON from the app database, and one
    // missing its `columns` would otherwise throw while rendering this panel.
    const saved = profile.mapping == null ? null : normalizeParseConfig(profile.mapping);
    // A profile carries column indexes for one file shape; the format still
    // comes from the file in front of us.
    if (saved) setConfig(detectedFormat ? { ...saved, format: detectedFormat } : saved);
    setAppliedProfileId(profile.id);
    setProfileName(profile.name);
    onApplyProfile(profile);
  }

  const appliedProfile = profiles.find((profile) => profile.id === appliedProfileId) ?? null;
  const suggestedProfile = profiles[0] ?? null;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    if (file.size > CSV_MAX_BYTES) {
      setFileError(`That file is larger than ${Math.round(CSV_MAX_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    setText(await file.text());
    setFileName(file.name);
    // A new file is a new shape: settings chosen for the previous one — column
    // indexes above all — would silently mis-read it.
    setConfig(null);
    setAppliedProfileId(null);
  }

  const totals = parsed?.totals;
  const canContinue = Boolean(parsed && parsed.rows.length > 0);

  // Reported rather than acted on here: the panel owns parsing, the page owns
  // moving to the next phase.
  useEffect(() => {
    onReadyChange(
      canContinue && parsed ? parsed : null,
      fileName,
      effectiveConfig?.format ?? null
    );
  }, [canContinue, parsed, fileName, effectiveConfig?.format, onReadyChange]);

  // Recognised by the rows themselves, so a statement pasted last month and
  // uploaded this month is still the same statement.
  const duplicateOf = useMemo(() => {
    if (!parsed || parsed.rows.length === 0 || !knownStatements?.length) return null;
    const fingerprint = fingerprintStatement(parsed.rows);
    if (!fingerprint) return null;
    return knownStatements.find((entry) => entry.fingerprint === fingerprint) ?? null;
  }, [parsed, knownStatements]);

  const statementLabel = fileName ?? (text.trim() ? "Pasted statement" : null);

  /*
   * A debit/credit file gets a debit and a credit column in the preview, each
   * under its own selector, rather than one Amount column fed by two hidden
   * mappings. Which side a row lands on *is* the sign, and mapping those two
   * columns the wrong way round is the defect that once matched 0 of 219 rows —
   * so it has to be the thing you can see.
   */
  const splitAmounts = effectiveConfig?.signConvention === "debit-credit";
  const columnCount = splitAmounts ? 6 : 5;

  const uploadControl = (
    <label className="inline-flex h-7 cursor-pointer items-center rounded-md border border-input px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-within:ring-2 focus-within:ring-ring">
      <Upload className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      {statementLabel ? "Change statement" : "Upload a statement"}
      <input
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="sr-only"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </label>
  );

  /**
   * The raw text, on request only.
   *
   * Kept out of the left pane once a statement parses: as a permanent textarea
   * it was the tallest thing on the screen, and it is consulted far less often
   * than the settings it was pushing out of view.
   */
  const rawStatementDialog = (
    <Dialog open={rawOpen} onOpenChange={setRawOpen}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{statementLabel ?? "Statement source"}</DialogTitle>
          <DialogDescription>
            Editing this re-parses the preview. Uploading a different file replaces it.
          </DialogDescription>
        </DialogHeader>
        <textarea
          aria-label="Statement rows"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            // A new paste invalidates settings chosen for the previous shape.
            setConfig(null);
            setFileName(null);
          }}
          rows={16}
          spellCheck={false}
          className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
        />
      </DialogContent>
    </Dialog>
  );

  const sourceSection = (
    <Section
      title="Statement source"
      aside={
        effectiveConfig ? (
          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
            {STATEMENT_FORMAT_LABELS[effectiveConfig.format]}
          </span>
        ) : undefined
      }
    >
      {statementLabel ? (
        /*
         * The one place the statement is named. It was appearing here, in a
         * banner above both panes, and again in the session header — three
         * copies of one filename, and on a re-import two *different* filenames
         * claiming to be current. Row count and period live over the preview,
         * which is what they describe.
         */
        <>
          <p className="truncate text-xs font-medium" title={statementLabel}>
            {statementLabel}
          </p>
          {previousStatement?.name && previousStatement.name !== fileName && canContinue && (
            <p className="text-[11px] text-muted-foreground">
              Replacing: {previousStatement.name}
              {previousStatement.start && previousStatement.end
                ? ` · ${previousStatement.start} → ${previousStatement.end}`
                : ""}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {uploadControl}
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setRawOpen(true)}>
              <FileText className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {fileName ? "View raw statement" : "Edit pasted statement"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {uploadControl}
            <span className="text-[11px] text-muted-foreground">CSV, TSV, OFX, QFX or QIF</span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="statement-text" className="text-xs">
              Or paste statement rows
            </Label>
            <textarea
              id="statement-text"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setConfig(null);
                setFileName(null);
              }}
              rows={5}
              spellCheck={false}
              placeholder={"2026-07-01\tCARREFOUR MARKET\t-342.85"}
              className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
            />
          </div>
        </>
      )}

      {fileError && (
        <p role="alert" className="text-xs text-destructive">
          {fileError}
        </p>
      )}
    </Section>
  );

  const readingSection = effectiveConfig && (
    <Section title="How this file is read">
      {effectiveConfig.format !== "ofx" && (
        <FieldRow
          id="map-date-format"
          label="Date format"
          hint={
            datesAmbiguous ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                These dates could be read either way round - check the preview.
              </p>
            ) : undefined
          }
        >
          <select
            id="map-date-format"
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
            value={effectiveConfig.dateFormat}
            onChange={(event) => update({ dateFormat: event.target.value as StatementDateFormat })}
          >
            {DATE_FORMATS.map((format) => (
              <option key={format.value} value={format.value}>
                {format.label}
              </option>
            ))}
          </select>
        </FieldRow>
      )}

      {isDelimited && (
        <FieldRow id="map-sign" label="Amounts">
          <select
            id="map-sign"
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
            value={effectiveConfig.signConvention}
            onChange={(event) => update({ signConvention: event.target.value as SignConvention })}
          >
            {SIGN_CONVENTIONS.map((convention) => (
              <option key={convention.value} value={convention.value}>
                {convention.label}
              </option>
            ))}
          </select>
        </FieldRow>
      )}

      {effectiveConfig.format !== "ofx" && (
        <FieldRow id="map-decimal" label="Decimal">
          <select
            id="map-decimal"
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
            value={effectiveConfig.decimalSeparator}
            onChange={(event) => update({ decimalSeparator: event.target.value as "." | "," })}
          >
            <option value=".">1,234.56</option>
            <option value=",">1.234,56</option>
          </select>
        </FieldRow>
      )}

      {/*
        Structured files say which text is the payee and which is the memo — but
        some banks fill those fields the wrong way round, or leave the payee
        empty. These are repairs for that, exactly as Actual's own importer
        offers them.
      */}
      {!isDelimited && (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={effectiveConfig.swapPayeeAndMemo}
              onChange={(event) => update({ swapPayeeAndMemo: event.target.checked })}
            />
            <span>
              Swap the payee and memo fields
              <span className="block text-[11px] text-muted-foreground">
                For banks that fill them the wrong way round.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={effectiveConfig.fallbackPayeeToMemo}
              onChange={(event) => update({ fallbackPayeeToMemo: event.target.checked })}
            />
            <span>
              Use the memo when the payee is empty
              <span className="block text-[11px] text-muted-foreground">
                The memo becomes the merchant text and is not repeated in the notes.
              </span>
            </span>
          </label>
        </div>
      )}
    </Section>
  );

  const profileSection = (
    <Section title="Profile">
      {suggestedProfile && !appliedProfile && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="truncate">
            Saved: <span className="font-medium">{suggestedProfile.name}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => applyProfile(suggestedProfile)}
          >
            Use it
          </Button>
        </div>
      )}

      {appliedProfile && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="truncate">
            Using <span className="font-medium">{appliedProfile.name}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => {
              setConfig(null);
              setAppliedProfileId(null);
            }}
          >
            Detect from the file
          </Button>
        </div>
      )}

      {effectiveConfig && (
        <>
          <div className="flex items-center gap-2">
            <input
              id="profile-name"
              aria-label="Profile name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder={`${accountName} statement`}
              className="h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={isSavingProfile}
              onClick={() =>
                onSaveProfile(profileName.trim() || `${accountName} statement`, effectiveConfig)
              }
            >
              {isSavingProfile ? "Saving…" : "Save profile"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stores how this statement is read and the matching options. The same name replaces it.
          </p>
        </>
      )}
    </Section>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      {/*
        Warned, not blocked, and before the settings rather than under them:
        re-importing is legitimate — after a partial apply, or to redo a month
        with a corrected mapping — but it is a fact about the file in front of
        you, so it belongs with the file's identity.
      */}
      {duplicateOf && canContinue && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs"
        >
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <p>
            <span className="font-medium">This statement has been imported before.</span>{" "}
            <span className="text-muted-foreground">
              The same rows were imported for {duplicateOf.accountName ?? "this account"}
              {duplicateOf.tag ? ` (${duplicateOf.tag})` : ""} on{" "}
              {new Date(duplicateOf.createdAt).toLocaleDateString()}. Carrying on is fine - matching
              reads what is in Actual now, and anything already applied is recognised and skipped -
              but if you meant to resume that reconciliation, go back and open it instead.
            </span>
          </p>
        </div>
      )}

      {rawStatementDialog}

      {!effectiveConfig ? (
        <div className="flex max-w-2xl flex-col gap-3">
          {sourceSection}
          {profiles.length > 0 && profileSection}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,32fr)_minmax(0,68fr)]">
          {/*
            Configuration, sized to fit rather than to scroll: everything needed
            to confirm how the file was read is visible at once, which is only
            possible because the column mapping now lives over the preview.
          */}
          <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
            {sourceSection}
            {readingSection}
            <Section title="Matching">
              <MatchOptions
                config={matchConfig}
                preset={matchPreset}
                onChange={onMatchConfigChange}
                headingLevel="none"
              />
            </Section>

            {/* Only rows Actual does not already have are affected, so the
                heading says so rather than calling them "new transactions"
                before anything has been matched. */}
            <Section title="When a row isn't in Actual">
              <NewTransactionOptions
                config={applyConfig}
                onChange={onApplyConfigChange}
                // The live config, not the stored one: during import the file
                // can be swapped, and what is on screen is the truth.
                statementFormat={effectiveConfig.format}
                disabled={writeSettingsLocked}
              />
            </Section>
            {profileSection}
          </div>

          {/* The parsed statement: the one scrolling surface on this screen. */}
          <div className="flex min-h-0 flex-col rounded-md border border-border/60">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-3 py-2 text-xs">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Parsed statement
              </h3>
              {parsed && (
                <span className="font-medium tabular-nums">
                  {parsed.rows.length} {parsed.rows.length === 1 ? "row" : "rows"}
                </span>
              )}
              {parsed && parsed.errors.length > 0 && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {parsed.errors.length} could not be read
                </span>
              )}
              {parsed?.period && (
                <span className="tabular-nums text-muted-foreground">
                  {parsed.period.start} → {parsed.period.end}
                </span>
              )}
              {/* Beside what it is about — these rows, and what will and will
                  not happen to them yet. */}
              <span className="ml-auto text-[11px] text-muted-foreground">
                Nothing is written to Actual until the reconciliation is applied.
              </span>
            </div>

            {parsed && parsed.errors.length > 0 && (
              <details className="border-b border-border/60 bg-amber-500/5 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium">
                  {parsed.errors.length} {parsed.errors.length === 1 ? "row" : "rows"} could not be
                  read
                </summary>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {parsed.errors.slice(0, 10).map((error) => (
                    <li key={error.sourceRowNumber}>
                      Row {error.sourceRowNumber}: {error.detail}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/*
              Every parsed row, in a bounded scroller. No page limit and no
              pagination: a statement you cannot read in full is one you cannot
              check, and an eight-row sample cannot show a mis-mapped column that
              only goes wrong on row 40.
            */}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full table-fixed text-xs">
                <caption className="sr-only">Every row parsed from the statement</caption>
                {/* Widths favour the merchant text, which is what a user reads
                    to tell whether the file was mapped correctly. */}
                <colgroup>
                  <col className="w-24" />
                  <col />
                  <col className="w-[22%]" />
                  <col className="w-24" />
                  <col className="w-28" />
                  {splitAmounts && <col className="w-28" />}
                </colgroup>
                <thead className="sticky top-0 z-10 text-muted-foreground">
                  <tr>
                    {/* Opaque per cell: a background on `thead` is not painted
                        under border-collapse, and rows would scroll through it. */}
                    <th scope="col" className="bg-muted px-3 pt-1.5 text-left font-medium">
                      Date
                    </th>
                    <th scope="col" className="bg-muted px-3 pt-1.5 text-left font-medium">
                      Imported payee
                    </th>
                    <th scope="col" className="bg-muted px-3 pt-1.5 text-left font-medium">
                      Notes
                    </th>
                    <th scope="col" className="bg-muted px-3 pt-1.5 text-left font-medium">
                      Reference
                    </th>
                    {splitAmounts ? (
                      <>
                        <th scope="col" className="bg-muted px-3 pt-1.5 text-right font-medium">
                          Debit
                        </th>
                        <th scope="col" className="bg-muted px-3 pt-1.5 text-right font-medium">
                          Credit
                        </th>
                      </>
                    ) : (
                      <th scope="col" className="bg-muted px-3 pt-1.5 text-right font-medium">
                        Amount
                      </th>
                    )}
                  </tr>

                  {/* CSV mapping, directly above the values it feeds. Structured
                      formats state their own fields and get no mapping row. */}
                  {isDelimited && (
                    <tr>
                      <th scope="col" className="bg-muted px-2 pb-1.5 pt-1 font-normal">
                        <MappingSelect
                          id="map-date"
                          ariaLabel="Source column for the posted date"
                          value={effectiveConfig.columns.date}
                          options={sourceColumns}
                          required
                          onChange={(value) => updateColumns({ date: value ?? 0 })}
                        />
                      </th>
                      <th scope="col" className="bg-muted px-2 pb-1.5 pt-1 font-normal">
                        <MappingSelect
                          id="map-imported-payee"
                          ariaLabel="Source column for the imported payee"
                          value={effectiveConfig.columns.importedPayee}
                          options={sourceColumns}
                          onChange={(value) => updateColumns({ importedPayee: value })}
                        />
                      </th>
                      <th scope="col" className="bg-muted px-2 pb-1.5 pt-1 font-normal">
                        <MappingSelect
                          id="map-notes"
                          ariaLabel="Source column for the notes"
                          value={effectiveConfig.columns.notes}
                          options={sourceColumns}
                          onChange={(value) => updateColumns({ notes: value })}
                        />
                      </th>
                      <th scope="col" className="bg-muted px-2 pb-1.5 pt-1 font-normal">
                        <MappingSelect
                          id="map-reference"
                          ariaLabel="Source column for the reference"
                          value={effectiveConfig.columns.reference}
                          options={sourceColumns}
                          onChange={(value) => updateColumns({ reference: value })}
                        />
                      </th>
                      {splitAmounts ? (
                        <>
                          <th scope="col" className="bg-muted px-2 pb-1.5 pt-1 font-normal">
                            <MappingSelect
                              id="map-debit"
                              ariaLabel="Source column for debits"
                              value={effectiveConfig.columns.debit}
                              options={sourceColumns}
                              onChange={(value) => updateColumns({ debit: value })}
                            />
                          </th>
                          <th scope="col" className="bg-muted px-2 pb-1.5 pt-1 font-normal">
                            <MappingSelect
                              id="map-credit"
                              ariaLabel="Source column for credits"
                              value={effectiveConfig.columns.credit}
                              options={sourceColumns}
                              onChange={(value) => updateColumns({ credit: value })}
                            />
                          </th>
                        </>
                      ) : (
                        <th scope="col" className="bg-muted px-2 pb-1.5 pt-1 font-normal">
                          <MappingSelect
                            id="map-amount"
                            ariaLabel="Source column for the amount"
                            value={effectiveConfig.columns.amount}
                            options={sourceColumns}
                            onChange={(value) => updateColumns({ amount: value })}
                          />
                        </th>
                      )}
                    </tr>
                  )}

                  <tr>
                    <th colSpan={columnCount} className="h-px bg-border p-0" />
                  </tr>
                </thead>
                <tbody>
                  {parsed?.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/20 last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                        {row.postedDate}
                      </td>
                      <td className="truncate px-3 py-1.5" title={row.importedPayee}>
                        {row.importedPayee || "-"}
                      </td>
                      <td
                        className="truncate px-3 py-1.5 text-muted-foreground"
                        title={row.bankNotes ?? undefined}
                      >
                        {row.bankNotes ?? "-"}
                      </td>
                      <td
                        className="truncate px-3 py-1.5 text-muted-foreground"
                        title={row.bankReference ?? row.externalId ?? undefined}
                      >
                        {row.bankReference ?? row.externalId ?? "-"}
                      </td>
                      {/* The normalized signed amount, in the column its sign
                          puts it in: an inverted mapping shows up as a column of
                          outflows sitting under Credit. */}
                      {splitAmounts ? (
                        <>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                            {row.amount < 0 ? formatMinorUnits(row.amount) : "-"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                            {row.amount >= 0 ? formatMinorUnits(row.amount) : "-"}
                          </td>
                        </>
                      ) : (
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                          {formatMinorUnits(row.amount)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {parsed && parsed.rows.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No rows could be read from this statement. Check the column mapping and the date
                  format.
                </p>
              )}
            </div>

            {/* Outside the scroller, so it stays put while the rows move. */}
            {totals && (
              <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border/60 bg-background px-3 py-2 text-xs">
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Debits</dt>
                  <dd className="tabular-nums">{formatMinorUnits(totals.debits)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Credits</dt>
                  <dd className="tabular-nums">{formatMinorUnits(totals.credits)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Net</dt>
                  <dd className="font-medium tabular-nums">{formatMinorUnits(totals.net)}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
