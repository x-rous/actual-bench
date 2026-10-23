"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
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
  onSubmit: (values: AccountFormValues) => void;
  groups?: AccountGroup[];
  groupClasses?: ReadonlyMap<string, AccountClass>;
  groupsReady?: boolean;
};

export function AccountFormDrawer({ open, onOpenChange, onSubmit, groups, groupClasses, groupsReady = true }: Props) {
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
    },
  });

  useEffect(() => {
    if (open) reset({ name: "", offBudget: false, initialBalance: undefined, accountClass: null, groupId: null });
  }, [open, reset]);

  function handleFormSubmit(values: AccountFormValues) {
    if (values.groupId && (!groups?.some((group) => group.id === values.groupId) ||
      !isAccountClassAllowed(groupClasses?.get(values.groupId), values.offBudget))) {
      setError("groupId", { message: "Choose an available group that supports this budget type." });
      return;
    }
    onSubmit({ ...values, accountClass: inheritedClass ? null : values.accountClass });
    onOpenChange(false);
  }

  const offBudget = useWatch({ control, name: "offBudget" });
  const accountClass = useWatch({ control, name: "accountClass" });

  const groupId = useWatch({ control, name: "groupId" });
  const inheritedClass = groupId ? groupClasses?.get(groupId) : undefined;
  const effectiveClass = inheritedClass ?? accountClass;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{isEditing ? "Edit Account" : "New Account"}</SheetTitle>
          <SheetDescription>
            {isEditing
              ? "Changes are staged and must be saved to apply."
              : "The new account will be staged until you save."}
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
                options={buildGroupOptions(groups, groupClasses, !offBudget).filter((option) => option.value !== NEW_GROUP)}
                onValueChange={(next) => {
                  if (!isAccountClassAllowed(groupClasses?.get(next), offBudget)) return;
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

        </form>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="account-form" disabled={isSubmitting || (!!groupId && !groupsReady)}>
            {isEditing ? "Apply Changes" : "Add Account"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
