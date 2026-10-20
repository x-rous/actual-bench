"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { InfoHint } from "@/components/ui/info-hint";
import { SearchableCombobox } from "@/components/ui/combobox";
import { CategoryPicker } from "@/components/ui/entity-picker";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { formatAmount, minorToMajorText, parseMajorToMinor } from "@/features/assets-debt/lib/money";
import type { Account } from "@/types/entities";
import { addMonths, dateInMonth, parseIsoDate } from "@/lib/financial-models/calendar/dates";
import { CARD_DATE_FORMAT, formatCardDate } from "../lib/displayDates";
import { bankToday, cycleDates, type StatementDraft } from "../lib/cycles";
import { CARD_COLORS } from "../lib/cardColors";
import { formatPercentBps, parsePercentBps } from "../lib/percent";
import { creditCardStore } from "../lib/store/store";
import { cn } from "@/lib/utils";
import { NEW_CARD_DEFAULTS, type Card, type DueRule, type LimitChange, type Statement } from "../lib/models";
import { useDiscardChanges } from "../hooks/useDiscardChanges";
import { CardMark } from "./CardIdentity";
import { cardNetworkLabel, CARD_NETWORK_OPTIONS } from "./CardNetwork";
import { BillingCyclePreview } from "./BillingCyclePreview";
import { LimitChangesDialog, type LimitChangeDraft } from "./LimitChangesDialog";
import { plural } from "./primitives/format";
import { INSTALMENT_PLANS_DESCRIPTION } from "../lib/vocabulary";
import { GuideLink } from "./guide/CreditCardGuide";

/** Money input in integer minor units; `signed` allows a leading minus. */
function readAmount(value: string, required = false, signed = false): number | null {
  const text = value.trim();
  if (text.includes(",") && !/^-?\d{1,3}(,\d{3})*(\.\d{0,2})?$/.test(text)) {
    throw new Error("Use standard thousands grouping, for example 1,234.56");
  }
  const plain = text.replaceAll(",", "");
  const negative = signed && plain.startsWith("-");
  const parsed = parseMajorToMinor(negative ? plain.slice(1) : plain, 2);
  if (!parsed.ok) throw new Error(parsed.message);
  if (required && parsed.value === null) throw new Error("Enter all required amounts");
  return parsed.value === null ? null : negative ? -parsed.value : parsed.value;
}

function validationMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join(". ");
  return error instanceof Error ? error.message : "Could not save these values";
}

const FIELD_HELP: Record<string, string> = {
  "Actual account": "Uses this Actual account's name, transactions and balance. It cannot be changed after registration.",
  "Statement closing day": "Bank statement dates override this. A month-end close is day 31.",
  "First tracked statement": "Closing date of the first statement to track. Leave blank to start at your earliest saved statement.",
  "Day count": "How daily interest is counted, as in the loan calculator. Used only for the minimum-only estimate and plan estimates.",
  "Bank time zone": "Decides today for closing, due and overdue dates.",
  "Separate plan account in Actual": "Do you move instalment-plan balances to their own off-budget account in Actual? It can be shared by "
    + "several cards, with one #tag per plan in the transfer notes. Transfers with it are never payments.",
  "Plan accounts": "Off-budget accounts that hold instalment-plan balances. Choosing an account in a plan registers it too.",
  "Statement balance includes plan balances": "Most banks include unbilled plan balances in the statement balance and bill only "
    + "the monthly instalment. Bench then adds your plan-account balances when it checks a statement.",
};

type FieldProps = { label: string; children: ReactNode; htmlFor: string; hint?: string; prefilled?: boolean };
function Field({ label, children, htmlFor, hint, prefilled = false }: FieldProps) {
  const help = FIELD_HELP[label];
  return <div className="flex min-w-0 flex-col gap-1">
    <div className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
      <Label className="text-xs leading-4" htmlFor={htmlFor}>{label}</Label>
      {prefilled && <span title="Pre-filled from Actual" className="size-1.5 rounded-full bg-amber-500"><span className="sr-only">(pre-filled from Actual)</span></span>}
      {help && <InfoHint label={label}>{help}</InfoHint>}
    </div>
    {children}
    {hint && <p className="text-[11px] text-amber-700 dark:text-amber-400">{hint}</p>}
  </div>;
}

const dialogClass = "flex flex-col overflow-hidden rounded-lg h-auto max-h-[90dvh] p-5 sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl";

type CardEditorProps = {
  budgetSyncId: string;
  card?: Card;
  accounts: Account[];
  categories?: { id: string; name: string }[];
  categoriesLoading?: boolean;
  categoriesError?: boolean;
  onRetryCategories?: () => void;
  canRegister: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted?: () => void;
  /** Card settings only: the budget's plan accounts (shared by every card) and the off-budget accounts to add. */
  planAccounts?: PlanAccountChoices;
  /** Card settings only: this card's credit-limit changes. */
  limitChanges?: LimitChange[];
};

