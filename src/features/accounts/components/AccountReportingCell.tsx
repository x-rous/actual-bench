"use client";

import React, { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { AccountClass } from "@/lib/account-class";
import { REPORTING_LABELS, reportingRequirement, validSavedTreatment, type ReportingTreatment } from "@/lib/account-class/reporting";

const CHOOSE = "__choose__";
const CASH = "__cash__";

/**
 * The Financial Reporting treatment of one account. Most classes have a fixed
 * treatment, shown as plain text. Investment, Other Asset and Other Liability need
 * a choice: until it is made the cell is marked with a warning icon and the words
 * "Choose…", so it never relies on colour alone. A Bank account is cash unless it
 * is marked as a fixed / restricted deposit.
 */
export const AccountReportingCell = React.memo(function AccountReportingCell({
  accountId,
  accountName,
  accountClass,
  saved,
  unsaved,
  disabled,
  choicesLoaded = true,
  exempt = false,
  onChange,
}: {
  accountId: string;
  accountName: string;
  accountClass: AccountClass | null;
  saved: ReportingTreatment | undefined;
  /** The account has not been saved to Actual yet, so it has no permanent id to attach a choice to. */
  unsaved: boolean;
  disabled: boolean;
  /** The saved choices have loaded: until then a missing choice is not known, so it is not flagged. */
  choicesLoaded?: boolean;
  /** A closed account with no activity: nothing to choose, so no warning. */
  exempt?: boolean;
  onChange: (accountId: string, treatment: ReportingTreatment | null) => void;
}) {
  const requirement = accountClass ? reportingRequirement(accountClass) : null;
  const options = useMemo(() => {
    if (requirement?.kind === "required") {
      return [{ value: CHOOSE, label: "Choose…", disabled: true }, ...requirement.options.map((value) => ({ value, label: REPORTING_LABELS[value] }))];
    }
    if (requirement?.kind === "bank-default") {
      return [{ value: CASH, label: requirement.label }, { value: "fixed-deposit", label: REPORTING_LABELS["fixed-deposit"] }];
    }
    return [];
  }, [requirement]);

  if (!accountClass || !requirement) {
    return <span className="px-2 text-xs text-muted-foreground/70">Choose a class first</span>;
  }
  if (requirement.kind === "automatic") {
    return <span className="px-2 text-xs text-muted-foreground">{requirement.label}</span>;
  }
  if (unsaved) {
    return <span className="px-2 text-xs text-muted-foreground/70">Save the account to choose</span>;
  }

  const value = validSavedTreatment(accountClass, saved);
  const missing = requirement.kind === "required" && !value && choicesLoaded && !exempt;
  return (
    <span className="flex items-center gap-1">
      {missing && <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
      <Select
        size="sm"
        className={missing ? "h-6 border-amber-500/70" : "h-6"}
        disabled={disabled}
        aria-label={`Financial Reporting of ${accountName || "unnamed account"}${missing ? " (choice needed)" : ""}`}
        value={value ?? (requirement.kind === "required" ? CHOOSE : CASH)}
        options={options}
        onValueChange={(next) => onChange(accountId, next === CHOOSE || next === CASH ? null : (next as ReportingTreatment))}
      />
    </span>
  );
});
