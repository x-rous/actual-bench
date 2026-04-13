function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:")
  ) {
    return escapeHtml(trimmed);
  }
  return null;
}

type ListLine = {
  indent: number;
  type: "ul" | "ol";
  content: string;
};

function parseListLine(rawLine: string): ListLine | null {
  const expanded = rawLine.replace(/\t/g, "  ");
  const match = /^(\s*)([-*+]|\d+\.)\s+(.+)$/.exec(expanded);
  if (!match) return null;

  return {
    indent: match[1].length,
    type: /\d+\./.test(match[2]) ? "ol" : "ul",
    content: match[3],
  };
}

function renderInlineMarkdown(text: string): string {
  const codeSegments: string[] = [];
  let html = escapeHtml(text);

  html = html.replace(/`([^`]+)`/g, (_, code: string) => {
    const token = `__CODE_SEGMENT_${codeSegments.length}__`;
    codeSegments.push(
      `<code class="rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.92em] text-foreground">${code}</code>`
    );
    return token;
  });

  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label: string, url: string) => {
      const safeUrl = sanitizeUrl(url);
      if (!safeUrl) {
        return label;
      }
      return `<a href="${safeUrl}" target="_blank" rel="noreferrer" class="underline decoration-border underline-offset-4 hover:text-foreground">${label}</a>`;
    }
  );

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1<em>$2</em>$3");
  html = html.replace(/(^|[^\w])_([^_]+)_([^\w]|$)/g, "$1<em>$2</em>$3");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/\n/g, "<br />");

  return html.replace(/__CODE_SEGMENT_(\d+)__/g, (_, index: string) => {
    return codeSegments[Number(index)] ?? "";
  });
}

function flushParagraph(paragraphLines: string[], blocks: string[]) {
  if (paragraphLines.length === 0) return;
  blocks.push(
    `<p class="break-words leading-relaxed">${renderInlineMarkdown(
      paragraphLines.join("\n")
    )}</p>`
  );
  paragraphLines.length = 0;
}

function renderListBlock(lines: string[]): string {
  let index = 0;

  function parseList(expectedIndent: number): string {
    let html = "";

    while (index < lines.length) {
      const line = parseListLine(lines[index]);
      if (!line || line.indent < expectedIndent) break;
      if (line.indent > expectedIndent) break;

      const tag = line.type === "ol" ? "ol" : "ul";
      const className =
        line.type === "ol"
          ? "list-decimal space-y-1 pl-5"
          : "list-disc space-y-1 pl-5";

      html += `<${tag} class="${className}">`;

      while (index < lines.length) {
        const current = parseListLine(lines[index]);
        if (
          !current ||
          current.indent !== expectedIndent ||
          current.type !== line.type
        ) {
          break;
        }

        let itemHtml = `<li class="break-words leading-relaxed">${renderInlineMarkdown(
          current.content
        )}`;
        index += 1;

        while (index < lines.length) {
          const nextRaw = lines[index];
          if (!nextRaw.trim()) {
            index += 1;
            continue;
          }

          const nested = parseListLine(nextRaw);
          if (nested) {
            if (nested.indent > expectedIndent) {
              itemHtml += parseList(nested.indent);
              continue;
            }
            break;
          }

          if (/^\s{2,}\S/.test(nextRaw)) {
            itemHtml += `<br />${renderInlineMarkdown(nextRaw.trim())}`;
            index += 1;
            continue;
          }

          break;
        }

        itemHtml += "</li>";
        html += itemHtml;
      }

      html += `</${tag}>`;
    }

    return html;
  }

  const firstLine = parseListLine(lines[0]);
  if (!firstLine) return "";
  return parseList(firstLine.indent);
}

export function renderMarkdownToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const blocks: string[] = [];
  const paragraphLines: string[] = [];

  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushParagraph(paragraphLines, blocks);

      if (inCodeBlock) {
        blocks.push(
          `<pre class="overflow-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground"><code>${escapeHtml(
            codeBlockLines.join("\n")
          )}</code></pre>`
        );
        inCodeBlock = false;
        codeBlockLines = [];
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph(paragraphLines, blocks);
      continue;
    }

    if (parseListLine(line)) {
      flushParagraph(paragraphLines, blocks);

      const listBlockLines = [line];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (
          !nextLine.trim() ||
          !!parseListLine(nextLine) ||
          /^\s{2,}\S/.test(nextLine)
        ) {
          listBlockLines.push(nextLine);
          i += 1;
          continue;
        }
        break;
      }

      blocks.push(renderListBlock(listBlockLines));
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph(paragraphLines, blocks);
      const level = headingMatch[1].length;
      const sizeClass =
        level === 1
          ? "text-lg font-semibold"
          : level === 2
            ? "text-base font-semibold"
            : "text-sm font-semibold";
      blocks.push(
        `<h${level} class="${sizeClass} text-pretty break-words">${renderInlineMarkdown(
          headingMatch[2]
        )}</h${level}>`
      );
      continue;
    }

    const quoteMatch = /^>\s?(.+)$/.exec(line);
    if (quoteMatch) {
      flushParagraph(paragraphLines, blocks);
      blocks.push(
        `<blockquote class="border-l-2 border-border pl-3 text-muted-foreground">${renderInlineMarkdown(
          quoteMatch[1]
        )}</blockquote>`
      );
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph(paragraphLines, blocks);

  if (inCodeBlock) {
    blocks.push(
      `<pre class="overflow-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground"><code>${escapeHtml(
        codeBlockLines.join("\n")
      )}</code></pre>`
    );
  }

  return blocks.join("");
}
