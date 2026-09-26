"use client";

import { useState } from "react";
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
import { changeVaultPassphrase, lockVault } from "@/features/connect/vaultApi";
import { useAuthStatus } from "@/hooks/useAuthStatus";
import { readVaultUnlockDuration } from "@/features/connect/vaultUnlockPreference";
import { parseApiError } from "@/components/connect/utils";
import { fullPageLoad } from "@/lib/auth/fullPageLoad";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

/**
 * End this browser's session and go to the sign-in page; a full load drops
 * every connection and credential the tab holds in memory. If the server does
 * not confirm, the user stays where they are and is told, rather than landing
 * on a sign-in page that sends them straight back. `beforeLeave` runs only once
 * the session has ended (the app shell drops unsaved changes there).
 */
export async function signOut({ beforeLeave }: { beforeLeave?: () => void } = {}): Promise<void> {
  try {
    await lockVault();
  } catch (error) {
    toast.error(`Could not sign out: ${parseApiError(error)}`);
    return;
  }
  beforeLeave?.();
  fullPageLoad("/login");
}

/**
 * Sign out and change password (RD-096). Shown only when Actual Bench asks for
 * its password. `onSignOut` lets the app shell ask about unsaved changes first.
 */
export function AccountMenu({ onSignOut = () => signOut() }: { onSignOut?: () => void | Promise<void> }) {
  const [changeOpen, setChangeOpen] = useState(false);
  const { data: status } = useAuthStatus();

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
