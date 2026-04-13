import { renderMarkdownToHtml } from "./markdown";

describe("renderMarkdownToHtml", () => {
  it("renders headings, emphasis, and lists", () => {
    const html = renderMarkdownToHtml(`# Heading

**Bold** and *italic* and __strong__ and _soft_

- One
- Two`);

    expect(html).toContain("<h1");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain("<em>soft</em>");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
  });

  it("escapes raw html while rendering markdown", () => {
    const html = renderMarkdownToHtml(`<script>alert(1)</script> **safe**`);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<strong>safe</strong>");
    expect(html).not.toContain("<script>");
  });

  it("renders inline code, fenced code, and links", () => {
    const html = renderMarkdownToHtml(
      "`code`\n\n```ts\nconst x = 1;\n```\n\n[Docs](https://example.com)"
    );

    expect(html).toContain("<code");
    expect(html).toContain("<pre");
    expect(html).toContain('href="https://example.com"');
  });

  it("renders ordered lists and nested lists", () => {
    const html = renderMarkdownToHtml(`1. First
2. Second
   - Nested child
   - Nested sibling
3. Third`);

    expect(html).toContain("<ol");
    expect(html).toContain("<ul");
    expect(html).toContain("Nested child");
    expect(html).toContain("Nested sibling");
  });
});
