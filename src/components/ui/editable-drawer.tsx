"use client";

import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type EditableDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  descriptionClassName?: string;
  side?: "top" | "bottom" | "left" | "right";
  contentClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * Shared shell for feature drawers that edit staged data.
 *
 * Keeps the layout framing consistent while leaving field bodies and footer
 * actions fully feature-owned.
 */
export function EditableDrawer({
  open,
  onOpenChange,
  title,
  description,
  descriptionClassName,
  side = "right",
  contentClassName,
  headerClassName,
  footerClassName,
  footer,
  children,
}: EditableDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn("flex flex-col overflow-hidden gap-0 p-0", contentClassName)}
      >
        <SheetHeader className={cn("border-b px-4 py-3", headerClassName)}>
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription className={descriptionClassName}>
              {description}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        {children}

        {footer ? (
          <SheetFooter className={cn("border-t px-4 py-3", footerClassName)}>
            {footer}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
