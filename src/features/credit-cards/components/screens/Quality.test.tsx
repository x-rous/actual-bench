import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { cardEntry } from "../entryKit";
import { axeViolations } from "../testing/axe";
import { statementScenario } from "../../lib/statementScenarios.fixture";
import { laptopPlanScenario } from "../../lib/fixtures/testKit";
import { RETIRED_LABELS } from "../../lib/vocabulary";
import { StatementReview } from "../StatementReview";
import { CreditCardGuide } from "../guide/CreditCardGuide";
import type { GuideSection } from "../../lib/vocabulary";
import { OverviewScreen } from "./OverviewScreen";
import { StatementsScreen } from "./StatementsScreen";
import { PaymentsScreen } from "./PaymentsScreen";
import { ActivityScreen } from "./ActivityScreen";
import { PlansScreen } from "./PlansScreen";
import { InsightsScreen } from "./InsightsScreen";
import { PortfolioScreen } from "./PortfolioScreen";

jest.mock("../HistoryChart", () => ({ HistoryChart: ({ title }: { title: string }) => <figure aria-label={title}><figcaption>{title}</figcaption></figure> }));
jest.mock("../BalanceHistory", () => ({ BalanceHistory: () => <figure aria-label="Balance over time" /> }));

const noop = () => {};

/** Every screen with realistic data: a year of statements (one late), and a plan in a plan account. */
function screens(): [string, ReactElement][] {
  const late = statementScenario("late");
  const entry = cardEntry({ ...late.card, creditLimitMinor: 5000000 }, late.workspace, late.snapshot, { today: "2026-10-15", signedBalanceMinor: -123000 });
  const latest = [...late.workspace.statements].sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
  const plan = laptopPlanScenario();
  const planEntry = cardEntry(plan.card(), plan.workspace(), plan.snapshot, { today: plan.today, signedBalanceMinor: plan.signedBalanceMinor });
  return [
    ["All cards", <PortfolioScreen key="p" entries={[entry, planEntry]} workspace={late.workspace} sort="due" onSort={noop} focusCardId={null} onOpen={noop} />],
    ["Overview", <OverviewScreen key="o" budget="b" entry={entry} workspace={late.workspace} onStatement={noop} onEnter={noop} onReview={noop}
      onActivityCurrent={noop} onPlans={noop} onPayment={noop} />],
    ["Statements with panel", <StatementsScreen key="s" entry={entry} workspace={late.workspace} eligible filter="all" onFilter={noop} panelId={latest.id}
      onPanel={noop} onEnter={noop} onEdit={noop} onReview={noop} onAction={noop} onPayment={noop} />],
    ["Payments", <PaymentsScreen key="pa" entry={entry} accounts={[]} filter={null} onFilter={noop} panelId={null} onPanel={noop} onStatement={noop} />],
    ["Activity", <ActivityScreen key="a" budget="b" entry={planEntry} workspace={plan.workspace()} snapshot={plan.snapshot} available statementFilter={null}
      planFilter={null} typeFilter={null} onFilters={noop} onMappings={noop} onMakePlan={noop} onOpenPlan={noop} />],
    ["Plans", <PlansScreen key="pl" budget="b" entry={planEntry} workspace={plan.workspace()} canEdit planId={null} onOpenPlan={noop}
      onAdd={noop} onEdit={noop} onActivity={noop} />],
    ["Plan view", <PlansScreen key="pv" budget="b" entry={planEntry} workspace={plan.workspace()} canEdit planId={plan.workspace().plans[0].id}
      onOpenPlan={noop} onAdd={noop} onEdit={noop} onActivity={noop} />],
    ["Insights", <InsightsScreen key="i" entry={entry} workspace={late.workspace} onStatement={noop} onSettings={noop} />],
    ["Statement review", <StatementReview key="r" budget="b" statement={latest} entry={entry} workspace={late.workspace} snapshot={late.snapshot} available onClose={noop} />],
  ];
}

it.each(screens())("uses only the current vocabulary on %s (§9.3)", (_, element) => {
  const { container } = render(element);
  const text = `${container.textContent} ${[...container.querySelectorAll("[aria-label], [title]")]
    .map((node) => `${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("title") ?? ""}`).join(" ")}`;
  expect(RETIRED_LABELS.filter((pattern) => pattern.test(text)).map(String)).toEqual([]);
});

it.each(screens())("has no axe violations on %s", async (_, element) => {
  const { container } = render(element);
  expect(await axeViolations(container)).toEqual([]);
});

const SECTIONS: GuideSection[] = ["start", "monthly", "statements", "bills", "types", "plans", "figures", "keyboard", "glossary"];

it.each(SECTIONS)("keeps the guide's %s section accessible and in the current vocabulary", async (section) => {
  render(<CreditCardGuide section={section} onSection={noop} onClose={noop} />);
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  const text = `${dialog.textContent} ${[...dialog.querySelectorAll("[aria-label]")].map((node) => node.getAttribute("aria-label")).join(" ")}`;
  expect(RETIRED_LABELS.filter((pattern) => pattern.test(text)).map(String)).toEqual([]);
  expect(text).not.toMatch(/\u2014/);
  expect(await axeViolations(dialog)).toEqual([]);
});
