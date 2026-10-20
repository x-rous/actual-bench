import { fireEvent, render, screen } from "@testing-library/react";
import { NewSessionDialog } from "./NewSessionDialog";

// The picker has its own tests; here a plain select stands in, so these cover the dialog's own logic.
jest.mock("@/components/ui/entity-picker", () => ({
  AccountPicker: ({ accounts, value, onChange }: { accounts: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) => (
    <select aria-label="Account" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose</option>
      {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
    </select>
  ),
}));

const ACCOUNTS = [
  { id: "checking", name: "Checking", offBudget: false, closed: false },
  { id: "visa", name: "Visa", offBudget: false, closed: false },
  { id: "amex", name: "Amex", offBudget: false, closed: false },
];
const STATUS: Record<string, "registered" | "unregistered"> = { visa: "registered", amex: "unregistered" };

function open(onStart = jest.fn()) {
  render(<NewSessionDialog open onOpenChange={() => {}} accounts={ACCOUNTS} accountGroups={[]} knownTags={[]} isCreating={false}
    cardStatus={(id) => STATUS[id] ?? null} onStart={onStart} />);
  return onStart;
}

function choose(name: string) {
  const id = ACCOUNTS.find((account) => account.name === name)!.id;
  fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: id } });
}

it("offers the card figures only for a registered credit card, and starts with the choice", () => {
  const onStart = open();
  choose("Checking");
  expect(screen.queryByRole("checkbox", { name: /bank statement figures/ })).not.toBeInTheDocument();

  choose("Amex");
  expect(screen.getByRole("checkbox", { name: /bank statement figures/ })).toBeDisabled();
  expect(screen.getByText("Add this card in Credit Cards first.")).toBeInTheDocument();

  choose("Visa");
  const box = screen.getByRole("checkbox", { name: /bank statement figures/ });
  expect(box).toBeEnabled();
  expect(screen.getByText(/review the statement in Credit Cards/)).toBeInTheDocument();
  fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(onStart).toHaveBeenCalledWith("visa", null, true);
});

it("clears the choice when another account is picked", () => {
  const onStart = open();
  choose("Visa");
  fireEvent.click(screen.getByRole("checkbox", { name: /bank statement figures/ }));
  choose("Checking");
  choose("Visa");
  expect(screen.getByRole("checkbox", { name: /bank statement figures/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(onStart).toHaveBeenCalledWith("visa", null, false);
});
