import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AssetGuide, guideSectionForTab, type AssetGuideSection } from "./AssetGuide";

function Harness({ start }: { start: AssetGuideSection }) { const [section, setSection] = useState(start); return <AssetGuide section={section} onSection={setSection} onClose={jest.fn()} />; }
it("opens on the section for the current tab and navigates between sections", () => {
  expect(guideSectionForTab("Depreciation Schedule")).toBe("depreciation"); expect(guideSectionForTab("Income & Expenses")).toBe("income"); expect(guideSectionForTab(null)).toBe("start");
  render(<Harness start={guideSectionForTab("Depreciation Schedule")} />);
  expect(screen.getByRole("heading", { name: "Depreciation Schedule" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tags in Actual" }));
  expect(screen.getByText("#revaluation")).toBeInTheDocument();
});
