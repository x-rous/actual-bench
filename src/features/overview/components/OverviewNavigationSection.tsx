"use client";

import Link from "next/link";
import { FeatureLinks, FeatureMaturity } from "@/components/layout/FeatureInformation";
import { FEATURE_SECTIONS, type FeatureDefinition } from "@/lib/features/catalogue";

function FeatureTile({ feature }: { feature: FeatureDefinition }) {
  const Icon = feature.icon;
  return (
    <article className="group/card relative flex min-h-[88px] min-w-0 flex-col rounded-lg border border-border/70 bg-background shadow-xs transition-colors has-[a[data-feature-link]:hover]:border-ring/50 has-[a[data-feature-link]:hover]:bg-accent/30 has-[a[data-feature-link]:active]:bg-accent/60">
      <div className="flex items-center gap-2 px-3.5 pt-2">
        <Link
          href={feature.href}
          data-feature-link
          aria-labelledby={`feature-title-${feature.id}`}
          aria-describedby={`feature-description-${feature.id}`}
          className="group flex min-w-0 flex-1 items-center gap-2 after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
        >
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h3 id={`feature-title-${feature.id}`} className="min-w-0 text-sm font-semibold leading-5">{feature.label}</h3>
          <FeatureMaturity feature={feature} />
        </Link>
        <div className="pointer-events-none relative z-10 shrink-0 opacity-0 group-hover/card:pointer-events-auto group-hover/card:opacity-100 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100">
          <FeatureLinks feature={feature} />
        </div>
      </div>
      <p id={`feature-description-${feature.id}`} className="mt-1 px-3.5 pb-3 text-[13px] leading-[1.125rem] text-muted-foreground">{feature.description}</p>
    </article>
  );
}

export function OverviewNavigationSection() {
  return (
    <section className="space-y-5" aria-label="Feature directory">
      {FEATURE_SECTIONS.map((section) => {
        return (
          <section key={section.id} aria-labelledby={`feature-group-${section.id}`}>
            <h2 id={`feature-group-${section.id}`} className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">{section.label}</h2>
            <div className="grid gap-3 md:grid-cols-2 min-[100rem]:grid-cols-3">
              {section.items.map((feature) => <FeatureTile key={feature.id} feature={feature} />)}
            </div>
          </section>
        );
      })}
    </section>
  );
}
