import { hasPlanTag, unassignedPlanEntries, trackedCardDebt, trackedDebtPoints, trackingBalance, trackingTransferMatches } from "./planTracking";
import { transferPlanScenario } from "./planTracking.fixture";
import { normalizeActivity, activityKind, paymentEvidence } from "./activity";
import { repaymentLedger, settlements } from "./repayments";
import { createCreditCardStore } from "./memory";
import { planHealth } from "./plans";
import { planDebtBreakdown } from "./planReporting";

it("keeps conversion and instalment transfers out of cash repayments, and apportions a shared liability once", () => {
  const { cards, sources, workspace } = transferPlanScenario();
  const [a, b] = sources;
  const conversion = a.rows.find((row) => row.id === "conversion-a")!;
  expect(activityKind(conversion, cards[0], workspace, a)).toBe("plan-conversion");
  expect(paymentEvidence(conversion, a, workspace)).toBe("not-payment");
  expect(repaymentLedger(cards[0], workspace, a).confirmedMinor).toBe(1505000);
  expect(repaymentLedger(cards[0], workspace, a).issues.filter((issue) => issue.includes("borrowing"))).toEqual([]);
  expect(settlements(cards[0], workspace, a, "2026-10-16")[1].confirmedPaidMinor).toBe(505000);
  expect(trackedCardDebt(cards[0], workspace, a, -450000, "2026-10-16")).toMatchObject({ known: true, trackingMinor: 1000000, debtMinor: 1450000, confirmedDebtMinor: 1550000, problems: [] });
  expect(trackedCardDebt(cards[1], workspace, b, -200000, "2026-10-16")).toMatchObject({ trackingMinor: 400000, debtMinor: 600000 });
  expect(planDebtBreakdown(cards[0], workspace, a, -450000, "2026-10-16")).toMatchObject({ known: true, planMinor: 1500000, otherMinor: 50000, pendingCreditMinor: 100000, differenceMinor: 0 });
});

it("preserves total debt when principal is billed, reduces it for cash, and retains missed amounts", () => {
  const { cards, workspace, sources } = transferPlanScenario();
  const points = trackedDebtPoints(cards[0], workspace, sources[0], -450000, ["2026-06-10", "2026-07-08", "2026-08-02", "2026-09-02", "2026-10-02", "2026-10-16"]);
  expect(points.map((point) => point.value)).toEqual([3000000, 3005000, 2500000, 2300000, 1500000, 1450000]);
  const later = { ...sources[0], to: "2027-03-01", trackingAccounts: sources[0].trackingAccounts!.map((account) => ({ ...account, to: "2027-03-01" })) };
  expect(trackedCardDebt(cards[0], workspace, later, -450000, "2027-03-01").debtMinor).toBe(1450000);
  expect(planHealth(workspace.plans![0], workspace, later, "2027-03-01").reasons.join(" ")).toContain("Check expected posting");
});

it("starts mid-plan from confirmed opening principal without inventing earlier payments or doubling history", () => {
  const { cards, sources, plans, workspace } = transferPlanScenario();
  const plan = { ...plans[0], transactionId: "instalment-a-8", fingerprint: "instalment-a-8", tracking: { ...plans[0].tracking!, opening: { date: "2026-08-08", principalMinor: 2000000 } } };
  const snapshot = { ...sources[0], from: "2026-08-08", rows: sources[0].rows.filter((row) => row.date >= "2026-08-08") };
  expect(trackingBalance(plan, snapshot, "2026-10-16")?.signedMinor).toBe(-1000000);
  expect(trackingBalance(plan, snapshot, "2026-07-01")).toBeNull();
  const store = createCreditCardStore();
  store.setState({ workspaces: { test: { ...workspace, plans: plans.slice(1), planLinks: workspace.planLinks!.filter((link) => link.planId !== "a") } } });
  store.getState().savePlan("test", cards[0].id, cards[0].revision, snapshot, plan, []);
  expect(store.getState().workspaces.test.plans?.find((entry) => entry.id === "a")?.tracking?.opening?.principalMinor).toBe(2000000);
  expect(trackedDebtPoints(cards[0], { ...workspace, plans: [plan, plans[1]] }, snapshot, -450000, ["2026-07-08"])[0].value).toBeNull();
});

