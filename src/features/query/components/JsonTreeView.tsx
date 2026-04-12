"use client";

/**
 * JsonTreeView — collapsible recursive JSON tree renderer.
 *
 * Renders as a fourth "Tree" tab in QueryResults. Shown when the result is
 * a plain object or array (not a scalar). Auto-selected as the default view
 * for plain objects (the scalar-like result shape from some calculate queries).
 *
 * Collapse state is a Map<path, boolean> keyed by node path (e.g. "root",
 * "root.items[3]", "root.items[3].name"). Nodes not in the map use a default:
 *   - arrays / objects with more than 5 children → collapsed
 *   - everything else → expanded
 *
 * Token colors reuse the --json-* CSS variables from globals.css so coloring
 * is consistent with the editor overlay and the RawView.
 */

import { useState } from "react";

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Encodes an object key into a JSON Pointer segment (RFC 6901).
 * '~' → '~0', '/' → '~1' — prevents key collisions like "a.b" vs {a:{b:…}}.
 */
function encodePointerKey(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

// ─── Collapse state ───────────────────────────────────────────────────────────

type CollapseMap = Map<string, boolean>;

function defaultCollapsed(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 5;
  if (value !== null && typeof value === "object") {
    return Object.keys(value as object).length > 5;
  }
  return false;
}

function nodeCollapsed(path: string, value: unknown, map: CollapseMap): boolean {
  const stored = map.get(path);
  return stored !== undefined ? stored : defaultCollapsed(value);
}

// ─── Value renderers ──────────────────────────────────────────────────────────

function StrVal({ v }: { v: string }) {
  const MAX = 120;
  const truncated = v.length > MAX;
  const display = truncated ? `${v.slice(0, MAX)}…` : v;
  return (
    <span
      style={{ color: "var(--json-string)" }}
      title={truncated ? v : undefined}
    >
      &quot;{display}&quot;
    </span>
  );
}

function NumVal({ v }: { v: number }) {
  return <span style={{ color: "var(--json-number)" }}>{v}</span>;
}

function BoolVal({ v }: { v: boolean }) {
  return <span style={{ color: "var(--json-boolean)" }}>{String(v)}</span>;
}

function NullVal() {
  return <span style={{ color: "var(--json-null)" }}>null</span>;
}

function Punct({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--json-punct)" }}>{children}</span>;
}

function KeyLabel({ k }: { k: string }) {
  return (
    <span className="shrink-0">
      <span style={{ color: "var(--json-key)" }}>&quot;{k}&quot;</span>
      <Punct>{": "}</Punct>
    </span>
  );
}

function IndexLabel({ i }: { i: number }) {
  return (
    <span
      className="mr-1.5 shrink-0 text-[10px]"
      style={{ color: "var(--json-punct)" }}
    >
      [{i}]
    </span>
  );
}

function CollapsedSummary({
  count,
  kind,
}: {
  count: number;
  kind: "key" | "item";
}) {
  return (
    <span className="mx-1 text-[10px] text-muted-foreground/50">
      {count} {kind}
      {count !== 1 ? "s" : ""}
    </span>
  );
}

function ToggleBtn({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="mr-1 shrink-0 text-muted-foreground/35 transition-colors hover:text-muted-foreground"
      style={{ fontSize: 9, width: 10, lineHeight: 1 }}
    >
      {collapsed ? "▶" : "▼"}
    </button>
  );
}

// ─── Row wrapper ──────────────────────────────────────────────────────────────

function Row({
  depth,
  children,
}: {
  depth: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 items-center rounded px-1 py-px transition-colors hover:bg-accent/30"
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      {children}
    </div>
  );
}

// ─── Tree node ────────────────────────────────────────────────────────────────

interface NodeProps {
  value: unknown;
  path: string;
  depth: number;
  label?: React.ReactNode;
  collapsed: CollapseMap;
  onToggle: (path: string, currentlyCollapsed: boolean) => void;
}

function JsonTreeNode({
  value,
  path,
  depth,
  label,
  collapsed,
  onToggle,
}: NodeProps) {
  // ── null ────────────────────────────────────────────────────────────────────
  if (value === null) {
    return (
      <Row depth={depth}>
        {label}
        <NullVal />
      </Row>
    );
  }

  // ── boolean ─────────────────────────────────────────────────────────────────
  if (typeof value === "boolean") {
    return (
      <Row depth={depth}>
        {label}
        <BoolVal v={value} />
      </Row>
    );
  }

  // ── number ──────────────────────────────────────────────────────────────────
  if (typeof value === "number") {
    return (
      <Row depth={depth}>
        {label}
        <NumVal v={value} />
      </Row>
    );
  }

  // ── string ──────────────────────────────────────────────────────────────────
  if (typeof value === "string") {
    return (
      <Row depth={depth}>
        {label}
        <StrVal v={value} />
      </Row>
    );
  }

  // ── array ───────────────────────────────────────────────────────────────────
  if (Array.isArray(value)) {
    const coll = nodeCollapsed(path, value, collapsed);

    if (coll) {
      return (
        <Row depth={depth}>
          {label}
          <ToggleBtn collapsed onClick={() => onToggle(path, coll)} />
          <Punct>[</Punct>
          <CollapsedSummary count={value.length} kind="item" />
          <Punct>]</Punct>
        </Row>
      );
    }

    return (
      <>
        <Row depth={depth}>
          {label}
          <ToggleBtn collapsed={false} onClick={() => onToggle(path, coll)} />
          <Punct>[</Punct>
        </Row>
        {value.map((item, i) => (
          <JsonTreeNode
            key={i}
            value={item}
            path={`${path}/${i}`}
            depth={depth + 1}
            label={<IndexLabel i={i} />}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
        <Row depth={depth}>
          <Punct>]</Punct>
        </Row>
      </>
    );
  }

  // ── object ──────────────────────────────────────────────────────────────────
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    const coll = nodeCollapsed(path, value, collapsed);

    if (coll) {
      return (
        <Row depth={depth}>
          {label}
          <ToggleBtn collapsed onClick={() => onToggle(path, coll)} />
          <Punct>{"{"}</Punct>
          <CollapsedSummary count={keys.length} kind="key" />
          <Punct>{"}"}</Punct>
        </Row>
      );
    }

    return (
      <>
        <Row depth={depth}>
          {label}
          <ToggleBtn collapsed={false} onClick={() => onToggle(path, coll)} />
          <Punct>{"{"}</Punct>
        </Row>
        {keys.map((k) => (
          <JsonTreeNode
            key={k}
            value={(value as Record<string, unknown>)[k]}
            path={`${path}/${encodePointerKey(k)}`}
            depth={depth + 1}
            label={<KeyLabel k={k} />}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
        <Row depth={depth}>
          <Punct>{"}"}</Punct>
        </Row>
      </>
    );
  }

  // ── undefined / other ────────────────────────────────────────────────────────
  return (
    <Row depth={depth}>
      {label}
      <span className="text-muted-foreground/40">undefined</span>
    </Row>
  );
}

// ─── JsonTreeView ─────────────────────────────────────────────────────────────

interface JsonTreeViewProps {
  data: unknown;
}

export function JsonTreeView({ data }: JsonTreeViewProps) {
  const [collapsed, setCollapsed] = useState<CollapseMap>(new Map());

  function handleToggle(path: string, currentlyCollapsed: boolean) {
    setCollapsed((prev) => {
      const next = new Map(prev);
      next.set(path, !currentlyCollapsed);
      return next;
    });
  }

  return (
    <div className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed">
      <JsonTreeNode
        value={data}
        path="root"
        depth={0}
        collapsed={collapsed}
        onToggle={handleToggle}
      />
    </div>
  );
}
