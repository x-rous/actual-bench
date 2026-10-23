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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlobalShortcutsHelp } from "./GlobalShortcutsHelp";

import { DOCS_BASE_URL } from "@/lib/features/catalogue";

export const DOCS_URL = DOCS_BASE_URL;
const GITHUB_URL = "https://github.com/x-rous/actual-bench";

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** App-wide help and keyboard shortcuts in the top bar. */
export function HelpMenu() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          title="Help & feedback"
          aria-label="Help & feedback"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <HelpCircle className="h-4 w-4 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="w-52 text-xs text-muted-foreground">
          <DropdownMenuItem onClick={() => openExternal(DOCS_URL)}>
            <FileText className="h-4 w-4 text-xs text-muted-foreground" />
            Documentation
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
            <Keyboard className="h-4 w-4 text-xs text-muted-foreground" />
            Keyboard shortcuts
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openExternal(GITHUB_URL)}>
            <ExternalLink className="h-4 w-4 text-xs text-muted-foreground" />
            GitHub Repository
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openExternal(`${GITHUB_URL}/issues/new`)}>
            <AlertCircle className="h-4 w-4 text-xs text-muted-foreground" />
            Report an Issue
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openExternal(`${GITHUB_URL}/blob/main/CHANGELOG.md`)}>
            <BookOpen className="h-4 w-4 text-xs text-muted-foreground" />
            Changelog
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <GlobalShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
