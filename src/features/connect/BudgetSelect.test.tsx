import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ConnectionInstance } from "@/store/connection";
import { BudgetSelect, useBudgetChoices, type BudgetOption } from "./BudgetSelect";

const connect = jest.fn();
let saved: { serverFingerprint: string; budgetSyncId: string; name: string; mode: "http-api" | "browser-api"; baseUrl: string; serverLabel: string }[] = [];
jest.mock("./useSavedBudgetConnector", () => ({
  useSavedBudgetConnector: () => ({ saved, locked: false, connecting: false, connect: (...args: unknown[]) => connect(...args), dialog: null }),
}));

const options: BudgetOption[] = [
  { value: "a", name: "Household", mode: "browser-api", baseUrl: "https://actual.example.com" },
  { value: "b", name: "Joint", mode: "http-api", baseUrl: "https://api.example.com", note: "not enrolled" },
  { value: "c", name: "Holiday", mode: "browser-api", baseUrl: "https://actual.example.com" },
];

describe("BudgetSelect", () => {
  it("groups budgets by server, with the host and mode on each group", () => {
    render(<BudgetSelect options={options} value="a" onValueChange={jest.fn()} aria-label="Budget" />);
    const groups = screen.getByLabelText("Budget").querySelectorAll("optgroup");
    expect([...groups].map((group) => group.label)).toEqual(["actual.example.com · Direct", "api.example.com · HTTP API"]);
    expect([...groups[0].querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Household", "Holiday"]);
    expect(screen.getByRole("option", { name: "Joint (not enrolled)" })).toBeInTheDocument();
  });

  it("reports the chosen value, and offers a placeholder", () => {
    const onValueChange = jest.fn();
    render(<BudgetSelect options={options} value="" placeholder="Source budget…" onValueChange={onValueChange} aria-label="Budget" />);
    expect(screen.getByRole("option", { name: "Source budget…" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "c" } });
    expect(onValueChange).toHaveBeenCalledWith("c");
  });

  it("says when there is nothing to choose", () => {
    render(<BudgetSelect options={[]} value="" onValueChange={jest.fn()} emptyLabel="No budget connections saved" aria-label="Budget" />);
    expect(screen.getByRole("option", { name: "No budget connections saved" })).toBeInTheDocument();
  });
});

describe("useBudgetChoices", () => {
  const household = { id: "c-1", label: "Household", mode: "browser-api", baseUrl: "https://actual.example.com", budgetSyncId: "b-1", serverPassword: "pw" } as ConnectionInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    saved = [{ serverFingerprint: "srv", budgetSyncId: "b-2", name: "Joint", mode: "http-api", baseUrl: "https://api.example.com", serverLabel: "" }];
  });

  it("offers connected budgets, then saved ones marked as saved", () => {
    const { result } = renderHook(() => useBudgetChoices({ connections: [household] }));
    expect(result.current.options.map((option) => [option.name, option.note])).toEqual([
      ["Household", undefined],
      ["Joint", "saved"],
    ]);
  });

  it("resolves a connected budget directly, and connects a saved one first", async () => {
    const joint = { ...household, id: "c-2", label: "Joint", budgetSyncId: "b-2" } as ConnectionInstance;
    connect.mockResolvedValue(joint);
    const { result } = renderHook(() => useBudgetChoices({ connections: [household] }));

    await expect(result.current.resolve("c-1")).resolves.toBe(household);
    const savedOption = result.current.options.find((option) => option.name === "Joint")!;
    await expect(result.current.resolve(savedOption.value)).resolves.toBe(joint);
    expect(connect).toHaveBeenCalledWith(saved[0]);
  });
});
