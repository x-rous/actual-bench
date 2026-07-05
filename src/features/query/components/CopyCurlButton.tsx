"use client";

import { Terminal, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildSanitizedCurl, buildFullCurl } from "../lib/queryCurl";
import type { LastExecutedRequest } from "../types";

interface CopyCurlButtonProps {
  lastRequest: LastExecutedRequest;
}

export function CopyCurlButton({ lastRequest }: CopyCurlButtonProps) {
  function copyDefaultCurl() {
    const curl = buildSanitizedCurl(lastRequest);
    navigator.clipboard
      .writeText(curl)
      .then(() => toast.success("Sanitized cURL copied - secrets replaced with placeholders"))
      .catch(() => toast.error("Failed to copy"));
  }

  function copyFullCurl() {
    const curl = buildFullCurl(lastRequest);
    navigator.clipboard
      .writeText(curl)
      .then(() => toast.warning("Full cURL copied - includes real API key and credentials"))
      .catch(() => toast.error("Failed to copy"));
  }

  return (
    <>
      {/* Safe version - prominent, always the first */}
      <Button
        size="sm"
        variant="ghost"
        onClick={copyDefaultCurl}
        title="Copy an actual-http-api cURL command with secrets replaced by placeholders - safe to share"
        className="gap-1.5 text-xs text-muted-foreground"
      >
        <Terminal className="h-3 w-3" />
        Copy HTTP cURL
      </Button>

      {/* Dangerous version - amber styling signals risk */}
      <Button
        size="sm"
        variant="ghost"
        onClick={copyFullCurl}
        title="Copy an actual-http-api cURL command with real API key and credentials - do not share publicly"
        className="gap-1.5 text-xs text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-500 dark:hover:bg-amber-950/40 dark:hover:text-amber-400"
      >
        <ShieldAlert className="h-3 w-3" />
        cURL + secrets
      </Button>
    </>
  );
}
