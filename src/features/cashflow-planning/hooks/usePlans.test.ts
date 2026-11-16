/** @jest-environment jsdom */
import { createPlanDocument, createRow, setCells } from "@/lib/cashflow-planning/document";
import type { PlanRecord } from "@/lib/cashflow-planning/types";
import { useCashflowStore } from "../store";
import { savePlan } from "../api";
import { createAutosave } from "./usePlans";

jest.mock("../api", () => ({
  ...jest.requireActual("../api"),
  savePlan: jest.fn(),
  listPlans: jest.fn(),
  deletePlan: jest.fn(),
}));
jest.mock("@/store/connection", () => ({ selectActiveInstance: () => null, useConnectionStore: () => null }));

const mockSave = savePlan as jest.MockedFunction<typeof savePlan>;
const record = (revision: number, document: PlanRecord["document"]): PlanRecord => ({ id: "p1", budgetSyncId: "b1", name: "Plan", revision, createdAt: "t", updatedAt: "t", document });

describe("autosave when the page is left", () => {
  it("sends an edit made while a save was in flight, even after dispose", async () => {
    const base = { ...createPlanDocument({ name: "Plan", startMonth: "2026-01", years: 1 }), rows: [createRow({ name: "Salary", section: "income" })] };
    useCashflowStore.setState({ budgetSyncId: null, sessions: {}, order: [], activeId: null, unreadable: [] });
    useCashflowStore.getState().hydrate("b1", [record(1, base)]);

    let finishFirst!: (r: PlanRecord) => void;
    mockSave.mockImplementationOnce(() => new Promise<PlanRecord>((resolve) => { finishFirst = resolve; }));
    mockSave.mockImplementation(async (input) => record(3, input.document));

    const autosave = createAutosave("b1");
    const { edit } = useCashflowStore.getState();
    edit("p1", (d) => setCells(d, [{ rowId: d.rows[0].id, month: "2026-02", amount: 100 }]));
    autosave.save("p1"); // first save goes out
    const first = useCashflowStore.getState().sessions.p1.doc;
    edit("p1", (d) => setCells(d, [{ rowId: d.rows[0].id, month: "2026-03", amount: 200 }])); // edited while it is in flight
    const second = useCashflowStore.getState().sessions.p1.doc;

    autosave.dispose(); // the user leaves: the in-flight save blocks this flush
    expect(mockSave).toHaveBeenCalledTimes(1);

    finishFirst(record(2, first));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockSave.mock.calls[1][0]).toMatchObject({ baseRevision: 2, document: second });
    expect(useCashflowStore.getState().sessions.p1).toMatchObject({ status: "saved", revision: 3 });
  });
});

describe("leaving the page while a save is on its way", () => {
  it("asks first even when the edit was undone back to the saved plan", async () => {
    const base = { ...createPlanDocument({ name: "Plan", startMonth: "2026-01", years: 1 }), rows: [createRow({ name: "Salary", section: "income" })] };
    useCashflowStore.setState({ budgetSyncId: null, sessions: {}, order: [], activeId: null, unreadable: [] });
    useCashflowStore.getState().hydrate("b1", [record(1, base)]);
    let finish!: (r: PlanRecord) => void;
    mockSave.mockImplementationOnce(() => new Promise<PlanRecord>((resolve) => { finish = resolve; }));
    mockSave.mockImplementation(async (input) => record(3, input.document));

    const autosave = createAutosave("b1");
    const { edit } = useCashflowStore.getState();
    const saved = useCashflowStore.getState().sessions.p1.saved;
    edit("p1", (d) => setCells(d, [{ rowId: d.rows[0].id, month: "2026-02", amount: 100 }]));
    autosave.save("p1"); // the edit is on its way
    const sent = useCashflowStore.getState().sessions.p1.doc;
    edit("p1", () => saved); // undone: nothing differs from the saved plan, yet the edit will land

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    finish(record(2, sent));
    await new Promise((resolve) => setTimeout(resolve, 0));
    autosave.dispose();
  });
});

describe("a page left and opened again while a save is on its way", () => {
  it("does not send the same plan a second time until the first save is done", async () => {
    const base = { ...createPlanDocument({ name: "Plan", startMonth: "2026-01", years: 1 }), rows: [createRow({ name: "Salary", section: "income" })] };
    useCashflowStore.setState({ budgetSyncId: null, sessions: {}, order: [], activeId: null, unreadable: [] });
    useCashflowStore.getState().hydrate("b1", [record(1, base)]);
    mockSave.mockReset();
    let finish!: (r: PlanRecord) => void;
    mockSave.mockImplementationOnce(() => new Promise<PlanRecord>((resolve) => { finish = resolve; }));

    const first = createAutosave("b1");
    useCashflowStore.getState().edit("p1", (d) => setCells(d, [{ rowId: d.rows[0].id, month: "2026-02", amount: 100 }]));
    first.save("p1");
    const sent = useCashflowStore.getState().sessions.p1.doc;
    first.dispose();

    // The page is opened again: its controller must wait for the save already on its way.
    const second = createAutosave("b1");
    second.save("p1");
    expect(mockSave).toHaveBeenCalledTimes(1);

    finish(record(2, sent));
    await new Promise((resolve) => setTimeout(resolve, 0));
    second.dispose();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(useCashflowStore.getState().sessions.p1).toMatchObject({ status: "saved", revision: 2 });
  });
});
