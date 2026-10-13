import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewText } from "./ReviewText";

it("keeps full source text available in an accessible popover without expanding the table row", async () => {
  const text = "Bank reference with a long description\nSecond source line and final reference";
  render(<ReviewText text={text} label="notes for Visa" />);
  const trigger = screen.getByRole("button", { name: "Read full notes for Visa" });
  expect(trigger).toHaveClass("truncate");
  expect(trigger).toHaveAttribute("title", text);
  expect(trigger).toHaveTextContent("Second source line and final reference");
  fireEvent.click(trigger);
  const popup = await screen.findByRole("dialog", { name: "notes for Visa" });
  expect(popup).toHaveTextContent("Second source line and final reference");
  fireEvent.keyDown(popup, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});
