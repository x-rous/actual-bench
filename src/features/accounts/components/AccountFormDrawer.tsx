"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ACCESS_LABEL, accessFlagChanges, classHasAccess, defaultAccess, type Access } from "@/lib/account-class/access";
import type { PendingAccountFlags } from "@/types/staged";
import type { AccountGroup } from "@/types/entities";
import { NO_GROUP, NEW_GROUP } from "../lib/accountGroups";
import { buildGroupOptions } from "./AccountGroupCell";
import { isAccountClassAllowed, type AccountClass } from "@/lib/account-class";
import { buildAccountClassGroups, UNCLASSIFIED, UNCLASSIFIED_OPTIONS } from "./AccountClassCell";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { accountFormSchema, type AccountFormValues } from "../schemas/account.schema";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `flags`: the access and report choices, staged with the new account and saved once it exists. */
  onSubmit: (values: AccountFormValues, flags?: PendingAccountFlags) => void;
  groups?: AccountGroup[];
  groupClasses?: ReadonlyMap<string, AccountClass>;
  excludedGroups?: ReadonlySet<string>;
  groupsReady?: boolean;
  initialValues?: Partial<AccountFormValues>;
  submitLabel?: string;
  description?: string;
};

export function AccountFormDrawer({ open, onOpenChange, onSubmit, groups, groupClasses, excludedGroups, groupsReady = true, initialValues, submitLabel, description }: Props) {
  const isEditing = false;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    formState: { errors, isSubmitting },
    control,
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: "",
      offBudget: false,
      initialBalance: undefined,
      accountClass: null,
      groupId: null,
      access: null,
      excluded: false,
    },
  });

  useEffect(() => {
    if (open) reset({ name: "", offBudget: false, initialBalance: undefined, accountClass: null, groupId: null, access: null, excluded: false, ...initialValues });
  }, [open, reset, initialValues]);

  function handleFormSubmit(values: AccountFormValues) {
    if (values.groupId && (!groups?.some((group) => group.id === values.groupId) ||
      !isAccountClassAllowed(groupClasses?.get(values.groupId), values.offBudget) ||
      (!values.offBudget && excludedGroups?.has(values.groupId)))) {
      setError("groupId", { message: "Choose an available group that supports this budget type." });
      return;
    }
    // Access and "leave out" apply off budget only. Only a choice that differs from the class default is saved, as in the table.
    const chosenClass = inheritedClass ?? values.accountClass ?? null;
    const access = values.offBudget && classHasAccess(chosenClass) && values.access ? accessFlagChanges(chosenClass, values.access) : { accessible: false, locked: false };
    const groupDecidesNow = !!values.groupId && (!!excludedGroups?.has(values.groupId) || !!inheritedClass);
    const excluded = values.offBudget && !groupDecidesNow && !!values.excluded;
    const flags = access.accessible || access.locked || excluded ? { excluded, ...access } : undefined;
    const submitted = { ...values, accountClass: inheritedClass ? null : values.accountClass };
    if (flags) onSubmit(submitted, flags); else onSubmit(submitted);
    onOpenChange(false);
  }

  const offBudget = useWatch({ control, name: "offBudget" });
  const accountClass = useWatch({ control, name: "accountClass" });

  const groupId = useWatch({ control, name: "groupId" });
  const inheritedClass = groupId ? groupClasses?.get(groupId) : undefined;
  const effectiveClass = inheritedClass ?? accountClass;
  const access = useWatch({ control, name: "access" });
  const excluded = useWatch({ control, name: "excluded" });
  const classDefault = offBudget ? defaultAccess(effectiveClass, true) : null;
  // An account takes its group's "left out" when the group is left out, or when it takes its class from the group: its own choice would not apply.
  const groupExcluded = !!groupId && !!excludedGroups?.has(groupId);
  const groupDecides = groupExcluded || !!inheritedClass;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{isEditing ? "Edit Account" : "New Account"}</SheetTitle>
          <SheetDescription>
            {description ?? (isEditing
              ? "Changes are staged and must be saved to apply."
              : "The new account will be staged until you save.")}
          </SheetDescription>
        </SheetHeader>

        <form
          id="account-form"
          onSubmit={handleSubmit(handleFormSubmit)}
          className="flex flex-col gap-4 px-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-name">Account Name</Label>
            <Input
              id="account-name"
              placeholder="e.g. Checking Account"
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-initial-balance">Initial Balance</Label>
            <Input
              id="account-initial-balance"
              type="number"
              step="0.01"
              placeholder="0.00"
              aria-invalid={!!errors.initialBalance}
              {...register("initialBalance", {
                setValueAs: (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
              })}
            />
            {errors.initialBalance && (
              <p className="text-xs text-destructive">{errors.initialBalance.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Optional starting balance for this account. Leave blank for $0.00.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Budget Type</Label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={!offBudget}
                disabled={!isAccountClassAllowed(effectiveClass, false)}
                title={!isAccountClassAllowed(effectiveClass, false) ? "Off-budget accounts only" : undefined}
                onClick={() => setValue("offBudget", false)}
                className="flex h-8 flex-1 items-center justify-center rounded-md border text-sm font-medium transition-colors aria-checked:bg-primary aria-checked:text-primary-foreground aria-not-checked:border-border aria-not-checked:bg-background aria-not-checked:text-foreground"
              >
                On Budget
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={offBudget}
                disabled={!isAccountClassAllowed(effectiveClass, true)}
                title={!isAccountClassAllowed(effectiveClass, true) ? "On-budget accounts only" : undefined}
                onClick={() => setValue("offBudget", true)}
                className="flex h-8 flex-1 items-center justify-center rounded-md border text-sm font-medium transition-colors aria-checked:bg-primary aria-checked:text-primary-foreground aria-not-checked:border-border aria-not-checked:bg-background aria-not-checked:text-foreground"
              >
                Off Budget
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Off-budget accounts are excluded from budget calculations.
            </p>
          </div>

          {groups && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="account-group">Account Group</Label>
              <Select
                id="account-group"
                value={groupId ?? NO_GROUP}
                disabled={!groupsReady}
                options={buildGroupOptions(groups, groupClasses, !offBudget, offBudget, excludedGroups).filter((option) => option.value !== NEW_GROUP)}
                onValueChange={(next) => {
                  if (!isAccountClassAllowed(groupClasses?.get(next), offBudget)) return;
                  if (!offBudget && excludedGroups?.has(next)) return;
                  setValue("groupId", next === NO_GROUP ? null : next, { shouldDirty: true, shouldValidate: true });
                  if (groupClasses?.has(next)) setValue("accountClass", null, { shouldValidate: true });
                }}
              />
              {!groupsReady && <p className="text-xs text-muted-foreground">Account classes must load before choosing a group.</p>}
              {errors.groupId && <p className="text-xs text-destructive" role="alert">{errors.groupId.message}</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-class">Account Class</Label>
            <Select
              id="account-class"
              value={effectiveClass ?? UNCLASSIFIED}
              disabled={!!inheritedClass}
              options={UNCLASSIFIED_OPTIONS}
              groups={buildAccountClassGroups(!offBudget)}
              onValueChange={(next) => setValue("accountClass", next === UNCLASSIFIED ? null : next as NonNullable<AccountFormValues["accountClass"]>, { shouldDirty: true, shouldValidate: true })}
            />
            {inheritedClass && <p className="text-xs text-muted-foreground">Inherited from the selected account group.</p>}
            {errors.accountClass && <p className="text-xs text-destructive" role="alert">{errors.accountClass.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-access">Accessible</Label>
            {classDefault ? (
              <Select
                id="account-access"
                value={access ?? classDefault}
                options={(["available", "locked"] as const).map((value) => ({ value, label: `${ACCESS_LABEL[value]}${value === classDefault ? " (class default)" : ""}` }))}
                onValueChange={(next) => setValue("access", next === classDefault ? null : (next as Access), { shouldDirty: true })}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{!offBudget ? "On budget: always available now." : effectiveClass ? "This class has no access to choose." : "Choose a class first."}</p>
            )}
            <p className="text-xs text-muted-foreground">Whether you could use this money now. It decides what counts as cash in Financial Insights and Cashflow.</p>
          </div>

          {offBudget && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={groupDecides ? !!groupExcluded : !!excluded} disabled={groupDecides} onCheckedChange={(on) => setValue("excluded", on, { shouldDirty: true })} />
              <span className="flex flex-col"><span>Leave out of reports</span><span className="text-xs text-muted-foreground">{groupDecides
                ? "The selected group decides this. Change it on the group in Manage Groups."
                : "Financial Insights and Cashflow leave out its balance, entries and transfers. It then needs no class."}</span></span>
            </label>
          )}

        </form>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="account-form" disabled={isSubmitting || (!!groupId && !groupsReady)}>
            {submitLabel ?? (isEditing ? "Apply Changes" : "Add Account")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
