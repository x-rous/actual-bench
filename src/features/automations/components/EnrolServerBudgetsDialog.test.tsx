import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { EnrolServerBudgetsDialog } from "./EnrolServerBudgetsDialog";
import type { ServerBudget } from "../lib/automationsApi";

jest.mock("@/features/sync/lib/syncApi", () => ({ enrollCredential: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const encrypted: ServerBudget = {
  budgetSyncId: "budget-3",
  name: "Private",
  encrypted: true,
  enrolled: false,
  connectionFingerprint: "fp-3",
};

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <EnrolServerBudgetsDialog
        open={open}
        onOpenChange={setOpen}
        server={{ mode: "browser-api", baseUrl: "https://actual.example.com" }}
        budgets={[encrypted]}
        onEnrolled={() => {}}
      />
    </>
  );
}

describe("enrolling the budgets on a server", () => {
  it("forgets a typed encryption password when the dialog closes", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Encryption password for Private"), { target: { value: "e2ee" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "Reopen", hidden: true }));
    // Nothing chosen and nothing typed: the password went with the dialog.
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByLabelText("Encryption password for Private")).toHaveValue("");
  });
});
