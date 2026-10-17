import type { ComponentProps } from "react";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Shared compact actions for statement and transaction rows. */
export function CardMenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent align="end" className={cn("w-60 border border-border py-1 shadow-xl [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:px-3 [&_[role=menuitem]]:py-1.5 [&_[role=menuitem]]:text-xs [&_[role=menuitem]]:whitespace-nowrap", className)} {...props} />;
}
