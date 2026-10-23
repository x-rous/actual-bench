import { createPortal } from "react-dom";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PendingPanelProvider, usePendingPanel } from "./PendingPanelContext";
import { PendingPanelFrame } from "./PendingPanelFrame";

beforeEach(() => localStorage.clear());

function Shell({ budget = false, count = 2, forced = false, collapsible = true }: { budget?: boolean; count?: number; forced?: boolean; collapsible?: boolean }) {
  return <PendingPanelProvider forceExpanded={forced}><PendingPanelFrame data-budget-details-panel={budget} title={budget ? "Budget details" : "Changes"} count={count} autoCollapseEmpty={!budget} collapsible={collapsible}><p>Review content</p></PendingPanelFrame></PendingPanelProvider>;
}

it("remembers minimization across page types and remounts and preserves focus", () => {
  const view = render(<Shell />);
  fireEvent.click(screen.getByRole("button", { name: "Minimize changes" }));
  expect(screen.getByRole("button", { name: "Show changes" })).toHaveFocus();
  expect(screen.getByText("Review content")).not.toBeVisible();
  expect(screen.getByLabelText("2 pending changes")).toBeInTheDocument();
  view.rerender(<Shell budget />);
  expect(screen.getByRole("button", { name: "Show budget details" })).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "Budget details minimized" })).toHaveAttribute("data-budget-details-panel");
  view.unmount();
  const next = render(<Shell budget />);
  fireEvent.click(screen.getByRole("button", { name: "Show budget details" }));
  expect(screen.getByRole("button", { name: "Minimize budget details" })).toHaveFocus();
  expect(screen.getByRole("complementary", { name: "Budget details" })).toHaveAttribute("data-budget-details-panel");
  expect(screen.getByText("Review content")).toBeInTheDocument();
  next.rerender(<Shell />);
  expect(screen.getByRole("button", { name: "Minimize changes" })).toBeInTheDocument();
});

it("keeps the expanded header available after focused actions clear the last draft", () => {
  const view = render(<Shell />);
  fireEvent.focus(screen.getByRole("button", { name: "Minimize changes" }));
  view.rerender(<Shell count={0} />);
  expect(screen.getByRole("button", { name: "Minimize changes" })).toBeInTheDocument();
});

it("allows an empty entity rail to open for reviewing undo history", () => {
  render(<Shell count={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Show changes" }));
  expect(screen.getByText("Review content")).toBeInTheDocument();
});


it("keeps local review state mounted while minimized", () => {
  function Review() {
    const [note, setNote] = useState("");
    return <input aria-label="Review note" value={note} onChange={event => setNote(event.target.value)} />;
  }
  render(<PendingPanelProvider><PendingPanelFrame title="Changes" count={1}><Review /></PendingPanelFrame></PendingPanelProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), { target: { value: "Keep this context" } });
  fireEvent.click(screen.getByRole("button", { name: "Minimize changes" }));
  expect(screen.queryByRole("textbox", { name: "Review note" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show changes" }));
  expect(screen.getByRole("textbox", { name: "Review note" })).toHaveValue("Keep this context");
});


it("keeps portal-owned controls available when undo clears the last pending change", () => {
  function Controls({ clear }: { clear: () => void }) {
    const { actionsTarget } = usePendingPanel();
    return actionsTarget ? createPortal(<button onClick={clear}>Undo last change</button>, actionsTarget) : null;
  }
  function Workspace() {
    const [count, setCount] = useState(1);
    return <><Controls clear={() => setCount(0)} /><PendingPanelFrame title="Changes" count={count} autoCollapseEmpty><p>Draft</p></PendingPanelFrame></>;
  }
  render(<PendingPanelProvider><Workspace /></PendingPanelProvider>);
  const undo = screen.getByRole("button", { name: "Undo last change" });
  fireEvent.focus(undo);
  fireEvent.click(undo);
  expect(screen.getByRole("button", { name: "Undo last change" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Minimize changes" })).toBeInTheDocument();
});


it("temporarily expands a guarded review without changing the stored preference", () => {
  localStorage.setItem("pending-panel-minimized", "1");
  const view = render(<Shell forced />);
  expect(screen.getByRole("button", { name: "Minimize changes" })).toBeDisabled();
  expect(screen.getByText("Review content")).toBeVisible();
  expect(localStorage.getItem("pending-panel-minimized")).toBe("1");
  view.rerender(<Shell />);
  expect(screen.getByRole("button", { name: "Show changes" })).toBeInTheDocument();
  expect(localStorage.getItem("pending-panel-minimized")).toBe("1");
});

it("keeps non-collapsible panels visible regardless of the stored preference", () => {
  localStorage.setItem("pending-panel-minimized", "1");
  render(<Shell budget collapsible={false} />);
  expect(screen.getByRole("complementary", { name: "Budget details" })).toBeVisible();
  expect(screen.getByText("Review content")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Show budget details" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Minimize budget details" })).not.toBeInTheDocument();
});
