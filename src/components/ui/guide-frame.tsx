"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { BookOpen, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Common guide dialog, with ordinary buttons so section navigation remains keyboard accessible. */
export function GuideFrame<Section extends string>({ title, description, docsUrl, sections, icons, section, onSection, onClose, children }: {
  title: string;
  description: ReactNode;
  docsUrl?: string;
  sections: readonly (readonly [Section, string])[];
  icons: Record<Section, LucideIcon>;
  section: Section;
  onSection: (section: Section) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [section]);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[73.6rem]">
      <DialogHeader className="shrink-0 flex-row flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/25 px-6 py-3 pr-14">
        <DialogTitle className="flex shrink-0 items-center gap-3 text-base"><span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-primary shadow-sm"><BookOpen className="size-4" aria-hidden /></span>{title}</DialogTitle>
        <DialogDescription className="min-w-0 flex-1 basis-[24rem] text-xs leading-relaxed">{description}{docsUrl && <> <a className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2" href={docsUrl} target="_blank" rel="noopener noreferrer">Full documentation</a></>}</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav aria-label="Guide sections" className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-muted/20 p-3">
          {sections.map(([id, label]) => { const Icon: LucideIcon = icons[id]; return <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => onSection(id)}
            className={cn("flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", section === id ? "bg-background font-semibold text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-background/70 hover:text-foreground")}><Icon className={cn("size-4 shrink-0", section === id ? "text-primary" : "opacity-70")} aria-hidden />{label}</button>; })}
        </nav>
        <div ref={contentRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-7 py-6" aria-live="polite">
          <h2 className="sr-only">{sections.find(([id]) => id === section)?.[1]}</h2>
          {children}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