export type PlanAccountChoices = {
  /**
   * The budget's plan accounts (shared by every card): the plans using each, and its transfers per card
   * account (null until its history is read).
   */
  registered: { id: string; name: string; usedBy: string[]; transfers: Record<string, number> | null }[];
  available: { id: string; name: string }[];
};

function draftFor(card: Card | undefined) {
  const closingDay = card ? card.closingDay : NEW_CARD_DEFAULTS.closingDay;
  const dueRule = card ? card.dueRule : NEW_CARD_DEFAULTS.dueRule;
  return {
    closingDay: closingDay?.toString() ?? "",
    dueKind: dueRule?.kind ?? "day-of-month",
    dueValue: dueRule?.value.toString() ?? "",
    minimumPercent: formatPercentBps(card ? card.minimumPercentBps : NEW_CARD_DEFAULTS.minimumPercentBps),
    minimumFloor: minorToMajorText(card ? card.minimumFloorMinor : NEW_CARD_DEFAULTS.minimumFloorMinor, 2),
    interestCategoryId: card?.interestCategoryId ?? "",
    feeCategoryId: card?.feeCategoryId ?? "",
    cashbackCategoryId: card?.cashbackCategoryId ?? "",
    status: card?.status ?? "active",
    autoPay: card?.autoPay ?? "unknown",
    annualFee: minorToMajorText(card?.annualFeeMinor ?? null, 2),
    renewalDate: card?.annualFeeRenewalDate ?? "",
    openedDate: card?.openedDate ?? "",
    interestModel: card?.interestModel ?? "daily-simple-365",
    firstTrackedStatementDate: card?.firstTrackedStatementDate ?? "",
    includesPlanBalances: card?.statementsIncludePlanBalances ?? false,
  };
}

function dueRuleFrom(kind: string, value: string): DueRule | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error("Enter whole days for the due rule");
  return { kind: kind === "days-after-close" ? "days-after-close" : "day-of-month", value: number };
}

