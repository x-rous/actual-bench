import { render, screen, within } from "@testing-library/react";
import { OverviewNavigationSection } from "./OverviewNavigationSection";
import { FEATURES } from "@/lib/features/catalogue";

it("shows every feature's purpose, navigation and direct resources without search or information controls", () => {
  render(<OverviewNavigationSection />);
  expect(screen.getAllByRole("article")).toHaveLength(20);
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4);
  expect(screen.getAllByText("Experimental")).toHaveLength(5);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText("All features")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Assets" })).toHaveAttribute("href", "/assets");
  for (const feature of FEATURES) {
    const row = screen.getByRole("heading", { name: feature.label, level: 3 }).closest("article")!;
    expect(within(row).getByText(feature.description)).toBeInTheDocument();
    expect(within(row).queryByText(feature.accessSummary, { exact: false })).not.toBeInTheDocument();
    expect(within(row).getByRole("link", { name: feature.label })).toHaveAttribute("href", feature.href);
    expect(within(row).getByRole("link", { name: /documentation/ })).toHaveAttribute("href", feature.docsUrl);
    if (feature.feedbackUrl) expect(within(row).getByRole("link", { name: /feedback/ })).toHaveAttribute("href", feature.feedbackUrl);
    else expect(within(row).queryByRole("link", { name: /feedback/ })).not.toBeInTheDocument();
  }
});
