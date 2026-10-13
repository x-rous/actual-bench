import { render, screen } from "@testing-library/react";
import { BalanceProgress } from "./WorkspaceVisuals";

it.each([[-5, 0], [145, 100]])("keeps the true percentage %s readable while bounding the progress value", (percent, bounded) => {
  render(<BalanceProgress label="Credit used" percent={percent} compact />);
  const progress = screen.getByRole("progressbar", { name: "Credit used" });
  expect(progress).toHaveAttribute("aria-valuenow", String(bounded));
  expect(progress).toHaveAttribute("aria-valuetext", `${percent.toFixed(1)}%`);
  expect(screen.getByText(`${percent.toFixed(1)}%`)).toBeVisible();
});
