"use client";

import { renderMarkdownToHtml } from "@/lib/markdown";
import { cn } from "@/lib/utils";

export function MarkdownPreview({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-3 text-sm text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:my-0 [&_code]:break-words [&_del]:opacity-80 [&_em]:italic [&_h1]:mb-2 [&_h2]:mb-2 [&_h3]:mb-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:my-0 [&_pre]:my-0 [&_strong]:font-semibold [&_ul]:my-0",
        className
      )}
      dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(markdown) }}
    />
  );
}
