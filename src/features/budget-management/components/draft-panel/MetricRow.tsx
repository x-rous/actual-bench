"use client";

/**
 * Single label-value row used throughout the draft panel sections.
 * Tiny, deliberately structureless — just a flex pair with locale-aligned
 * tabular nums on the right.
 */
export function MetricRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-muted-foreground shrink-0 text-[11px]">{label}</span>
      <span
        className={`font-sans tabular-nums text-right text-[11px] ${valueClass ?? "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}
