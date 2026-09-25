"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { changeVaultPassphrase, getVaultStatus, lockVault } from "@/features/connect/vaultApi";
import { readVaultUnlockDuration } from "@/features/connect/vaultUnlockPreference";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

export const AUTH_STATUS_QUERY_KEY = ["auth-status"] as const;

/** End this browser's session and go to the sign-in page (a full load clears the tab's memory). */
export async function signOut(): Promise<void> {
  try {
    await lockVault();
  } finally {
    // A full load on purpose: it drops every connection and credential this tab holds in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}

/**
 * Sign out and change password (RD-096). Shown only when Actual Bench asks for
 * its password. `onSignOut` lets the app shell ask about unsaved changes first.
 */
export function AccountMenu({ onSignOut = signOut }: { onSignOut?: () => void | Promise<void> }) {
  const [changeOpen, setChangeOpen] = useState(false);
  const { data: status } = useQuery({
    queryKey: AUTH_STATUS_QUERY_KEY,
    queryFn: getVaultStatus,
    staleTime: 60_000,
  });

  if (status?.authMode !== "password") return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 w-8 p-0")}
          aria-label="Account"
          title="Account"
        >
          <UserRound className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem
            disabled={status.passwordFromEnv}
            onClick={() => setChangeOpen(true)}
          >
            <KeyRound aria-hidden />
            <span className="flex flex-col">
              <span>Change password</span>
              {status.passwordFromEnv && (
                <span className="text-xs text-muted-foreground">Set by ACTUAL_BENCH_PASSWORD</span>
              )}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void onSignOut()}>
            <LogOut aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog
        open={changeOpen}
        onOpenChange={setChangeOpen}
        onSubmit={async (current, next) => {
          await changeVaultPassphrase(current, next, readVaultUnlockDuration());
          toast.success("Password changed. Other browsers were signed out.");
        }}
      />
    </>
  );
}
