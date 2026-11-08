"use client";

import React, { useMemo } from "react";
import { Settings2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import type { AccountClass } from "@/lib/account-class";
import { flagAllowed, type AccountFlag } from "@/lib/account-class/flags";
import { REPORTING_LABELS, reportingRequirement, validSavedTreatment, type ReportingTreatment } from "@/lib/account-class/reporting";

const CASH = "__cash__";
const HOLDING = "holding";
const ACCESSIBLE = "accessible";

export type AccountFlagState = { excluded: boolean; accessible: boolean; offbudgetIncome: boolean };

/**
 * How one account counts in Financial Insights, on one line. The class gives an automatic label; a Bank account can be marked a
 * fixed / restricted deposit, and an Other Asset is a holding, accessible money or a fixed asset. A settings button holds the yes/no
 * choices that apply to this account (accessible money, income in an off-budget account, and whether it is included in Financial
 * Insights at all). Nothing here is required. A choice shows only while it can apply, and a saved one that no longer can is kept but not shown.
 */
export const AccountReportingCell = React.memo(function AccountReportingCell({
  accountId,
  accountName,
  accountClass,
  offBudget,
  saved,
  flags,
  excludedByGroup = false,
  groupName,
  unsaved,
  disabled,
  onChangeTreatment,
  onChangeFlag,
}: {
  accountId: string;
  accountName: string;
  accountClass: AccountClass | null;
  offBudget: boolean;
  saved: ReportingTreatment | undefined;
  flags: AccountFlagState;
  /** The account's group is left out of Financial Insights, so the account is too and cannot be changed here. */
  excludedByGroup?: boolean;
  groupName?: string;
  /** The account has not been saved to Actual yet, so it has no permanent id to attach a choice to. */
  unsaved: boolean;
  disabled: boolean;
  onChangeTreatment: (accountId: string, treatment: ReportingTreatment | null) => void;
  onChangeFlag: (accountId: string, flag: AccountFlag, on: boolean) => void;
}) {
  const requirement = accountClass ? reportingRequirement(accountClass) : null;
  const treatment = accountClass ? validSavedTreatment(accountClass, saved) : null;
  const canExclude = flagAllowed("excluded", accountClass, offBudget, treatment);
  const canAccessible = flagAllowed("accessible", accountClass, offBudget, treatment);
  const canIncome = flagAllowed("offbudget-income", accountClass, offBudget, treatment);
  const excluded = flags.excluded || excludedByGroup;
  const name = accountName || "unnamed account";

  const options = useMemo(() => {
    if (requirement?.kind === "optional") {
      return [{ value: HOLDING, label: requirement.label }, { value: ACCESSIBLE, label: "Accessible money" }, ...requirement.options.map((value) => ({ value, label: REPORTING_LABELS[value] }))];
    }
    if (requirement?.kind === "bank-default") {
      return [{ value: CASH, label: requirement.label }, { value: "fixed-deposit", label: REPORTING_LABELS["fixed-deposit"] }];
    }
    return [];
  }, [requirement]);

  if (unsaved) return <span className="px-2 text-xs text-muted-foreground/70">Save the account to choose</span>;

  const treatmentControl = !accountClass || !requirement ? (
    <span className="px-2 text-xs text-muted-foreground/70">{excluded ? "Class not needed" : "Choose a class first"}</span>
  ) : requirement.kind === "automatic" ? (
    <span className="px-2 text-xs text-muted-foreground">{requirement.label}</span>
  ) : (
    <Select
      size="sm"
      className="h-6"
      disabled={disabled}
      aria-label={`Financial Reporting of ${name}`}
      value={requirement.kind === "optional" ? (treatment === "fixed-asset" ? "fixed-asset" : flags.accessible ? ACCESSIBLE : HOLDING) : (treatment ?? CASH)}
      options={options}
      onValueChange={(next) => {
        if (requirement.kind === "bank-default") { onChangeTreatment(accountId, next === CASH ? null : (next as ReportingTreatment)); return; }
        // Other Asset: a holding, accessible money (a flag) or a fixed asset (a treatment); the last two cannot both be set.
        if (next === "fixed-asset") { onChangeTreatment(accountId, "fixed-asset"); if (flags.accessible) onChangeFlag(accountId, "accessible", false); return; }
        if (treatment === "fixed-asset") onChangeTreatment(accountId, null);
        onChangeFlag(accountId, "accessible", next === ACCESSIBLE);
      }}
    />
  );

  const hasSettings = canExclude || (canAccessible && accountClass === "investment") || canIncome || excludedByGroup;
  const summary = [excluded && "Left out", !excluded && flags.accessible && canAccessible && "Accessible", !excluded && flags.offbudgetIncome && canIncome && "Income"].filter(Boolean).join(" · ");
  return (
    <span className="flex items-center gap-1">
      {treatmentControl}
      {summary && <span className="whitespace-nowrap rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{summary}</span>}
      {hasSettings && (
        <Popover>
          <PopoverTrigger render={<button type="button" aria-label={`Settings of ${name}`} title="Account settings" className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />}>
            <Settings2 className="size-3.5" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-2 p-3 text-xs">
            <p className="font-medium">{name}</p>
            {canAccessible && accountClass === "investment" && (
              <SettingRow label="Accessible money" hint="Counts as money you can reach, in the cash buffer's second figure." checked={flags.accessible} disabled={disabled || excluded} onChange={(on) => onChangeFlag(accountId, "accessible", on)} />
            )}
            {canIncome && (
              <SettingRow label="Uncategorized entries are income" hint="Money in with no category (interest, for example) counts as income, not as an unidentified movement." checked={flags.offbudgetIncome} disabled={disabled || excluded} onChange={(on) => onChangeFlag(accountId, "offbudget-income", on)} />
            )}
            {(canExclude || excludedByGroup) && (
              <SettingRow
                label="Include in Financial Insights"
                hint={excludedByGroup ? `Excluded by group${groupName ? ` “${groupName}”` : ""}. Change it on the group.` : "Turn off to leave the account out of every figure."}
                checked={!excluded}
                disabled={disabled || excludedByGroup}
                onChange={(on) => onChangeFlag(accountId, "excluded", !on)}
              />
            )}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
});

function SettingRow({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-2">
      <Checkbox className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <span className="flex flex-col"><span className="font-medium">{label}</span><span className="text-muted-foreground">{hint}</span></span>
    </label>
  );
}