it("allows a lump-sum principal release and cash payoff without pretending a release alone paid the debt", () => {
  const { cards, plans, sources, workspace } = transferPlanScenario();
  const source = sources[0];
  const original = source.rows.find((row) => row.id === "instalment-a-10")!;
  const release = { ...original, id: "early", fingerprint: "early", date: "2026-10-16", amountMinor: -1000000, transferId: "early-peer" };
  const peer = { ...release, id: "early-peer", accountId: "tracking", amountMinor: 1000000, transferId: "early" };
  const account = source.trackingAccounts![0];
  const snapshot = { ...source, rows: [...source.rows, release], counterparts: [...source.counterparts, peer], trackingAccounts: [{ ...account, rows: [...account.rows, peer], counterparts: [...(account.counterparts ?? []), release], signedBalanceMinor: -400000 }] };
  const link = { planId: "a", transactionId: "early", fingerprint: "early", role: "principal-release" as const, instalment: null };
  const store = createCreditCardStore(); store.setState({ workspaces: { test: workspace } });
  store.getState().savePlan("test", "a", 1, snapshot, plans[0], [...workspace.planLinks!.filter((entry) => entry.planId === "a"), link]);
  expect(trackedCardDebt(cards[0], workspace, snapshot, -1450000, "2026-10-16").debtMinor).toBe(1450000);
  const cash = { ...source.rows.find((row) => row.id === "cash-a-10")!, id: "payoff", date: "2026-10-16", amountMinor: 1450000 };
  const paid = { ...snapshot, rows: [...snapshot.rows, cash] };
  expect(trackedCardDebt(cards[0], workspace, paid, 0, "2026-10-16").debtMinor).toBe(0);
  // Merely setting a status cannot erase debt in either account.
  const completed = { ...workspace, plans: [{ ...plans[0], status: "completed" as const }, plans[1]] };
  expect(trackedCardDebt(cards[0], completed, source, -450000, "2026-10-16").debtMinor).toBe(1450000);
  expect(planHealth(completed.plans[0], completed, source, "2026-10-16").reasons.join(" ")).toContain("Principal remains");
});

it("fails closed on conflicting tags, missing reads and changed transfer evidence, and exposes unassigned shared balances", () => {
  const { cards, sources, plans, workspace } = transferPlanScenario();
  const source = sources[0], row = source.rows.find((entry) => entry.id === "conversion-a")!;
  const taggedCash = { ...source, rows: source.rows.map((row) => row.id === "cash-a-8" ? { ...row, notes: "#plan-a Cash repayment" } : row) };
  expect(trackedCardDebt(cards[0], workspace, taggedCash, -450000, "2026-10-16").known).toBe(true);
  expect(hasPlanTag("#plan-ab #plan-a2", "#plan-a")).toBe(false);
  expect(trackingTransferMatches({ ...row, notes: "#plan-ab" }, plans[0], source)).toBe(true);
  expect(trackedCardDebt(cards[0], workspace, { ...source, trackingAccounts: [] }, -450000, "2026-10-16").known).toBe(false);
  const duplicate = { ...workspace, plans: [plans[0], { ...plans[1], tracking: plans[0].tracking }] };
  expect(trackedCardDebt(cards[0], duplicate, source, -450000, "2026-10-16").known).toBe(false);
  const store = createCreditCardStore(); store.setState({ workspaces: { test: workspace } });
  expect(() => store.getState().savePlan("test", "a", 1, source, { ...plans[0], tracking: plans[1].tracking }, [])).toThrow("unique within");
  expect(store.getState().workspaces.test).toBe(workspace);
  const wrongCard = { ...source, trackingAccounts: source.trackingAccounts!.map((account) => ({ ...account, counterparts: account.counterparts?.map((entry) => entry.id === "conversion-a" ? { ...entry, accountId: "card-b" } : entry) })) };
  expect(trackedCardDebt(cards[0], workspace, wrongCard, -450000, "2026-10-16").known).toBe(false);
  const unassigned = { ...source, trackingAccounts: source.trackingAccounts!.map((account) => ({ ...account, signedBalanceMinor: -1500000 })) };
  expect(trackedCardDebt(cards[0], workspace, unassigned, -450000, "2026-10-16")).toMatchObject({ known: true, problems: [], sharedAccounts: [{ differenceMinor: 100000 }] });
});


