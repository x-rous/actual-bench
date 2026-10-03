"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DebtMatchPurpose } from "@/lib/app-db/types";
import type { MatchRuleSave, MatchRuleView } from "@/lib/assets-debt/services/matchingService";

const PURPOSES: { value: DebtMatchPurpose; label: string }[] = [
  { value: "repayment", label: "Scheduled repayment" },
  { value: "interest-charge", label: "Interest charge" },
  { value: "lender-repayment-row", label: "Lender-side repayment row" },
];

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function newDefinition(sourceAccountId: string) {
  return {
    conditions: {
      format: "rd084.debt-match-conditions",
      version: 1,
      operator: "all",
      items: [
        { kind: "source-account", accountId: sourceAccountId },
        { kind: "expected-date", daysBefore: 3, daysAfter: 3 },
        { kind: "bench-marker", value: "exclude" },
        { kind: "posting-link", value: "exclude" },
      ],
    },
    actions: { format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] },
  };
}

export function RuleEditorDialog({
  open,
  rule,
  sourceAccountId,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  rule: MatchRuleView | null;
  sourceAccountId: string;
  onOpenChange: (open: boolean) => void;
  onSave: (value: MatchRuleSave) => Promise<void>;
}) {
  const [purpose, setPurpose] = useState<DebtMatchPurpose>("repayment");
  const [conditions, setConditions] = useState("");
  const [actions, setActions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial = newDefinition(sourceAccountId);
    setPurpose(rule?.record.purpose && typeof rule.record.purpose === "string" ? rule.record.purpose : "repayment");
    setConditions(pretty(rule?.conditions ?? initial.conditions));
    setActions(pretty(rule?.actions ?? initial.actions));
    setError(null);
  }, [open, rule, sourceAccountId]);

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      await onSave({ purpose, conditions: JSON.parse(conditions) as unknown, actions: JSON.parse(actions) as unknown, enabled: rule?.record.enabled ?? false });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit matching rule" : "Add matching rule"}</DialogTitle>
          <DialogDescription>A versioned Bench rule for read-only matching. It never creates or runs an Actual rule.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="match-purpose">Purpose</Label>
            <Select id="match-purpose" value={purpose} onValueChange={(value) => setPurpose(value as DebtMatchPurpose)} options={PURPOSES} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="match-conditions">Conditions · matching DSL v1</Label>
            <Textarea id="match-conditions" value={conditions} onChange={(event) => setConditions(event.target.value)} className="min-h-52 font-mono text-xs" spellCheck={false} />
            <p className="text-xs text-muted-foreground">The starter rule uses the debt payment account, a ±3-day window and both mandatory safety exclusions.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="match-actions">Proposal actions · matching DSL v1</Label>
            <Textarea id="match-actions" value={actions} onChange={(event) => setActions(event.target.value)} className="min-h-28 font-mono text-xs" spellCheck={false} />
            <p className="text-xs text-muted-foreground">P1.4 records proposal intent only. No category, split, transfer or transaction is changed.</p>
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !conditions || !actions}>{saving ? "Saving…" : "Save rule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
