import { apiRequest } from "@/lib/api/client";
import { createFakeActual } from "@/lib/assets-debt/testing/fakeActual";
import { HARNESS_MODES, transportFor } from "@/lib/assets-debt/testing/transportHarness";
import { TransactionChangedError, TransactionStructureRefusedError, type TransactionPreflight } from "./transactionStructure";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;

const ACCOUNTS = [
  { id: "checking", name: "Checking" },
  { id: "mortgage", name: "Mortgage", offbudget: true },
];

function pre(overrides: Partial<TransactionPreflight> & Pick<TransactionPreflight, "id" | "accountId" | "date" | "amount">): TransactionPreflight {
  return { payeeId: null, categoryId: null, notes: null, reconciled: false, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0, ...overrides };
}

describe.each(HARNESS_MODES)("transaction structure operations (%s)", (mode) => {
  function setup() {
    const fake = createFakeActual({ accounts: ACCOUNTS, payees: [{ id: "p-lender", name: "Home Lender" }] });
    return { fake, t: transportFor(mode, fake, mockApiRequest) };
  }
  const children = (fake: ReturnType<typeof createFakeActual>) => [
    { amount: -700000, payeeId: fake.transferPayeeId("mortgage"), categoryId: "cat-loan", notes: "Principal" },
    { amount: -130000, payeeId: null, categoryId: "cat-int", notes: "Interest" },
  ];

  it("T121/T122: restructures an unchanged row; the transfer child's counterpart lands in the liability", async () => {
    const { fake, t } = setup();
    const id = fake.seed({ account: "checking", date: "2026-03-01", amount: -830000, payee: "p-lender" });
    const result = await t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: id, expected: pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender" }), children: children(fake) });
    expect(result.children.map((c) => c.amount)).toEqual([-700000, -130000]);
    expect(result.children[0].transferId).not.toBeNull();
    expect(fake.accountRows("mortgage")).toEqual([expect.objectContaining({ amount: 700000, category: null })]);
  });

  it("refuses, writing nothing, when Actual changed since the preview", async () => {
    const { fake, t } = setup();
    const id = fake.seed({ account: "checking", date: "2026-03-01", amount: -830000, payee: "p-lender" });
    fake.editInActual(id, { notes: "edited by the user" });
    const writes = fake.writes().length;
    await expect(t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: id, expected: pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender" }), children: children(fake) }))
      .rejects.toBeInstanceOf(TransactionChangedError);
    expect(fake.writes().length).toBe(writes);
  });

  it("never restructures a reconciled row, an existing split, or children that do not sum to the parent", async () => {
    const { fake, t } = setup();
    const rec = fake.seed({ account: "checking", date: "2026-03-01", amount: -830000, payee: "p-lender", reconciled: true });
    await expect(t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: rec, expected: pre({ id: rec, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender", reconciled: true }), children: children(fake) }))
      .rejects.toBeInstanceOf(TransactionStructureRefusedError);
    const plain = fake.seed({ account: "checking", date: "2026-03-02", amount: -830001, payee: "p-lender" });
    await expect(t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: plain, expected: pre({ id: plain, accountId: "checking", date: "2026-03-02", amount: -830001, payeeId: "p-lender" }), children: children(fake) }))
      .rejects.toThrow(/do not sum/);
    expect(fake.writes()).toEqual([]);
  });

  it("T124: verifyRestructure reports not-applied, applied-exact and mismatch, and never writes", async () => {
    const { fake, t } = setup();
    const id = fake.seed({ account: "checking", date: "2026-03-01", amount: -830000, payee: "p-lender" });
    const expected = { parentAmount: -830000, children: [
      { amount: -700000, categoryId: "cat-loan", payeeId: null, notes: "Principal", transferAccountId: "mortgage" },
      { amount: -130000, categoryId: "cat-int", payeeId: null, notes: "Interest", transferAccountId: null },
    ] };
    const verify = () => t.verifyRestructure!({ accountId: "checking", transactionId: id, date: "2026-03-01", expected, transferPayeeByAccount: { mortgage: fake.transferPayeeId("mortgage") } });
    expect((await verify()).result).toBe("not-applied");
    await t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: id, expected: pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender" }), children: children(fake) });
    const writes = fake.writes().length;
    expect((await verify()).result).toBe("applied-exact");
    const interest = fake.rows().find((r) => r.notes === "Interest")!;
    fake.editInActual(interest.id, { amount: -130000, category: "cat-other", payee: null, notes: "Interest" });
    expect((await verify()).result).toBe("mismatch");
    expect(fake.writes().length).toBe(writes + 1); // only the edit above
  });

  function linkPair(fake: ReturnType<typeof createFakeActual>, lenderAmount = 700000, lenderExtra: Record<string, unknown> = {}) {
    const child = `child-${Math.random().toString(36).slice(2)}`;
    fake.seed({ account: "checking", date: "2026-03-05", amount: -830000, payee: "p-lender", subtransactions: [
      { id: child, amount: -700000, category: "cat-loan", notes: "Principal" },
      { amount: -130000, category: "cat-int", notes: "Interest" },
    ] });
    const parent = fake.rows().find((r) => r.id === fake.row(child)!.parent_id)!.id;
    const lender = fake.seed({ account: "mortgage", date: "2026-03-05", amount: lenderAmount, payee: "p-lender", notes: "lender import", imported_id: "lender:1", imported_payee: "LENDER", cleared: true, ...lenderExtra });
    return {
      child, lender,
      input: {
        source: pre({ id: child, accountId: "checking", date: "2026-03-05", amount: -700000, categoryId: "cat-loan", notes: "Principal", isChild: true, parentId: parent }),
        counterpart: pre({ id: lender, accountId: "mortgage", date: "2026-03-05", amount: lenderAmount, payeeId: "p-lender", notes: "lender import", reconciled: lenderExtra.reconciled === true }),
        transferPayeeId: fake.transferPayeeId("mortgage"),
      },
    };
  }

  it("T123: the two-call link reuses the lender row, inserts nothing and keeps its imported fields", async () => {
    const { fake, t } = setup();
    const { child, lender, input } = linkPair(fake);
    const before = fake.rows().length;
    const result = await t.linkTransferCounterpart!(input);
    expect(result).toMatchObject({ sourceTransferId: lender, counterpartTransferId: child, counterpartAmount: 700000 });
    expect(fake.rows().length).toBe(before);
    expect(fake.row(lender)).toMatchObject({ imported_id: "lender:1", imported_payee: "LENDER", cleared: true, date: "2026-03-05" });
  });

  it("T123: refuses a mismatched amount or a reconciled lender row before writing", async () => {
    const { fake, t } = setup();
    const mismatch = linkPair(fake, 700001);
    await expect(t.linkTransferCounterpart!(mismatch.input)).rejects.toThrow(/exactly/);
    const reconciled = linkPair(fake, 700000, { reconciled: true });
    await expect(t.linkTransferCounterpart!(reconciled.input)).rejects.toThrow(/reconciled/);
    expect(fake.writes()).toEqual([]);
  });

  it("T131: a crash between call 1 and 2 is detected read-only and completed only by completeTransferLink", async () => {
    const { fake, t } = setup();
    const { child, lender, input } = linkPair(fake);
    fake.crashOn({ op: "update", phase: "after-write" });
    await expect(t.linkTransferCounterpart!(input)).rejects.toThrow(/Injected crash/);
    const writes = fake.writes().length;
    expect(await t.inspectTransferLink!(input)).toEqual({ state: "half-linked", strayCounterpartIds: [] });
    expect(fake.writes().length).toBe(writes);
    const before = fake.rows().length;
    expect(await t.completeTransferLink!(input)).toMatchObject({ sourceTransferId: lender, counterpartTransferId: child });
    expect(fake.rows().length).toBe(before);
  });

  it("T131: an edit to the half-linked lender row creates a stray counterpart, and completion refuses", async () => {
    const { fake, t } = setup();
    const { lender, input } = linkPair(fake);
    fake.crashOn({ op: "update", phase: "after-write" });
    await expect(t.linkTransferCounterpart!(input)).rejects.toThrow();
    fake.editInActual(lender, { notes: "edited in Actual" });
    const state = await t.inspectTransferLink!(input);
    expect(state.state === "half-linked" ? state.strayCounterpartIds.length : state.state).toBeTruthy();
    await expect(t.completeTransferLink!(input)).rejects.toBeInstanceOf(TransactionStructureRefusedError);
  });

  it("reports that reads carry transfer ids", async () => {
    const { fake, t } = setup();
    fake.seed({ account: "checking", date: "2026-03-01", amount: -1 });
    expect(await t.canVerifyTransferLinks!({ accountId: "checking", sinceDate: "2026-01-01" })).toBe(true);
  });

  // P1.6 T276, T277, T279: the refusals that keep Undo and conversion from destroying anything.
  const state = (p: TransactionPreflight, extra: Partial<{ cleared: boolean; importedId: string | null; importedPayee: string | null }> = {}) => ({ cleared: false, importedId: null, importedPayee: null, ...p, ...extra });

  it("T279: a transfer is restructured only with its untouched Actual-made counterpart named", async () => {
    const { fake, t } = setup();
    const id = fake.seed({ account: "checking", date: "2026-03-01", amount: -830000, payee: "p-lender" });
    fake.editInActual(id, { payee: fake.transferPayeeId("mortgage") });
    const cp = fake.row(id)!.transfer_id as string;
    const expected = pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: fake.transferPayeeId("mortgage"), transferId: cp });
    const counterpart = state(pre({ id: cp, accountId: "mortgage", date: "2026-03-01", amount: 830000, payeeId: fake.transferPayeeId("checking"), transferId: id }));
    const writes = fake.writes().length;
    await expect(t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: id, expected, children: children(fake) })).rejects.toBeInstanceOf(TransactionStructureRefusedError);
    fake.editInActual(cp, { imported_payee: "LENDER" });
    await expect(t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: id, expected, children: children(fake), replaceCounterpart: { expected: { ...counterpart, importedPayee: "LENDER" }, sourceAccountTransferPayeeId: fake.transferPayeeId("checking") } }))
      .rejects.toThrow(/it was imported/);
    expect(fake.writes().length).toBe(writes + 1); // only the edit above
    fake.editInActual(cp, { imported_payee: null });
    const result = await t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: id, expected, children: children(fake), replaceCounterpart: { expected: counterpart, sourceAccountTransferPayeeId: fake.transferPayeeId("checking") } });
    expect(result.children).toHaveLength(2);
    expect(fake.row(cp)).toBeUndefined();
    if (mode === "direct") {
      expect(result.settledVerification).toMatchObject({ accountId: "mortgage", date: "2026-03-01" });
      expect(result.settledVerification!.rows).toEqual([
        expect.objectContaining({ transferId: result.children[0].id, amount: 700000 }),
      ]);
      expect(result.settledVerification!.rows.some((row) => row.id === cp)).toBe(false);
    } else {
      expect(result.settledVerification).toBeUndefined();
    }
  });

  it("a cleared loan-side row is marked cleared again after the split, or left to the caller to mark in a batch", async () => {
    for (const defer of [false, true]) {
      const { fake, t } = setup();
      const id = fake.seed({ account: "checking", date: "2026-03-01", amount: -830000, payee: "p-lender" });
      fake.editInActual(id, { payee: fake.transferPayeeId("mortgage") });
      const cp = fake.row(id)!.transfer_id as string;
      fake.editInActual(cp, { cleared: true });
      const expected = pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: fake.transferPayeeId("mortgage"), transferId: cp });
      const counterpart = state(pre({ id: cp, accountId: "mortgage", date: "2026-03-01", amount: 830000, payeeId: fake.transferPayeeId("checking"), transferId: id }));
      const result = await t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: id, expected, children: children(fake), deferClearing: defer, replaceCounterpart: { expected: { ...counterpart, cleared: true }, sourceAccountTransferPayeeId: fake.transferPayeeId("checking") } });
      const made = result.children.find((c) => c.transferId)!.transferId!;
      expect(fake.row(made)?.cleared === true).toBe(!defer);
      expect(result.clearLater ?? null).toBe(defer ? made : null);
    }
  });

  it.each(["reordered", "replaced"])("restoreSplit handles %s child identities safely", async (scenario) => {
    const { fake, t } = setup();
    const id = fake.seed({ account: "checking", date: "2026-03-01", amount: -830000, payee: "p-lender" });
    await t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: id, expected: pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender" }), children: children(fake) });
    const kids = fake.rows().filter((r) => r.parent_id === id);
    const childPre = kids.map((k) => pre({ id: k.id, accountId: "checking", date: "2026-03-01", amount: k.amount, payeeId: (k.payee as string) ?? null, categoryId: (k.category as string) ?? null, notes: (k.notes as string) ?? null, transferId: (k.transfer_id as string) ?? null, isChild: true, parentId: id })).reverse();
    if (scenario === "replaced") childPre[0] = { ...childPre[0], id: "different-child" };
    const parent = pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender", isParent: true, childCount: 2 });
    const restoreTo = state(pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender" }));
    const writes = fake.writes().length;
    const restore = t.restoreSplit!({ parent, children: childPre, restoreTo, counterpartAccountIds: ["mortgage"] });
    if (scenario === "replaced") {
      await expect(restore).rejects.toBeInstanceOf(TransactionChangedError);
      expect(fake.writes().length).toBe(writes);
    } else {
      await expect(restore).resolves.toMatchObject({ parentId: id });
      expect(fake.rows().filter((r) => r.parent_id === id)).toEqual([]);
      expect(fake.accountRows("mortgage")).toEqual([]);
      expect(fake.row(id)).toMatchObject({ amount: -830000, payee: "p-lender" });
    }
  });

  it("T276: restoreSplit and unlinkTransfer refuse, writing nothing, a changed or reconciled row", async () => {
    const { fake, t } = setup();
    const id = fake.seed({ account: "checking", date: "2026-03-01", amount: -830000, payee: "p-lender" });
    await t.restructureTransactionAsSplit!({ accountId: "checking", transactionId: id, expected: pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender" }), children: children(fake) });
    const kids = fake.rows().filter((r) => r.parent_id === id);
    const parent = pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender", isParent: true, childCount: 2 });
    const childPre = kids.map((k) => pre({ id: k.id, accountId: "checking", date: "2026-03-01", amount: k.amount, payeeId: (k.payee as string) ?? null, categoryId: (k.category as string) ?? null, notes: (k.notes as string) ?? null, transferId: (k.transfer_id as string) ?? null, isChild: true, parentId: id }));
    const restoreTo = state(pre({ id, accountId: "checking", date: "2026-03-01", amount: -830000, payeeId: "p-lender" }));
    fake.editInActual(kids[1].id, { amount: -130000, category: "cat-int", payee: null, notes: "edited" });
    const writes = fake.writes().length;
    await expect(t.restoreSplit!({ parent, children: childPre, restoreTo, counterpartAccountIds: ["mortgage"] })).rejects.toBeInstanceOf(TransactionChangedError);
    expect(fake.writes().length).toBe(writes);

    const source = fake.seed({ account: "checking", date: "2026-04-01", amount: -500, payee: "p-lender" });
    const lender = fake.seed({ account: "mortgage", date: "2026-04-01", amount: 500, payee: "p-lender", reconciled: true });
    const before = fake.writes().length;
    await expect(t.unlinkTransfer!({
      source: pre({ id: source, accountId: "checking", date: "2026-04-01", amount: -500, payeeId: "p-lender" }),
      counterpart: pre({ id: lender, accountId: "mortgage", date: "2026-04-01", amount: 500, payeeId: "p-lender", reconciled: true }),
      sourceRestore: state(pre({ id: source, accountId: "checking", date: "2026-04-01", amount: -500 })),
      counterpartRestore: state(pre({ id: lender, accountId: "mortgage", date: "2026-04-01", amount: 500 })),
    })).rejects.toBeInstanceOf(TransactionStructureRefusedError);
    expect(fake.writes().length).toBe(before);
  });

  it("T277: convertToTransfer refuses a reconciled, split or already-transfer row; revert refuses a reconciled counterpart", async () => {
    const { fake, t } = setup();
    const reconciled = fake.seed({ account: "checking", date: "2026-03-01", amount: -500, payee: "p-lender", reconciled: true });
    const writes = fake.writes().length;
    await expect(t.convertToTransfer!({ expected: pre({ id: reconciled, accountId: "checking", date: "2026-03-01", amount: -500, payeeId: "p-lender", reconciled: true }), transferPayeeId: fake.transferPayeeId("mortgage"), counterpartAccountId: "mortgage" }))
      .rejects.toBeInstanceOf(TransactionStructureRefusedError);
    expect(fake.writes().length).toBe(writes);
    const id = fake.seed({ account: "checking", date: "2026-03-02", amount: -500, payee: "p-lender", notes: "n" });
    const converted = await t.convertToTransfer!({ expected: pre({ id, accountId: "checking", date: "2026-03-02", amount: -500, payeeId: "p-lender", notes: "n" }), transferPayeeId: fake.transferPayeeId("mortgage"), counterpartAccountId: "mortgage" });
    expect(converted.counterpart).toMatchObject({ accountId: "mortgage", amount: 500, notes: "n", cleared: false, transferId: id });
    fake.editInActual(converted.transferId!, { reconciled: true });
    const after = fake.writes().length;
    await expect(t.revertTransferConversion!({
      converted: pre({ id, accountId: "checking", date: "2026-03-02", amount: -500, payeeId: fake.transferPayeeId("mortgage"), notes: "n", transferId: converted.transferId }),
      counterpart: pre({ id: converted.transferId!, accountId: "mortgage", date: "2026-03-02", amount: 500, payeeId: fake.transferPayeeId("checking"), notes: "n", reconciled: true, transferId: id }),
      restoreTo: state(pre({ id, accountId: "checking", date: "2026-03-02", amount: -500, payeeId: "p-lender", notes: "n" })),
    })).rejects.toBeInstanceOf(TransactionStructureRefusedError);
    expect(fake.writes().length).toBe(after);
  });
});
