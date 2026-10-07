"use client";

import { useState } from "react";
import {
  AlertCircle,
  BookOpen,
  ExternalLink,
  FileText,
  HelpCircle,
  Keyboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlobalShortcutsHelp } from "./GlobalShortcutsHelp";

export const DOCS_URL = "https://x-rous.github.io/actual-bench/";
const GITHUB_URL = "https://github.com/x-rous/actual-bench";

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Help, feedback and keyboard shortcuts in one sidebar menu; the documentation comes first. */
export function HelpMenu({ collapsed }: { collapsed: boolean }) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          title="Help & feedback"
          className={cn(
            "flex w-full items-center rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground",
            collapsed ? "justify-center" : "gap-2"
          )}
        >
          <HelpCircle className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Help & feedback</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-52 text-xs text-muted-foreground">
          <DropdownMenuItem onClick={() => openExternal(DOCS_URL)}>
            <FileText className="h-4 w-4 text-muted-foreground" />
            Documentation
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            Keyboard shortcuts
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openExternal(GITHUB_URL)}>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
            GitHub Repository
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openExternal(`${GITHUB_URL}/issues/new`)}>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            Report an Issue
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openExternal(`${GITHUB_URL}/blob/main/CHANGELOG.md`)}>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            Changelog
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <GlobalShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
