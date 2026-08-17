"use client";

import { useMemo, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { useStagedStore } from "@/store/staged";
import { usePayeeCleanupCandidates } from "../hooks/usePayeeCleanupCandidates";
import { usePayeeCleanupImpact } from "../hooks/usePayeeCleanupImpact";
import { useSuppressions } from "../hooks/useSuppressions";
import {
  addMember,
  excludeMember,
  resetCluster,
  setCanonicalName,
  setDecision,
  combineGroups,
  setCreateRule,
  setRulePattern,
  setTarget,
  type CorrectionMap,
} from "../lib/corrections";
import { useImportedTextIndex } from "../hooks/useImportedTextIndex";
import { scanForCleanup } from "../lib/scan";
import { CleanupSummaryCards } from "./CleanupSummaryCards";
import { SuggestionCard } from "./SuggestionCard";
import { findNameCollisions, isSafeForBulkAccept } from "../lib/triage";
import { CombineGroupsBanner } from "./CombineGroupsBanner";
import { CleanupFilterBar, type BandFilter, type CleanupTab } from "./CleanupFilterBar";
import { UnusedPayeeList } from "./UnusedPayeeList";
import { SuppressionList } from "./SuppressionList";
import { ReviewCleanupBar } from "./ReviewCleanupBar";
import { usePayeeCleanupPlan, type StageOutcome } from "../hooks/usePayeeCleanupPlan";
import { buildPlan, planOperationCount } from "../lib/plan";

/**
 * The Payee Cleanup workspace: scan, review, correct, accept, stage.
 *
 * Every write leaves through `stage(plan)` and lands in the shared staged store,
 * so this screen never touches the budget directly — the Payees page's Save is
 * still the only thing that writes. The scan itself is derived state: it re-runs
 * from the candidates, the impact sources and the user's corrections, which is
 * why both hooks feeding it memoize their results.
 */
export function PayeeCleanupView() {
  const { partition: scanned, isLoading, error, refetch } =
    usePayeeCleanupCandidates({ enabled: true });

  // Payees already staged for a merge or deletion are no longer candidates.
  //
  // The candidate list comes from a fresh `getPayees()`, which knows nothing
  // about the staged store — so without this, staging left every suggestion on
  // screen exactly as before, and the same merge could be staged twice.
  const pendingMerges = useStagedStore((s) => s.pendingPayeeMerges);
  const stagedPayees = useStagedStore((s) => s.payees);

  const stagedRules = useStagedStore((s) => s.rules);

  /**
   * Everything staged and waiting for Save, not merges alone.
   *
   * A rename-only or rule-only plan produces no merge, so counting
   * `pendingPayeeMerges` reported "nothing pending" while real work sat unsaved
   * — the one situation this reminder exists for.
   *
   * Counts *changed* entries only. The staged store holds the whole working set,
   * so its key count is every payee in the budget, which read as hundreds of
   * changes waiting on a page where nothing had been touched.
   */
  const stagedCount = useMemo(() => {
    const changed = (
      map: Record<string, { isNew: boolean; isUpdated: boolean; isDeleted: boolean }>
    ) => Object.values(map).filter((e) => e.isNew || e.isUpdated || e.isDeleted).length;

    return pendingMerges.length + changed(stagedPayees) + changed(stagedRules);
  }, [pendingMerges, stagedPayees, stagedRules]);

  const stagedAwayIds = useMemo(() => {
    const ids = new Set(pendingMerges.flatMap((m) => m.mergeIds));
    for (const [id, entry] of Object.entries(stagedPayees)) {
      if (entry.isDeleted) ids.add(id);
    }
    return ids;
  }, [pendingMerges, stagedPayees]);

  const partition = useMemo(
    () =>
      stagedAwayIds.size === 0
        ? scanned
        : {
            ...scanned,
            eligible: scanned.eligible.filter((p) => !stagedAwayIds.has(p.id)),
          },
    [scanned, stagedAwayIds]
  );

  const [tab, setTab] = useState<CleanupTab>("suggestions");
  const [band, setBand] = useState<BandFilter>("all");
  const [search, setSearch] = useState("");

  const [corrections, setCorrections] = useState<CorrectionMap>({});
  const impact = usePayeeCleanupImpact(partition.eligible, { enabled: true });
  const { suppressions, rejectCluster, undo, clearAll } = useSuppressions({
    enabled: true,
  });

  const { rows: importedText, truncated: importedTextTruncated } =
    useImportedTextIndex({ enabled: true });
  const rules = useMemo(
    () =>
      Object.values(impact.stagedRules)
        .filter((r) => !r.isDeleted)
        .map((r) => r.entity),
    [impact.stagedRules]
  );

  const result = useMemo(
    () =>
      scanForCleanup(partition, {
        impactSources: impact,
        suppressions,
        corrections,
        importedText,
        importedTextTruncated,
        rules,
      }),
    [
      partition,
      impact,
      suppressions,
      corrections,
      importedText,
      importedTextTruncated,
      rules,
    ]
  );

  const { stage, isStaging } = usePayeeCleanupPlan();
  const [stageOutcome, setStageOutcome] = useState<StageOutcome | null>(null);
  const clearOutcome = () => setStageOutcome(null);

  const plan = useMemo(() => buildPlan(result.suggestions), [result.suggestions]);

  // Deliberately stricter than "the score is high" — see `isSafeForBulkAccept`.
  // A bulk action meaning "accept everything above 90%" would sweep up exactly
  // the cases this feature exists to catch.
  // Surfaced as soon as two accepted groups share a name, rather than waiting
  // for a failed staging attempt to explain it.
  const collisions = useMemo(
    () => findNameCollisions(result.suggestions),
    [result.suggestions]
  );

  const safeToAccept = useMemo(
    () => result.suggestions.filter(isSafeForBulkAccept),
    [result.suggestions]
  );

  function stageAccepted() {
    const stagedClusterIds = result.suggestions
      .filter((s) => s.correction.decision === "accepted")
      .map((s) => s.cluster.id);

    void stage(plan).then(
      (outcome) => {
        setStageOutcome(outcome);
        if (outcome.status !== "staged") return;

        // A confirmation is a moment, not a state: it says the click worked and
        // then gets out of the way. The standing "staged and waiting" reminder
        // in the strip is what persists.
        toast.success(
          `${outcome.operations} ${
            outcome.operations === 1 ? "change" : "changes"
          } staged — save on the Payees page to apply.`
        );

        // Clear only what was staged. Wiping every correction threw away
        // renames, target choices and combined groups the user was still
        // working on — and looked like the work had been lost.
        setCorrections((c) => {
          const next = { ...c };
          for (const id of stagedClusterIds) delete next[id];
          return next;
        });
      },
      // A rejected promise used to be dropped: the click looked like it worked
      // while nothing was staged. The corrections are deliberately left intact
      // so the user can simply try again.
      (error: Error) =>
        toast.error(
          error.message || "Could not stage this cleanup. Nothing was changed."
        )
    );
  }

  const candidateById = useMemo(
    () => new Map(partition.eligible.map((c) => [c.id, c])),
    [partition.eligible]
  );

  // The tab pill counts what the tab would show, ignoring the search box: a
  // count that fell as you typed would read like suggestions disappearing.
  const visibleBandCount = useMemo(
    () => result.suggestions.filter((s) => s.confidence.band !== "hidden").length,
    [result.suggestions]
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return result.suggestions.filter((suggestion) => {
      // Low-confidence proposals are computed but hidden by default, so the
      // list stays trustworthy while a curious user can still widen it.
      if (band === "all" ? suggestion.confidence.band === "hidden" : suggestion.confidence.band !== band) {
        return false;
      }
      if (!query) return true;
      return suggestion.cluster.members.some((m) =>
        m.name.toLowerCase().includes(query)
      );
    });
  }, [result.suggestions, band, search]);

  return (
    <PageLayout
      title="Payee Cleanup"
      count={
        isLoading
          ? undefined
          : [
              `${result.analyzedCount.toLocaleString("en-US")} payees analyzed`,
              result.excludedTransferCount > 0
                ? `${result.excludedTransferCount} transfer excluded`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
      }
      actions={
        <div className="flex items-center gap-2">
          {safeToAccept.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              title="Structural matches with no rule, settings or future-rule conflicts. Still staged — nothing is written until you save."
              onClick={() =>
                setCorrections((c) => {
                  let next = c;
                  for (const suggestion of safeToAccept) {
                    next = setDecision(next, suggestion.cluster.id, "accepted");
                  }
                  return next;
                })
              }
            >
              Accept {safeToAccept.length} safe
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Scan again
          </Button>
          <Button
            size="sm"
            onClick={stageAccepted}
            disabled={isStaging || planOperationCount(plan) === 0}
          >
            <Check className="size-3.5" aria-hidden="true" />
            {isStaging
              ? "Checking…"
              : `Stage cleanup${
                  planOperationCount(plan) > 0 ? ` (${planOperationCount(plan)})` : ""
                }`}
          </Button>
        </div>
      }
      isLoading={isLoading}
      isError={Boolean(error)}
      error={error}
      onRetry={() => refetch()}
      emptyState={
        result.analyzedCount === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No payees to analyze yet.
          </div>
        ) : undefined
      }
      // The filters, the totals and the pending-changes strip stay put while
      // the suggestion list scrolls under them. Triaging fifty groups means
      // scrolling constantly, and losing the counts and the Stage button at the
      // first scroll makes the page feel unanchored.
      scrollManaged
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CleanupFilterBar
        tab={tab}
        onTabChange={setTab}
        band={band}
        onBandChange={setBand}
        search={search}
        onSearchChange={setSearch}
        counts={{
          // The same set the tab renders. Counting every suggestion included
          // the hidden band, so the pill could read 12 above a list of 8.
          suggestions: visibleBandCount,
          unused: result.orphans.length,
          dismissed: suppressions.length,
        }}
      />

      <div className="shrink-0 px-4 pt-3">
        <CleanupSummaryCards result={result} plan={plan} />
      </div>

      <ReviewCleanupBar
        stagedCount={stagedCount}
        outcome={stageOutcome}
      />

      {collisions.length > 0 ? (
      <div className="shrink-0 px-4 pt-3">
        <CombineGroupsBanner
          collisions={collisions}
          onCombine={(collision) => {
            // The group with the most payees survives, so the fewest members
            // have to move.
            const [survivor, ...absorbed] = [...collision.suggestions].sort(
              (a, b) => b.cluster.members.length - a.cluster.members.length
            );
            setCorrections((c) =>
              combineGroups(
                c,
                { clusterId: survivor.cluster.id, finalName: collision.finalName },
                absorbed.map((s) => ({
                  clusterId: s.cluster.id,
                  memberIds: s.cluster.members.map((m) => m.id),
                }))
              )
            );
          }}
        />
      </div>
      ) : null}

      {/* The gap belongs to the rule, not to whatever happens to sit above it.
          Putting it on the totals meant the pending strip and the combine
          banner — which appear between the two — butted straight against the
          line. */}
      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-auto border-t border-border/40 p-4">
        {tab === "dismissed" ? (
          <SuppressionList
            suppressions={suppressions}
            onUndo={undo}
            onClearAll={clearAll}
          />
        ) : tab === "unused" ? (
          <UnusedPayeeList orphans={result.orphans} />
        ) : (
        <>
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
            {result.suggestions.length === 0
              ? "No duplicate or variant payees found. Nothing to clean up."
              : "No suggestions match this filter."}
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((suggestion) => {
              const clusterId = suggestion.cluster.id;
              return (
                <SuggestionCard
                  key={clusterId}
                  suggestion={suggestion}
                  addablePayees={partition.eligible.filter(
                    (p) => !suggestion.cluster.members.some((m) => m.id === p.id)
                  )}
                  onAccept={() => {
                    clearOutcome();
                    setCorrections((c) => setDecision(c, clusterId, "accepted"));
                  }}
                  onReject={() => {
                    // Persisted immediately: a decision the user has to repeat
                    // on every scan is not a decision.
                    rejectCluster(suggestion.cluster);
                    setCorrections((c) => setDecision(c, clusterId, "rejected"));
                  }}
                  onExcludeMember={(payeeId) =>
                    setCorrections((c) => excludeMember(c, clusterId, payeeId))
                  }
                  onSetTarget={(payeeId) =>
                    setCorrections((c) => {
                      const candidate = candidateById.get(payeeId);
                      if (!candidate) return c;
                      const next = setTarget(c, clusterId, candidate);
                      // A refusal comes back as a reason string; the eligibility
                      // boundary already excludes those payees.
                      return typeof next === "string" ? c : next;
                    })
                  }
                  onAddMember={(payeeId) =>
                    setCorrections((c) => {
                      const candidate = candidateById.get(payeeId);
                      if (!candidate) return c;
                      const next = addMember(c, clusterId, candidate);
                      return typeof next === "string" ? c : next;
                    })
                  }
                  onRenameTo={(name) =>
                    setCorrections((c) => setCanonicalName(c, clusterId, name))
                  }
                  onToggleRule={(enabled) =>
                    setCorrections((c) => setCreateRule(c, clusterId, enabled))
                  }
                  onRulePatternChange={(pattern) =>
                    setCorrections((c) => setRulePattern(c, clusterId, pattern))
                  }
                  onReset={() => setCorrections((c) => resetCluster(c, clusterId))}
                />
              );
            })}
          </div>
        )}
        </>
        )}
      </div>

      </div>
    </PageLayout>
  );
}
