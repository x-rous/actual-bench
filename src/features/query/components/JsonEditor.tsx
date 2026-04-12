"use client";

/**
 * JsonEditor — textarea + syntax-highlight overlay + line numbers + line highlight.
 *
 * Architecture: three layers stacked in a position:relative container.
 *
 *   z-index 1  <pre>   — colorized mirror of textarea content (pointer-events: none)
 *   z-index 2  gutter  — line numbers (pointer-events: none, scrolls via translateY)
 *   z-index 3  <textarea> — captures all input; color: transparent so the pre shows through
 *
 * Font metrics MUST match between the textarea and the pre. Both use the same
 * CSS custom properties (--font-mono, size, line-height, padding) so they stay
 * in sync. A font change will automatically propagate to both layers.
 *
 * Scroll sync: textarea onScroll → pre.scrollTop/scrollLeft + gutter translateY.
 *
 * Active line: computed from selectionStart on click / keydown / select events.
 * The active line span in the pre gets a subtle background highlight.
 */

import { useRef, useState, useCallback } from "react";
import { colorizeJson } from "../lib/jsonColorize";

// ─── Layout constants ─────────────────────────────────────────────────────────
// These must match the textarea's rendered metrics exactly.

const GUTTER_W   = 40;    // px — wide enough for 4-digit line numbers
const PAD_X      = 16;    // px — horizontal content padding (matches px-4)
const PAD_Y      = 12;    // px — vertical content padding (matches py-3)
const FONT_SIZE  = 12;    // px — text-xs
const LINE_H_R   = 1.625; // leading-relaxed
const LINE_H_PX  = FONT_SIZE * LINE_H_R; // 19.5 px

// Styles shared by both the <pre> overlay and the <textarea>.
// They must be identical to keep lines visually aligned.
const SHARED: React.CSSProperties = {
  fontFamily:      "var(--font-mono)",
  fontSize:        `${FONT_SIZE}px`,
  lineHeight:      LINE_H_R,
  paddingTop:      PAD_Y,
  paddingBottom:   PAD_Y,
  paddingLeft:     GUTTER_W + PAD_X,
  paddingRight:    PAD_X,
  tabSize:         2,
  whiteSpace:      "pre",
  wordBreak:       "normal",
  overflowWrap:    "normal",
  letterSpacing:   "normal",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Return true if custom undo was applied; false lets the browser handle it natively. */
  onUndo?: () => boolean;
  height: number;
  placeholder?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JsonEditor({
  value,
  onChange,
  onKeyDown,
  onUndo,
  height,
  placeholder,
}: JsonEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef      = useRef<HTMLPreElement>(null);

  const [activeLine,   setActiveLine]   = useState(0);
  const [gutterOffset, setGutterOffset] = useState(0);

  const lines = value.split("\n");

  // ─── Active line tracking ────────────────────────────────────────────────────

  const computeActiveLine = useCallback((el: HTMLTextAreaElement) => {
    const pos  = el.selectionStart ?? 0;
    const line = el.value.slice(0, pos).split("\n").length - 1;
    setActiveLine(line);
  }, []);

  // ─── Scroll sync ─────────────────────────────────────────────────────────────

  function handleScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    const { scrollTop, scrollLeft } = e.currentTarget;
    setGutterOffset(scrollTop);
    if (preRef.current) {
      preRef.current.scrollTop  = scrollTop;
      preRef.current.scrollLeft = scrollLeft;
    }
  }

  // ─── Input event handlers ────────────────────────────────────────────────────

  function handleClick(e: React.MouseEvent<HTMLTextAreaElement>) {
    computeActiveLine(e.currentTarget);
  }

  function handleSelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    computeActiveLine(e.currentTarget);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Intercept Ctrl+Z / Cmd+Z to restore the pre-load snapshot (if one exists).
    // This only fires when onUndo is provided, meaning a programmatic load just
    // replaced the editor value. Normal browser undo for typed text is unaffected.
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && onUndo) {
      if (onUndo()) {
        e.preventDefault();
        return;
      }
    }

    // Intercept Tab to insert 2 spaces instead of moving browser focus.
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const next = el.value.slice(0, start) + "  " + el.value.slice(end);
      onChange(next);
      // Restore cursor after React re-renders the controlled value.
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 2;
          textareaRef.current.selectionEnd = start + 2;
          computeActiveLine(textareaRef.current);
        }
      });
      return;
    }
    onKeyDown?.(e);
    // Defer so selectionStart reflects the position after the key is applied.
    requestAnimationFrame(() => {
      if (textareaRef.current) computeActiveLine(textareaRef.current);
    });
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      style={{ position: "relative", height, overflow: "hidden" }}
      className="bg-background"
    >
      {/* ── Gutter: line numbers ─────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position:        "absolute",
          left:            0,
          top:             0,
          bottom:          0,
          width:           GUTTER_W,
          overflow:        "hidden",
          zIndex:          2,
          backgroundColor: "var(--background)",
          borderRight:     "1px solid color-mix(in oklch, var(--border) 60%, transparent)",
        }}
      >
        {/* Translate to match textarea scroll position */}
        <div style={{ transform: `translateY(${-gutterOffset}px)`, paddingTop: PAD_Y }}>
          {lines.map((_, i) => (
            <div
              key={i}
              style={{
                height:      LINE_H_PX,
                lineHeight:  `${LINE_H_PX}px`,
                textAlign:   "right",
                paddingRight: 8,
                fontSize:    FONT_SIZE,
                fontFamily:  "var(--font-mono)",
                color:       "var(--muted-foreground)",
                opacity:     i === activeLine ? 0.65 : 0.3,
                userSelect:  "none",
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* ── Syntax highlight overlay ─────────────────────────────────────── */}
      <pre
        ref={preRef}
        aria-hidden="true"
        style={{
          ...SHARED,
          position:      "absolute",
          inset:         0,
          margin:        0,
          zIndex:        1,
          pointerEvents: "none",
          overflow:      "hidden",
          color:         "var(--foreground)",
          background:    "transparent",
        }}
      >
        {lines.map((line, i) => (
          <span
            key={i}
            style={{
              display:    "block",
              background: i === activeLine
                ? "var(--editor-line-highlight)"
                : "transparent",
            }}
            // Empty lines must still occupy full line height; \u00A0 prevents collapse.
            dangerouslySetInnerHTML={{ __html: colorizeJson(line) || "\u00A0" }}
          />
        ))}
      </pre>

      {/* ── Textarea ─────────────────────────────────────────────────────── */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onSelect={handleSelect}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        // Class only for the ::placeholder CSS rule in globals.css.
        className="json-editor-textarea"
        style={{
          ...SHARED,
          position:   "absolute",
          inset:      0,
          width:      "100%",
          height:     "100%",
          zIndex:     3,
          color:      "transparent",
          caretColor: "var(--foreground)",
          background: "transparent",
          resize:     "none",
          outline:    "none",
          overflow:   "auto",
          border:     "none",
        }}
      />
    </div>
  );
}
