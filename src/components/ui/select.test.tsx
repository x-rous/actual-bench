import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Select } from "./select";

const options = [
  { value: "archive", label: "Quick - it is a valid archive" },
  { value: "data", label: "Standard - the budget opens" },
];

describe("Select", () => {
  it("shows the chosen option's label, and reports a new choice", async () => {
    const onValueChange = jest.fn();
    render(<Select aria-label="Verification" value="data" options={options} onValueChange={onValueChange} />);

    const trigger = screen.getByRole("combobox", { name: "Verification" });
    expect(trigger).toHaveTextContent("Standard - the budget opens");

    fireEvent.click(trigger);
    const option = await screen.findByRole("option", { name: "Quick - it is a valid archive" });
    // Base UI chooses on the pointer's release, as a real click does.
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("archive"));
  });

  it("shows the placeholder when the value matches no option", () => {
    render(<Select aria-label="Mode" value="" placeholder="Choose…" options={options} onValueChange={jest.fn()} />);
    expect(screen.getByRole("combobox", { name: "Mode" })).toHaveTextContent("Choose…");
  });

  it("lists grouped options under their headings", async () => {
    render(
      <Select
        aria-label="Account"
        value="a1"
        groups={[
          { label: "On budget", options: [{ value: "a1", label: "Checking" }] },
          { label: "Off budget", options: [{ value: "a2", label: "Mortgage" }] },
        ]}
        onValueChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Account" }));
    expect(await screen.findByText("Off budget")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mortgage" })).toBeInTheDocument();
  });
});
