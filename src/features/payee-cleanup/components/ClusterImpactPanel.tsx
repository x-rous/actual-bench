import { Star } from "lucide-react";
import type { ClusterImpact } from "../lib/impact";

type Props = {
  impact: ClusterImpact;
  targetName: string;
};

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * The blast radius of one merge (RD-078 §10).
 *
 * Every number here is something the user is about to change, so each is stated
 * in Actual's own terms — and where Actual's behaviour is surprising, the panel
 * says so rather than leaving the user to infer it.
 *
 * No per-payee list: the payee list on the card already carries each member's
 * transaction count, and showing the same rows twice on one screen was pure
 * noise.
 */
export function ClusterImpactPanel({ impact, targetName }: Props) {
  const { rules, behavior } = impact;
  const totalRules = rules.regular + rules.activeSchedule;

  return (
    <div className="space-y-3 text-xs">
      <section>
        <h4 className="font-medium text-foreground">Transactions</h4>
        <p className="text-muted-foreground">
          {impact.transactionsLoading || impact.transactionTotal === undefined ? (
            "Counting…"
          ) : (
            <>
              {formatCount(impact.transactionTotal)}{" "}
              {impact.transactionTotal === 1 ? "transaction" : "transactions"} will
              show <span className="font-medium text-foreground">{targetName}</span>{" "}
              as their payee.
            </>
          )}
        </p>
      </section>

      <section>
        <h4 className="font-medium text-foreground">Rules</h4>
        {totalRules === 0 && rules.completedSchedule === 0 ? (
          <p className="text-muted-foreground">No rules reference these payees.</p>
        ) : (
          <ul className="space-y-0.5 text-muted-foreground">
            {rules.regular > 0 ? (
              <li>
                {formatCount(rules.regular)} regular{" "}
                {rules.regular === 1 ? "rule" : "rules"}
              </li>
            ) : null}
            {rules.activeSchedule > 0 ? (
              <li>
                {formatCount(rules.activeSchedule)} active schedule
                {rules.activeSchedule === 1 ? "" : "s"} (through{" "}
                {rules.activeSchedule === 1 ? "its rule" : "their rules"})
              </li>
            ) : null}
            {rules.completedSchedule > 0 ? (
              <li>
                {formatCount(rules.completedSchedule)} completed schedule
                {rules.completedSchedule === 1 ? "" : "s"} - not counted as active
              </li>
            ) : null}
          </ul>
        )}
        {totalRules > 0 ? (
          // The single most surprising thing about Actual's merge, and the user
          // is about to rely on it.
          <p className="mt-1 text-muted-foreground">
            Merging does not rewrite these rules. They keep pointing at the old
            payee, and Actual resolves them to{" "}
            <span className="font-medium text-foreground">{targetName}</span>{" "}
            afterwards.
          </p>
        ) : null}
      </section>

      <section>
        <h4 className="font-medium text-foreground">Payee settings</h4>
        {behavior.favoriteDiffers || behavior.learnCategoriesDiffers ? (
          <p className="text-muted-foreground">
            These payees disagree on{" "}
            {[
              behavior.favoriteDiffers ? "Favorite" : null,
              behavior.learnCategoriesDiffers ? "Category learning" : null,
            ]
              .filter(Boolean)
              .join(" and ")}
            . The payee you keep decides the outcome - Actual&apos;s API does not
            let Actual Bench change either setting.
          </p>
        ) : (
          <p className="text-muted-foreground">
            All of these payees agree on Favorite and Category learning.
          </p>
        )}
        <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
          <span>After merging:</span>
          {behavior.survivingFavorite ? (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Star className="size-3" aria-hidden="true" />
              Favorite
            </span>
          ) : (
            <span className="font-medium text-foreground">Not a favorite</span>
          )}
          <span aria-hidden="true">·</span>
          <span className="font-medium text-foreground">
            Category learning {behavior.survivingLearnCategories ? "on" : "off"}
          </span>
        </p>
      </section>

    </div>
  );
}