it("splits a billed instalment into principal and a separate fee expense, counting its parent once", () => {
  const { cards, plans, sources, workspace } = transferPlanScenario();
  const card = { ...cards[0], feeCategoryId: "fees" };
  const parent = {
    id: "bill", accountId: card.accountId, date: "2026-10-16", amount: -101500, payeeId: null, payeeName: "Monthly bill", categoryId: null, categoryName: null,
    notes: "#plan-a", cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: true, isChild: false, parentId: null,
    splitLines: [
      { id: "principal-child", amount: -100000, payeeId: null, payeeName: "Plan account", categoryId: "principal", categoryName: "Principal", notes: "#plan-a", cleared: true, transferId: "principal-peer" },
      { id: "fee-child", amount: -1500, payeeId: null, payeeName: "Issuer", categoryId: "fees", categoryName: "Fees", notes: "#plan-a", cleared: true, transferId: null },
    ],
  };
  const normalized = normalizeActivity([parent]);
  expect(normalized.issues).toEqual([]);
  expect(normalized.rows.map((row) => row.amountMinor).sort((a, b) => a - b)).toEqual([-100000, -1500]);
  const principal = normalized.rows.find((row) => row.id === "principal-child")!, fee = normalized.rows.find((row) => row.id === "fee-child")!;
  const peer = { ...principal, id: "principal-peer", transferId: principal.id, accountId: "tracking", amountMinor: 100000, parentId: null, fingerprint: "principal-peer" };
  const source = sources[0], account = source.trackingAccounts![0];
  const snapshot = { ...source, rows: [...source.rows, ...normalized.rows], counterparts: [...source.counterparts, peer], trackingAccounts: [{ ...account, rows: [...account.rows, peer], counterparts: [...(account.counterparts ?? []), principal], signedBalanceMinor: -1300000 }] };
  const links = [...workspace.planLinks!, { planId: "a", transactionId: principal.id, fingerprint: principal.fingerprint, role: "instalment-billed" as const, instalment: 5 }, { planId: "a", transactionId: fee.id, fingerprint: fee.fingerprint, role: "plan-fee" as const, instalment: null }];
  const candidate = { ...workspace, cards: [card, cards[1]], planLinks: links };
  expect(trackedCardDebt(card, candidate, snapshot, -551500, "2026-10-16")).toMatchObject({ known: true, trackingMinor: 900000, debtMinor: 1451500 });
  expect(planDebtBreakdown(card, candidate, snapshot, -551500, "2026-10-16")).toMatchObject({ planMinor: 1500000, otherMinor: 51500, pendingCreditMinor: 100000, differenceMinor: 0 });
  const store = createCreditCardStore(); store.setState({ workspaces: { test: { ...workspace, cards: [card, cards[1]] } } });
  store.getState().savePlan("test", "a", 1, snapshot, plans[0], links.filter((link) => link.planId === "a"));
  expect(store.getState().workspaces.test.planLinks?.filter((link) => link.planId === "a")).toHaveLength(8);
  const rejected = createCreditCardStore(); rejected.setState({ workspaces: { test: { ...workspace, cards: [card, cards[1]] } } });
  expect(() => rejected.getState().savePlan("test", "a", 1, snapshot, plans[0], links.filter((link) => link.planId === "a").map((link) => link.transactionId === fee.id ? { ...link, role: "instalment-billed", instalment: 6 } : link))).toThrow("Financing costs");
  const badFee = { ...fee, transferId: "fee-peer" }, feePeer = { ...peer, id: "fee-peer", transferId: fee.id, amountMinor: 1500, fingerprint: "fee-peer" };
  const wrong = { ...snapshot, rows: snapshot.rows.map((row) => row.id === fee.id ? badFee : row), counterparts: [...snapshot.counterparts, feePeer], trackingAccounts: [{ ...snapshot.trackingAccounts[0], rows: [...snapshot.trackingAccounts[0].rows, feePeer], counterparts: [...snapshot.trackingAccounts[0].counterparts, badFee], signedBalanceMinor: -1298500 }] };
  expect(trackedCardDebt(card, candidate, wrong, -551500, "2026-10-16")).toMatchObject({ known: false });
  expect(planHealth(plans[0], candidate, wrong, "2026-10-16").reasons.join(" ")).toContain("fees and interest");
});

