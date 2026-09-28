import { fireEvent, screen, waitFor } from "@testing-library/react";

/**
 * Choose an option in a `Select` (src/components/ui/select.tsx) the way a
 * person does: open it, then click the option. Base UI chooses on the
 * pointer's release, so the full pointer sequence is sent, not just a click.
 * Test-only.
 */
export async function chooseSelectOption(trigger: HTMLElement, optionName: string | RegExp): Promise<void> {
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.pointerUp(option, { pointerType: "mouse" });
  fireEvent.mouseUp(option);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}
