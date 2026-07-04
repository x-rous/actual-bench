"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DirectModeUnavailableProps = {
  title: string;
  description: string;
  detail?: string;
};

export function DirectModeUnavailable({
  title,
  description,
  detail,
}: DirectModeUnavailableProps) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <section className="w-full max-w-lg rounded-md border border-amber-200 bg-amber-50/60 p-6 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {detail && (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
        )}
        <Link href="/accounts" className={cn(buttonVariants({ className: "mt-5" }))}>
          Open supported page
          <ArrowRight data-icon="inline-end" />
        </Link>
      </section>
    </main>
  );
}