export function CardEditor({
  budgetSyncId, card, accounts, categories = [], categoriesLoading = false, categoriesError = false,
  onRetryCategories, canRegister, onClose, onSaved, onDeleted, planAccounts, limitChanges = [],
}: CardEditorProps) {
  const prefix = useId();
  const [initialCard] = useState(card);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const [color, setColor] = useState<string | null>(card?.color ?? null);
  const [network, setNetwork] = useState(card?.network ?? "unknown");
  const [accountId, setAccountId] = useState(card?.accountId ?? accounts[0]?.id ?? "");
  const [limit, setLimit] = useState(minorToMajorText(card?.creditLimitMinor ?? null, 2));
  const [apr, setApr] = useState(formatPercentBps(card?.purchaseAprBps ?? null));
  const [timeZone, setTimeZone] = useState(card?.bankTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const [initialDraft] = useState(() => draftFor(card));
  const [limits, setLimits] = useState<LimitChangeDraft[]>(() => limitChanges.map(({ effectiveDate, limitMinor }) => ({ effectiveDate, limitMinor })));
  const [recordingLimit, setRecordingLimit] = useState(false);
  const [planIds, setPlanIds] = useState(() => planAccounts?.registered.map((account) => account.id) ?? []);
  // "Do you keep plan principal in a separate account in Actual?" Yes when this card already moves
  // money to a plan account, or its statements are set to include plan balances.
  const [usesPlanAccount, setUsesPlanAccount] = useState(() => Boolean(card?.statementsIncludePlanBalances
    || planAccounts?.registered.some((account) => (account.transfers?.[card?.accountId ?? ""] ?? 0) > 0)));
  const [extra, setExtra] = useState(initialDraft);
  const change = (key: keyof typeof extra, value: string | boolean) => setExtra((current) => ({ ...current, [key]: value }));
  const [error, setError] = useState("");
  const signature = JSON.stringify({ accountId, limit, apr, timeZone, extra, color, network, planIds, usesPlanAccount, limits });
  const [initialSignature] = useState(signature);
  const { requestClose, discardDialog } = useDiscardChanges(signature !== initialSignature, onClose);
  const accountName = accounts.find((account) => account.id === accountId)?.name;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const invalid = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (invalid) {
        invalid.focus();
        throw new Error("Correct the invalid date before saving");
      }
      const closingDay = extra.closingDay.trim() ? Number(extra.closingDay) : null;
      if (closingDay !== null && (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31)) {
        throw new Error("Enter a statement closing day from 1 to 31");
      }
      if (!initialCard && (!canRegister || !accounts.some((account) => account.id === accountId))) {
        throw new Error("This account is no longer eligible. Refresh its classification and try again.");
      }
      // D18: untouched billing days on a new card stay "default" until the first statement.
      const billingUntouched = extra.closingDay === initialDraft.closingDay && extra.dueKind === initialDraft.dueKind
        && extra.dueValue === initialDraft.dueValue;
      const input = {
        budgetSyncId,
        accountId,
        creditLimitMinor: readAmount(limit),
        purchaseAprBps: parsePercentBps(apr),
        bankTimeZone: timeZone,
        status: extra.status,
        network,
        color,
        closingDay,
        dueRule: dueRuleFrom(extra.dueKind, extra.dueValue),
        billingDaysSource: initialCard ? initialCard.billingDaysSource : billingUntouched ? "default" : "user",
        minimumPercentBps: parsePercentBps(extra.minimumPercent),
        minimumFloorMinor: readAmount(extra.minimumFloor),
        annualFeeMinor: readAmount(extra.annualFee),
        annualFeeRenewalDate: extra.renewalDate || null,
        openedDate: extra.openedDate || null,
        firstTrackedStatementDate: extra.firstTrackedStatementDate || null,
        interestCategoryId: extra.interestCategoryId || null,
        feeCategoryId: extra.feeCategoryId || null,
        cashbackCategoryId: extra.cashbackCategoryId || null,
        // The bank can only include plan-account balances when the card has a plan account.
        statementsIncludePlanBalances: usesPlanAccount && extra.includesPlanBalances,
        autoPay: extra.autoPay,
        interestModel: extra.interestModel,
      };
      const actions = creditCardStore.getState();
      if (initialCard) await actions.updateCard(budgetSyncId, initialCard.id, initialCard.revision, input, limits);
      // Answering No never unregisters accounts: other cards may use them.
      if (planAccounts && usesPlanAccount && planIds.join() !== planAccounts.registered.map((account) => account.id).join()) {
        await actions.setPlanAccounts(budgetSyncId, planIds);
      }
      const savedId = initialCard?.id ?? (await actions.registerCard(input)).id;
      onSaved(savedId);
    } catch (cause) {
      setError(validationMessage(cause));
    }
  }

  async function deleteCard() {
    if (!initialCard) return;
    try {
      await creditCardStore.getState().deleteCard(budgetSyncId, initialCard.id, initialCard.revision);
      setDeleting(false);
      (onDeleted ?? onClose)();
    } catch (cause) {
      setDeleteError(validationMessage(cause));
    }
  }

  const categoryFields = ([
    ["interestCategoryId", "Interest category in Actual"],
    ["feeCategoryId", "Fees category in Actual"],
    ["cashbackCategoryId", "Cashback category in Actual"],
  ] as const).map(([key, label]) => <Field key={key} label={label} htmlFor={`${prefix}-${key}`}>
    <CategoryPicker
      ariaLabel={label}
      categories={[
        ...categories,
        ...(extra[key] && !categories.some((category) => category.id === extra[key]) ? [{ id: extra[key], name: "Saved category (unavailable)" }] : []),
      ]}
      disabled={categoriesLoading || categoriesError}
      allowNone
      noneLabel="Not mapped"
      placeholder="Not mapped"
      value={extra[key]}
      onChange={(value) => change(key, value)}
    />
  </Field>);
  const zones = (() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  })();
  const zoneOptions = [...new Set([timeZone, ...zones])].map((zone) => ({ id: zone, name: zone }));

  const accountField = <Field label="Actual account" htmlFor={`${prefix}-account`}>
    <Select
      id={`${prefix}-account`}
      disabled={Boolean(card)}
      value={accountId}
      options={accounts.map((account) => ({ value: account.id, label: account.name }))}
      onValueChange={setAccountId}
    />
  </Field>;
  const trackingField = <Field label="First tracked statement" htmlFor={`${prefix}-tracking-start`}>
    <DateInput
      dateFormat={CARD_DATE_FORMAT}
      id={`${prefix}-tracking-start`}
      value={extra.firstTrackedStatementDate}
      onValueChange={(value) => change("firstTrackedStatementDate", value)}
    />
  </Field>;
  const networkField = <Field label="Network" htmlFor={`${prefix}-network`}>
    <Select id={`${prefix}-network`} value={network} onValueChange={(value) => setNetwork(value as Card["network"])} options={CARD_NETWORK_OPTIONS} />
  </Field>;

  const appearanceFields = <div className="space-y-2">
    <Label className="text-xs leading-4 text-muted-foreground">Card color</Label>
    <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap" role="group" aria-label="Card color">
      {CARD_COLORS.map((entry) => {
        const selected = (color ?? CARD_COLORS[0].color) === entry.color;
        return <button
          key={entry.name}
          type="button"
          aria-label={`Card color ${entry.name.toLowerCase()}`}
          aria-pressed={selected}
          className={cn("size-6 shrink-0 rounded-md border focus-visible:outline-2 focus-visible:outline-ring",
            selected && "ring-2 ring-foreground ring-offset-2")}
          style={{ backgroundColor: entry.color }}
          onClick={() => setColor(entry.name === "Default" ? null : entry.color)}
        />;
      })}
      <label
        className={"relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed "
          + "focus-within:outline-2 focus-within:outline-ring"}
        style={color && !CARD_COLORS.some((entry) => entry.color === color) ? { backgroundColor: color } : undefined}
      >
        <Plus className="size-3.5" aria-hidden />
        <input
          type="color"
          aria-label="Custom card color"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          value={color ?? CARD_COLORS[0].color}
          onChange={(event) => setColor(event.target.value.toLowerCase())}
        />
      </label>
      <Button type="button" variant="ghost" size="xs" onClick={() => setColor(null)}>Clear</Button>
    </div>
  </div>;

  const billingFields = <>
    <Field label="Statement closing day" htmlFor={`${prefix}-closing-day`}>
      <Input
        id={`${prefix}-closing-day`}
        value={extra.closingDay}
        onChange={(event) => change("closingDay", event.target.value)}
        type="number"
        min={1}
        max={31}
      />
    </Field>
    <Field label="Due date rule" htmlFor={`${prefix}-due-kind`}>
      <Select
        id={`${prefix}-due-kind`}
        value={extra.dueKind}
        onValueChange={(value) => change("dueKind", value)}
        options={[{ value: "days-after-close", label: "Days after closing" }, { value: "day-of-month", label: "Day of month" }]}
      />
    </Field>
    <Field label={extra.dueKind === "days-after-close" ? "Days until payment due" : "Payment due day"} htmlFor={`${prefix}-due-value`}>
      <Input
        id={`${prefix}-due-value`}
        type="number"
        min={extra.dueKind === "days-after-close" ? 0 : 1}
        max={extra.dueKind === "days-after-close" ? 90 : 31}
        value={extra.dueValue}
        onChange={(event) => change("dueValue", event.target.value)}
      />
    </Field>
  </>;

  let preview: { closingDate: string; dueDate: string } | null = null;
  let followingPreview: { closingDate: string; dueDate: string } | null = null;
  try {
    const day = Number(extra.closingDay);
    if (day >= 1 && day <= 31) {
      const today = bankToday(timeZone);
      const current = parseIsoDate(today);
      let close = dateInMonth(current.year, current.month, day);
      if (close <= today) close = addMonths(close, 1, day);
      const rules = { closingDay: day, dueRule: dueRuleFrom(extra.dueKind, extra.dueValue) };
      preview = cycleDates(rules, close);
      followingPreview = cycleDates(rules, addMonths(close, 1, day));
    }
  } catch {
    preview = null;
    followingPreview = null;
  }

  const startingLimit = (() => {
    try { return readAmount(limit); } catch { return null; }
  })();
  // The limit in effect today from the staged changes, and the date it started.
  const limitToday = (() => {
    const today = bankToday(timeZone);
    const current = [...limits].filter((entry) => entry.effectiveDate <= today).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
    return current
      ? { text: minorToMajorText(current.limitMinor, 2), since: current.effectiveDate }
      : { text: limit, since: null as string | null };
  })();

  const termsFields = {
    // With no changes the field is the limit (editing corrects it); once changes exist it shows the limit today.
    limit: <div className="min-w-0 space-y-1">
      {limits.length ? <Field label="Current credit limit" htmlFor={`${prefix}-limit`}>
        <Input id={`${prefix}-limit`} readOnly value={limitToday.text} className="bg-muted/40" />
      </Field> : <Field label="Credit limit (optional)" htmlFor={`${prefix}-limit`}>
        <Input id={`${prefix}-limit`} value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="decimal" />
      </Field>}
      {card && <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {limitToday.since && <span>since {formatCardDate(limitToday.since)}</span>}
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => setRecordingLimit(true)}>Record a limit change</button>
      </div>}
    </div>,
    apr: <Field label="Purchase APR % (optional)" htmlFor={`${prefix}-apr`}>
      <Input id={`${prefix}-apr`} value={apr} onChange={(event) => setApr(event.target.value)} inputMode="decimal" />
    </Field>,
    basis: <Field label="Day count" htmlFor={`${prefix}-interest-model`}>
      <Select
        id={`${prefix}-interest-model`}
        value={extra.interestModel}
        onValueChange={(value) => change("interestModel", value)}
        options={[
          // The loan calculator's day-count names (DAY_COUNT_OPTIONS), so both read the same.
          { value: "off", label: "Off (no interest estimate)" },
          { value: "daily-simple-365", label: "Actual/365 Fixed" },
          { value: "daily-simple-360", label: "Actual/360" },
        ]}
      />
    </Field>,
  };

  const paymentFields = {
    minimum: <>
      <Field label="Minimum payment %" htmlFor={`${prefix}-min-percent`}>
        <Input id={`${prefix}-min-percent`} inputMode="decimal" value={extra.minimumPercent}
          onChange={(event) => change("minimumPercent", event.target.value)} />
      </Field>
      <Field label="Minimum payment floor" htmlFor={`${prefix}-min-floor`}>
        <Input id={`${prefix}-min-floor`} inputMode="decimal" value={extra.minimumFloor} onChange={(event) => change("minimumFloor", event.target.value)} />
      </Field>
    </>,
    autoPay: <Field label="Auto-pay" htmlFor={`${prefix}-autoPay`}>
      <Select
        id={`${prefix}-autoPay`}
        value={extra.autoPay}
        onValueChange={(value) => change("autoPay", value)}
        options={["unknown", "off", "minimum", "full", "fixed"].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
      />
    </Field>,
  };

  const statusField = <Field label="Card status" htmlFor={`${prefix}-status`}>
    <Select
      id={`${prefix}-status`}
      value={extra.status}
      onValueChange={(value) => change("status", value)}
      options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
    />
  </Field>;
  const zoneField = <Field label="Bank time zone" htmlFor={`${prefix}-zone`}>
    <SearchableCombobox ariaLabel="Bank time zone" options={zoneOptions} value={timeZone} allowNone={false}
      onChange={(value) => { if (value) setTimeZone(value); }} />
  </Field>;
  const detailsFields = <>
    <Field label="Annual fee" htmlFor={`${prefix}-annualFee`}>
      <Input id={`${prefix}-annualFee`} value={extra.annualFee} onChange={(event) => change("annualFee", event.target.value)} inputMode="decimal" />
    </Field>
    {([["renewalDate", "Fee renewal date"], ["openedDate", "Date opened"]] as const).map(([key, label]) => (
      <Field key={key} label={label} htmlFor={`${prefix}-${key}`}>
        <DateInput dateFormat={CARD_DATE_FORMAT} id={`${prefix}-${key}`} value={extra[key]} onValueChange={(value) => change(key, value)} />
      </Field>
    ))}
  </>;

  const planAccountName = (id: string) => planAccounts?.registered.find((account) => account.id === id)?.name
    ?? planAccounts?.available.find((account) => account.id === id)?.name ?? "Plan account";
  const transfersWith = (id: string) => planAccounts?.registered.find((account) => account.id === id)?.transfers?.[accountId] ?? null;
  const plansFields = <>
    <Field label="Separate plan account in Actual" htmlFor={`${prefix}-uses-plan-account`}>
      <div id={`${prefix}-uses-plan-account`} role="radiogroup" aria-label="Separate plan account in Actual"
        className="inline-flex h-7 w-fit overflow-hidden rounded-md border text-xs">
        {([[true, "Yes"], [false, "No"]] as const).map(([value, label]) => <button
          key={label}
          type="button"
          role="radio"
          aria-checked={usesPlanAccount === value}
          onClick={() => setUsesPlanAccount(value)}
          className={cn("px-3 font-medium", usesPlanAccount === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
        >{label}</button>)}
      </div>
    </Field>
    {usesPlanAccount && <div className="col-span-2 min-w-0">
      <Field label="Plan accounts" htmlFor={`${prefix}-add-plan-account`}>
        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
          {planIds.length > 0 && <ul aria-label="Plan accounts" className="contents">{planIds.map((id) => {
            const usedBy = planAccounts?.registered.find((account) => account.id === id)?.usedBy ?? [];
            return <li key={id} className="inline-flex h-7 items-center gap-1 rounded-md border bg-muted/40 pr-1 pl-2 text-sm">
              {planAccountName(id)}
              {!usedBy.length && <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove plan account ${planAccountName(id)}`}
                onClick={() => setPlanIds(planIds.filter((value) => value !== id))}><X className="size-3" aria-hidden /></Button>}
            </li>;
          })}</ul>}
          {planAccounts?.available.some((account) => !planIds.includes(account.id)) && <Select
            id={`${prefix}-add-plan-account`}
            size="sm"
            className="w-56"
            aria-label="Add plan account"
            value=""
            onValueChange={(value) => { if (value) setPlanIds([...planIds, value]); }}
            options={[
              { value: "", label: planIds.length ? "Add another account" : "Choose an off-budget account" },
              ...planAccounts.available.filter((account) => !planIds.includes(account.id)).map((account) => ({ value: account.id, label: account.name })),
            ]}
          />}
        </div>
        {planIds.length > 0 && <p role="status" className="text-xs text-muted-foreground">{planIds.map((id) => {
          const transfers = transfersWith(id);
          const usedBy = planAccounts?.registered.find((account) => account.id === id)?.usedBy ?? [];
          return `${planAccountName(id)}: ${transfers === null ? "read after saving" : `${plural(transfers, "transfer")} with this card`}`
            + (usedBy.length ? ` · used by ${usedBy.join(", ")}` : "");
        }).join(" · ")}</p>}
      </Field>
      {/* Part of the Yes answer, so it sits under the accounts it depends on. */}
      <div className="mt-2 flex items-center gap-2">
        <Checkbox
          id={`${prefix}-plan-balances`}
          checked={extra.includesPlanBalances}
          onCheckedChange={(checked) => change("includesPlanBalances", checked)}
        />
        <Field label="Statement balance includes plan balances" htmlFor={`${prefix}-plan-balances`}>{null}</Field>
      </div>
    </div>}
  </>;

  // `aside` sits to the right of the section title; the title alone names the group.
  const group = (title: string, content: ReactNode, aside?: ReactNode) => <fieldset className="min-w-0 border-b border-border px-1 pt-2 pb-4 last:border-b-0">
    {aside ? <>
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-2">
        <span aria-hidden className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{aside}</span>
      </div>
    </> : <legend className="pb-2 text-sm font-semibold">{title}</legend>}
    <div className="grid grid-cols-3 gap-x-4 gap-y-3">{content}</div>
  </fieldset>;

  return <>
    <Sheet open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:w-[min(52rem,95vw)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="shrink-0 border-b p-4 pr-12">
          <div className="flex items-center gap-3">
            <CardMark card={{ color, network }} preview />
            <div>
              <SheetTitle>{card ? "Card settings" : "Add credit card"}</SheetTitle>
              <SheetDescription>
                {accountName ?? "Choose an Actual account"}
                {network !== "unknown" && <span className="text-xs"> · {cardNetworkLabel(network)}</span>}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-2">
            {group("Essentials", <>
              {accountField}
              {termsFields.limit}
              {termsFields.apr}
              {trackingField}
              {statusField}
              {zoneField}
            </>)}
            {group("Billing", <>
              {billingFields}
              {preview && <div className="col-span-full"><BillingCyclePreview today={bankToday(timeZone)} cycle={preview} next={followingPreview} /></div>}
            </>)}
            {group("Categories in Actual", <>
              {categoryFields}
              {categoriesLoading && <p role="status" className="col-span-full text-xs text-muted-foreground">Loading Actual categories…</p>}
              {categoriesError && <div role="status" className="col-span-full flex items-center gap-2 text-xs">
                <span>Actual categories unavailable. Existing mappings are kept.</span>
                <Button type="button" variant="outline" size="xs" onClick={onRetryCategories}>Retry categories</Button>
              </div>}
            </>)}
            {group("Minimum and interest estimates", <>
              {paymentFields.minimum}
              {termsFields.basis}
            </>)}
            {planAccounts && group("Instalment plans", plansFields, <>
              {INSTALMENT_PLANS_DESCRIPTION} <GuideLink section="plans" className="ml-1 align-baseline">How instalment plans work</GuideLink>
            </>)}
            {group("Appearance", <>
              <div className="col-span-2">{appearanceFields}</div>
              {networkField}
            </>)}
            {group("More", <>
              {detailsFields}
              {paymentFields.autoPay}
            </>)}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/10 p-4">
            <div>{card && <Button
              ref={deleteTrigger}
              variant="destructive"
              type="button"
              onClick={() => { setDeleteError(""); setDeleting(true); }}
            ><Trash2 className="size-3.5" aria-hidden="true" />Delete card</Button>}</div>
            <div className="flex gap-2">
              <Button variant="outline" type="button" onClick={requestClose}>Cancel</Button>
              <Button type="submit" disabled={!card && !canRegister}>Save card</Button>
            </div>
          </div>
        </form>
      </SheetContent>
      {recordingLimit && <LimitChangesDialog startingMinor={startingLimit} changes={limits} today={bankToday(timeZone)}
        onChange={setLimits} onClose={() => setRecordingLimit(false)} />}
      {card && <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent initialFocus={cancelDelete} finalFocus={deleteTrigger} showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete credit card?</DialogTitle>
            <DialogDescription>
              Delete {accountName ?? "this card"} from Credit Cards? This removes its settings, statements, review decisions,
              types and plans. Your Actual account and transactions stay unchanged. You can Undo this.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p role="alert" className="text-xs text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button ref={cancelDelete} variant="outline" type="button" onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="destructive" type="button" onClick={deleteCard}>Delete card</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </Sheet>
    {discardDialog}
  </>;
}

/** One statement the editor can switch to (the reconciliation flow): a saved one, or an estimate to pre-fill. */
export type StatementEditorChoice = {
  key: string;
  label: string;
  statement?: Statement;
  draft?: StatementDraft;
  previousMissing: boolean;
  /** Shown under the selector, e.g. that changing a verified statement reopens its review. */
  note?: string;
};

type StatementEditorProps = {
  budgetSyncId: string;
  card: Card;
  cardName: string;
  statement?: Statement;
  suggested?: StatementDraft;
  /** The previous statement is not saved, so a previous balance can start reconciliation (D3). */
  previousMissing: boolean;
  canRecord: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
  /** Lets the user pick the statement in the editor itself; `statement`, `suggested` and `previousMissing` then follow the choice. */
  choices?: { options: StatementEditorChoice[]; initial: string };
  title?: string;
  saveLabel?: string;
  cancelLabel?: string;
};

const PREFILL_HINT = "Pre-filled from Actual - check each marked value against your statement";
const amountText = (minor: number | null | undefined) => (minor == null ? "" : formatAmount(minor, 2));

/** The editor's field values for a statement, or for the estimate that pre-fills one not entered yet. */
function figuresFor(statement: Statement | undefined, suggested: StatementDraft | undefined) {
  return {
    periodStart: statement?.periodStart ?? suggested?.periodStart ?? "",
    closingDate: statement?.closingDate ?? suggested?.closingDate ?? "",
    dueDate: statement?.dueDate ?? suggested?.dueDate ?? "",
    balance: amountText(statement?.balanceMinor ?? suggested?.balanceMinor),
    minimum: amountText(statement?.minimumDueMinor ?? (suggested?.minimumKnown ? suggested.minimumDueMinor : null)),
    amountDue: minorToMajorText(statement?.amountDueMinor ?? null, 2),
    previousBalance: minorToMajorText(statement?.previousBalanceMinor ?? null, 2),
    // D19: estimate-filled fields carry a hint until the user edits them.
    prefilled: new Set(statement || !suggested ? [] : [
      "periodStart", "closingDate", "dueDate", "balance", ...(suggested.minimumKnown ? ["minimum"] : []),
    ]),
  };
}

/** What "unsaved changes" compares: the typed values, not the pre-fill hints. */
const figuresSignature = (values: Omit<ReturnType<typeof figuresFor>, "prefilled">) => JSON.stringify({
  periodStart: values.periodStart, closingDate: values.closingDate, dueDate: values.dueDate, balance: values.balance,
  minimum: values.minimum, amountDue: values.amountDue, previousBalance: values.previousBalance,
});

export function StatementEditor({
  budgetSyncId, card, cardName, statement, suggested, previousMissing, canRecord, onClose, onSaved, choices, title, saveLabel, cancelLabel,
}: StatementEditorProps) {
  const prefix = useId();
  const [initial] = useState({ card });
  const [choiceKey, setChoiceKey] = useState(choices?.initial ?? null);
  const choice = choices?.options.find((entry) => entry.key === choiceKey);
  const start = choice ? figuresFor(choice.statement, choice.draft) : figuresFor(statement, suggested);
  // The statement being saved: fixed at open, or the current choice.
  const [target, setTarget] = useState(() => (choice ? choice.statement : statement));
  const [periodStart, setPeriodStart] = useState(start.periodStart);
  const [closingDate, setClosingDate] = useState(start.closingDate);
  const [dueDate, setDueDate] = useState(start.dueDate);
  const [balance, setBalance] = useState(start.balance);
  const [minimum, setMinimum] = useState(start.minimum);
  const [amountDue, setAmountDue] = useState(start.amountDue);
  const [previousBalance, setPreviousBalance] = useState(start.previousBalance);
  const [prefilled, setPrefilled] = useState(start.prefilled);
  const edited = (key: string) => setPrefilled((current) => {
    if (!current.has(key)) return current;
    const next = new Set(current);
    next.delete(key);
    return next;
  });
  const showPrevious = (choice ? choice.previousMissing : previousMissing) || target?.previousBalanceMinor != null;
  const [error, setError] = useState("");
  const signature = figuresSignature({ periodStart, closingDate, dueDate, balance, minimum, amountDue, previousBalance });
  const [initialSignature, setInitialSignature] = useState(signature);
  const { requestClose, confirmThen, discardDialog } = useDiscardChanges(signature !== initialSignature, onClose);

  /** Switches to another statement; typed changes are discarded only after asking. */
  function choose(key: string) {
    const next = choices?.options.find((entry) => entry.key === key);
    if (!next || key === choiceKey) return;
    confirmThen(() => {
      const values = figuresFor(next.statement, next.draft);
      setChoiceKey(key);
      setTarget(next.statement);
      setPeriodStart(values.periodStart);
      setClosingDate(values.closingDate);
      setDueDate(values.dueDate);
      setBalance(values.balance);
      setMinimum(values.minimum);
      setAmountDue(values.amountDue);
      setPreviousBalance(values.previousBalance);
      setPrefilled(values.prefilled);
      setError("");
      setInitialSignature(figuresSignature(values));
    });
  }

  function formatInput(value: string, set: (value: string) => void) {
    try {
      const amount = readAmount(value, false, true);
      if (amount !== null) set(formatAmount(amount, 2));
    } catch {
      // Keep invalid input for correction.
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (event.currentTarget.querySelector('[aria-invalid="true"]')) throw new Error("Correct the invalid date before saving");
      if (!target && !canRecord) throw new Error("Refresh the card account and its classification before recording a statement");
      const facts = {
        periodStart,
        closingDate,
        dueDate,
        balanceMinor: readAmount(balance, true, true),
        minimumDueMinor: readAmount(minimum, true),
        amountDueMinor: amountDue.trim() ? readAmount(amountDue, true) : null,
        previousBalanceMinor: showPrevious ? readAmount(previousBalance, false, true) : null,
      };
      const store = creditCardStore.getState();
      let savedId = target?.id;
      if (target) await store.correctStatement(budgetSyncId, target.id, target.revision, facts);
      else savedId = (await store.recordStatement(budgetSyncId, initial.card.id, facts)).id;
      if (onSaved && savedId) onSaved(savedId);
      else onClose();
    } catch (cause) {
      setError(validationMessage(cause));
    }
  }

  const date = (key: string, label: string, value: string, set: (value: string) => void) => (
    <Field label={label} htmlFor={`${prefix}-${key}`} prefilled={prefilled.has(key)}>
      <DateInput
        dateFormat={CARD_DATE_FORMAT}
        size="default"
        id={`${prefix}-${key}`}
        value={value}
        onValueChange={(next) => { edited(key); set(next); }}
      />
    </Field>
  );
  const money = (key: string, label: string, value: string, set: (value: string) => void, placeholder?: string) => (
    <Field label={label} htmlFor={`${prefix}-${key}`} prefilled={prefilled.has(key)}>
      <Input
        size="default"
        id={`${prefix}-${key}`}
        value={value}
        placeholder={placeholder}
        onBlur={() => formatInput(value, set)}
        onChange={(event) => { edited(key); set(event.target.value); }}
        inputMode="decimal"
      />
    </Field>
  );

  return <>
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle>{title ?? (statement ? "Correct bank figures" : "Add statement")}</DialogTitle>
          <DialogDescription>{cardName} · Enter the figures from your bank statement.</DialogDescription>
          {prefilled.size > 0 && <p className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
            <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />{PREFILL_HINT}
          </p>}
        </DialogHeader>
        <form onSubmit={save} className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 space-y-4 overflow-auto">
            {choices && <div className="space-y-1">
              <Field label="Statement" htmlFor={`${prefix}-choice`}>
                <Select id={`${prefix}-choice`} aria-label="Statement" value={choiceKey ?? ""} onValueChange={choose}
                  options={choices.options.map((entry) => ({ value: entry.key, label: entry.label }))} />
              </Field>
              {choice?.note && <p className="text-xs text-muted-foreground">{choice.note}</p>}
            </div>}
            <fieldset className="rounded-lg border p-4">
              <legend className="px-1 text-sm font-semibold">Statement dates</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {date("periodStart", "Period start", periodStart, setPeriodStart)}
                {date("closingDate", "Closing date", closingDate, setClosingDate)}
                {date("dueDate", "Payment due date", dueDate, setDueDate)}
              </div>
            </fieldset>
            <fieldset className="rounded-lg border p-4">
              <legend className="px-1 text-sm font-semibold">Bank figures</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {money("balance", "Statement balance", balance, setBalance)}
                {money("minimum", "Minimum due", minimum, setMinimum, "0 if none")}
                {money("amountDue", "Amount due (optional)", amountDue, setAmountDue, "Leave blank if same as statement balance")}
                {showPrevious && money("previousBalance", "Previous balance (optional)", previousBalance, setPreviousBalance)}
              </div>
            </fieldset>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="mt-3 flex shrink-0 justify-end gap-2 border-t pt-3">
            <Button variant="outline" type="button" onClick={requestClose}>{cancelLabel ?? "Cancel"}</Button>
            <Button type="submit" disabled={!target && !canRecord}>{saveLabel ?? (onSaved ? "Save and review" : "Save statement")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    {discardDialog}
  </>;
}
