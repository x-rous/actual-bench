import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { StatementTimeline, timelineMonths } from "./StatementTimeline";
import { settlements } from "../lib/repayments";
import { transferPlanScenario } from "../lib/planTracking.fixture";

it("keeps four recent months and two ahead across a year boundary", () => {
  expect(timelineMonths("2027-01-31")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]);
});

it("opens recorded bills and real cash payments, with future dates estimated and plan conversions excluded", () => {
  const { cards, workspace, sources } = transferPlanScenario();
  const open = jest.fn(), payment = jest.fn();
  render(<StatementTimeline card={cards[0]} statements={workspace.statements} snapshot={sources[0]} workspace={workspace} today="2026-10-16" available onStatement={open} onPayment={payment} />);
  fireEvent.click(screen.getByRole("button", { name: "Open closing 08 Oct 2026" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Open closing 08 Oct 2026" })).getByRole("button", { name: "Open statement" }));
  expect(open).toHaveBeenCalledWith(workspace.statements.find((entry) => entry.id === "s-a-4"));
  fireEvent.click(screen.getByRole("button", { name: "Payment 02 Oct 2026 8,000.00" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Payment 02 Oct 2026 8,000.00" })).getByRole("button", { name: "Open payment details" }));
  expect(payment).toHaveBeenCalledWith("cash-a-10");
  fireEvent.click(screen.getByRole("button", { name: "Estimated closing 08 Nov 2026" }));
  expect(screen.getByRole("dialog", { name: "Estimated closing 08 Nov 2026" })).toHaveTextContent("Estimated from billing settings");
  fireEvent.click(screen.getByRole("button", { name: "Payment 15 Oct 2026 1,000.00" }));
  expect(screen.getByRole("dialog", { name: "Payment 15 Oct 2026 1,000.00" })).toHaveTextContent("Pending clearance");
  expect(screen.queryByRole("button", { name: /Payment.*30,000/ })).not.toBeInTheDocument();
});

it("positions events on one continuous date axis and groups payments on the same day", async () => {
  const { cards, workspace, sources } = transferPlanScenario();
  const original = sources[0].rows.find((row) => row.id === "cash-a-10")!;
  const snapshot = { ...sources[0], rows: [...sources[0].rows, { ...original, id: "same-day", fingerprint: "same-day", amountMinor: 25000 }] };
  render(<StatementTimeline card={cards[0]} statements={workspace.statements} snapshot={snapshot} workspace={workspace} today="2026-10-16" available onStatement={jest.fn()} />);
  const july = screen.getByRole("button", { name: "Open closing 08 Jul 2026" });
  const october = screen.getByRole("button", { name: "Open closing 08 Oct 2026" });
  const november = screen.getByRole("button", { name: "Estimated closing 08 Nov 2026" });
  const delta = (first: HTMLElement, last: HTMLElement) => parseFloat(last.style.left) - parseFloat(first.style.left);
  expect(delta(july, october) / delta(october, november)).toBeCloseTo(92 / 31);
  fireEvent.click(screen.getByRole("button", { name: "2 payments on 02 Oct 2026" }));
  const popup = screen.getByRole("dialog", { name: "2 payments on 02 Oct 2026" });
  await waitFor(() => expect(within(popup).getByText("8,000.00")).toBeVisible());
  expect(within(popup).getByText("250.00")).toBeVisible();
});

it("keeps the issued payment target visible when credits clear recorded debt", () => {
  const { cards, workspace, sources } = transferPlanScenario();
  const statuses = settlements(cards[0], workspace, sources[0], "2026-10-16").map((entry) => entry.statementId === "s-a-4" ? { ...entry, fullRemainingMinor: 0, minimumRemainingMinor: 10000, confirmedPaidMinor: 0, confirmedCreditMinor: 500000, confirmedPaidDate: null } : entry);
  render(<StatementTimeline card={cards[0]} statements={workspace.statements} snapshot={sources[0]} workspace={workspace} statuses={statuses} today="2026-10-16" available onStatement={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Open closing 08 Oct 2026" })).toHaveTextContent("5,000.00");
  expect(screen.getByRole("button", { name: "Open closing 08 Oct 2026" })).toHaveTextContent("to pay");
});