it.each(["cash-advance", "balance-transfer"] as const)("keeps %s origination distinct from conversion and cash repayment", (kind) => {
  const { cards, plans, sources, workspace } = transferPlanScenario();
  const source = sources[0], original = { ...source.rows.find((row) => row.id === "purchase-a")!, transferId: "borrowing-peer", fingerprint: "borrowing-source" };
  const peer = { ...original, id: "borrowing-peer", accountId: kind === "cash-advance" ? "funding" : "card-b", amountMinor: 3000000, transferId: original.id };
  const snapshot = { ...source, rows: source.rows.map((row) => row.id === original.id ? original : row), counterparts: [...source.counterparts, peer] };
  const plan = { ...plans[0], fingerprint: original.fingerprint };
  const candidate = { ...workspace, plans: [plan, plans[1]], classifications: [{ cardId: "a", transactionId: original.id, fingerprint: original.fingerprint, kind, reason: "Confirmed borrowing origination" }] };
  expect(activityKind(original, cards[0], candidate, snapshot)).toBe(kind);
  const store = createCreditCardStore(); store.setState({ workspaces: { test: candidate } });
  store.getState().savePlan("test", "a", 1, snapshot, plan, workspace.planLinks!.filter((link) => link.planId === "a"));
  expect(trackedCardDebt(cards[0], candidate, snapshot, -450000, "2026-10-16")).toMatchObject({ known: true, debtMinor: 1450000 });
  expect(repaymentLedger(cards[0], candidate, snapshot).confirmedMinor).toBe(1505000);
});


it("keeps each plan’s transfer validation scoped to its own tag when one card has several plans", () => {
  const { cards, plans, sources, workspace } = transferPlanScenario();
  const card = cards[0];
  const combine = (row: import("./activity").ActivityRow) => row.accountId === cards[1].accountId ? { ...row, accountId: card.accountId } : row;
  const snapshot = { ...sources[0], rows: sources.flatMap((source) => source.rows.map(combine)), trackingAccounts: sources[0].trackingAccounts!.map((account) => ({ ...account, counterparts: account.counterparts!.map(combine) })) };
  const candidate = { ...workspace, cards: [card], plans: plans.map((plan) => ({ ...plan, cardId: card.id })) };
  for (const plan of candidate.plans) expect(planHealth(plan, candidate, snapshot, "2026-10-16")).toMatchObject({ status: "Active", reasons: [] });
});

it("separates other cards’ shared principal from this card’s review queue and debt", () => {
  const { cards, plans, sources, workspace } = transferPlanScenario();
  const onlyA = { ...workspace, plans: [plans[0]], planLinks: workspace.planLinks?.filter((link) => link.planId === plans[0].id) };
  const debt = trackedCardDebt(cards[0], onlyA, sources[0], -450000, "2026-10-16");
  expect(debt).toMatchObject({ known: true, trackingMinor: 1000000, debtMinor: 1450000, problems: [], sharedAccounts: [{ differenceMinor: 400000, unlinkedCurrentCount: 0 }] });
  expect(unassignedPlanEntries(onlyA, sources[0], cards[0])).toEqual([]);
  const unlinked = { ...onlyA, plans: [{ ...plans[0], tracking: { ...plans[0].tracking!, tag: "" } }], planLinks: [] };
  const rows = unassignedPlanEntries(unlinked, sources[0], cards[0]);
  expect(rows).toHaveLength(5);
  expect(rows.every((row) => row.transferId?.includes("-a"))).toBe(true);
  const midway = { ...unlinked, plans: [{ ...unlinked.plans[0], tracking: { ...unlinked.plans[0].tracking, opening: { date: "2026-10-08", principalMinor: 1000000 } } }] };
  expect(unassignedPlanEntries(midway, sources[0], cards[0])).toEqual([]);
});

it("does not release ordinary-card credit for a pending repayment, even when it creates a temporary surplus", () => {
  const { cards, sources, workspace } = transferPlanScenario();
  const snapshot = { ...sources[0], rows: sources[0].rows.filter((row) => row.id === "pending").map((row) => ({ ...row, amountMinor: 20000 })) };
  const result = trackedCardDebt(cards[0], { ...workspace, plans: [], planLinks: [] }, snapshot, 10000, "2026-10-16");
  expect(result.tracked).toBe(false);
  expect(result.debtMinor).toBe(0);
  expect(result.capacitySignedMinor).toBe(-10000);
  expect(result.creditUsedMinor).toBe(10000);
});
