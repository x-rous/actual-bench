"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
};

export function AccountFormDrawer({ open, onOpenChange, onSubmit }: Props) {
  const isEditing = false;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
    control,
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: "",
      offBudget: false,
    },
  });

  useEffect(() => {
    if (open) reset({ name: "", offBudget: false });
  }, [open, reset]);

  function handleFormSubmit(values: AccountFormValues) {
    onSubmit(values);
    onOpenChange(false);
  }

  const offBudget = useWatch({ control, name: "offBudget" });

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
            <Label>Budget Type</Label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={!offBudget}
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

        </form>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="account-form" disabled={isSubmitting}>
            {isEditing ? "Apply Changes" : "Add Account"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
