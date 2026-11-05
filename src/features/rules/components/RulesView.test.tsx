import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { useStagedStore } from "@/store/staged";
import { RulesView } from "./RulesView";

const replace = jest.fn();
const push = jest.fn();
let query = "";
let loading = false;

jest.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }), useSearchParams: () => new URLSearchParams(query) }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
// What the query read: the rules the staged store is expected to hold once it has been filled from it.
let readRules: { id: string }[] = [{ id: "r1" }, { id: "r2" }];
jest.mock("../hooks/useRules", () => ({ useRules: () => ({ data: loading ? undefined : readRules, isLoading: loading, isError: false, error: null, refetch: jest.fn() }) }));
jest.mock("@/components/layout/PageLayout", () => ({ PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock("./RulesTable", () => ({ RulesTable: ({ onMerge }: { onMerge: (ids: string[]) => void }) => <button onClick={() => onMerge(["r1", "r2"])}>merge from table</button> }));
// Every `open` the drawer was rendered with, in order, so the first one can be told from the one after a re-render.
const drawerOpens: boolean[] = [];
jest.mock("./RuleDrawer", () => ({ RuleDrawer: ({ open }: { open: boolean }) => { drawerOpens.push(open); return <div data-testid="drawer" data-open={String(open)} />; } }));
jest.mock("./GeneraliseRuleDialog", () => ({ GeneraliseRuleDialog: () => null }));
jest.mock("./RulesImportResultDialog", () => ({ RulesImportResultDialog: () => null }));
jest.mock("./MergeRulesDialog", () => ({
  MergeRulesDialog: (p: { open: boolean; ruleIds: string[]; defaultDeleteOriginals: boolean; onOpenChange: (open: boolean) => void }) => (
    <div data-testid="merge" data-open={String(p.open)} data-ids={p.ruleIds.join(",")} data-delete={String(p.defaultDeleteOriginals)}>
      <button onClick={() => p.onOpenChange(false)}>close merge</button>
    </div>
  ),
}));

const rule = (id: string, isDeleted = false) => ({ entity: { id }, saved: undefined, isNew: false, isUpdated: false, isDeleted });
const seed = (rules: Record<string, ReturnType<typeof rule>>) => useStagedStore.setState({ rules: rules as never });
const merge = () => screen.getByTestId("merge");

beforeEach(() => { replace.mockClear(); push.mockClear(); (toast.error as jest.Mock).mockClear(); drawerOpens.length = 0; query = ""; loading = false; readRules = [{ id: "r1" }, { id: "r2" }]; seed({ r1: rule("r1"), r2: rule("r2") }); });

describe("the rules page, when the address asks for something", () => {
  it("opens the new rule drawer from the first render for ?new=1, and takes the parameter off the address", () => {
    query = "new=1";
    render(<RulesView />);
    // Open on the very first render, not opened by an effect after one that was closed.
    expect(drawerOpens[0]).toBe(true);
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-open", "true");
    expect(replace).toHaveBeenCalledWith("/rules");
  });

  it("leaves the drawer closed and the address alone without it", () => {
    render(<RulesView />);
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-open", "false");
    expect(replace).not.toHaveBeenCalled();
  });

  it("opens the merge dialog for ?merge=ids, with Delete originals ticked when it came from diagnostics", () => {
    query = "merge=r1,r2&from=diagnostics";
    render(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "true");
    expect(merge()).toHaveAttribute("data-ids", "r1,r2");
    expect(merge()).toHaveAttribute("data-delete", "true");
    expect(replace).not.toHaveBeenCalled();
  });

  it("waits for the rules to be loaded before judging the ids, so a cold load does not report them missing", () => {
    query = "merge=r1,r2";
    loading = true;
    seed({});
    const { rerender } = render(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "false");
    expect(toast.error).not.toHaveBeenCalled();
    loading = false;
    seed({ r1: rule("r1"), r2: rule("r2") });
    rerender(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "true");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so, once, and clears the address when a rule to merge no longer exists", () => {
    query = "merge=r1,gone";
    const { rerender } = render(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "false");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("no longer exists"));
    expect(replace).toHaveBeenCalledWith("/rules");
    rerender(<RulesView />);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("does not report rules as missing while the staged store has not caught up with what was read", () => {
    query = "merge=r1,r2";
    seed({});
    const { rerender } = render(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "false");
    expect(toast.error).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    act(() => { seed({ r1: rule("r1"), r2: rule("r2") }); });
    rerender(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "true");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not take an id such as constructor for a rule", () => {
    query = "merge=r1,constructor";
    render(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "false");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/rules");
  });

  it("does not turn a merge that has opened into a complaint when the merge deletes its originals", () => {
    query = "merge=r1,r2";
    const { rerender } = render(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "true");
    // The dialog's merge deletes the originals and leaves the page its own way.
    act(() => { seed({ r1: rule("r1", true), r2: rule("r2", true) }); });
    rerender(<RulesView />);
    expect(toast.error).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("treats a request with fewer than two rules as nothing to merge, without a complaint", () => {
    query = "merge=r1";
    render(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "false");
    expect(toast.error).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/rules");
  });

  it("opens the dialog once: closing it stays closed while the address still asks, even when the rules change", () => {
    query = "merge=r1,r2";
    const { rerender } = render(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "true");
    act(() => { screen.getByText("close merge").click(); });
    expect(merge()).toHaveAttribute("data-open", "false");
    act(() => { seed({ r1: rule("r1"), r2: rule("r2"), r3: rule("r3") }); });
    rerender(<RulesView />);
    expect(merge()).toHaveAttribute("data-open", "false");
  });

  it("still opens the merge dialog from the table", () => {
    render(<RulesView />);
    act(() => { screen.getByText("merge from table").click(); });
    expect(merge()).toHaveAttribute("data-open", "true");
    expect(merge()).toHaveAttribute("data-ids", "r1,r2");
    expect(merge()).toHaveAttribute("data-delete", "false");
  });
});
