import { render } from "@testing-library/react";
import { compactAxis, labelMoney } from "../../format";
import { BarChart } from "./BarChart";
import { LineChart } from "./LineChart";
import { spreadLabels } from "./labels";
import { monthTip } from "./monthTip";
import { TipRow } from "./Tip";

const tip = () => null;

describe("compactAxis", () => {
  it("keeps the plain compact labels when they are all different", () => {
    expect(compactAxis([0, 500_000, 1_000_000])).toEqual(["0", "5.0k", "10k"]);
  });

  it("adds a decimal when a narrow range far from zero would round several ticks to the same label", () => {
    // 84.5k, 85k, 85.5k, 86k in minor units: plain labels read 85k, 85k, 86k, 86k.
    const labels = compactAxis([8_450_000, 8_500_000, 8_550_000, 8_600_000]);
    expect(new Set(labels).size).toBe(4);
    expect(labels).toEqual(["84.5k", "85.0k", "85.5k", "86.0k"]);
  });
});

describe("spreadLabels", () => {
  it("leaves labels that are already apart where they are", () => {
    expect(spreadLabels([20, 80, 140], 13, 0, 200)).toEqual([20, 80, 140]);
  });

  it("pushes crowded labels apart, in the order they were given", () => {
    const placed = spreadLabels([100, 50, 104], 13, 0, 200);
    expect(placed[1]).toBe(50);
    expect(placed[0]).toBe(100);
    expect(placed[2]).toBe(113);
  });

  it("pulls the last label back up when pushing would take it past the bottom", () => {
    const placed = spreadLabels([190, 192, 195], 13, 0, 200);
    expect(placed).toEqual([174, 187, 200]);
  });
});

describe("LineChart end labels", () => {
  const series = [
    { key: "net", label: "Net worth", colour: "#000", values: [100_000, 200_000, 300_000], primary: true },
    { key: "debt", label: "Debts", colour: "#f00", values: [50_000, null, 40_000] },
  ];

  it("writes each line's last value beside its last point", () => {
    const { container } = render(<LineChart labels={["Jan", "Feb", "Mar"]} partialIndex={null} series={series} tip={tip} ariaLabel="Lines" endLabels />);
    // The figure is the text itself; the line's name is its tooltip.
    const figures = [...container.querySelectorAll("text")].map((t) => t.lastChild?.textContent);
    expect(figures).toEqual(expect.arrayContaining(["3.0k", "400"]));
    expect([...container.querySelectorAll("text title")].map((t) => t.textContent)).toEqual(["Net worth", "Debts"]);
  });

  it("writes nothing extra unless asked", () => {
    const { container } = render(<LineChart labels={["Jan", "Feb", "Mar"]} partialIndex={null} series={series} tip={tip} ariaLabel="Lines" />);
    expect([...container.querySelectorAll("text")].map((t) => t.lastChild?.textContent)).not.toContain("400");
  });
});

describe("BarChart totals", () => {
  const bars = [
    { key: "a", label: "A", colour: "#00f", values: [100_000, 200_000, 0] },
    { key: "b", label: "B", colour: "#0f0", values: [50_000, 25_000, 0] },
  ];
  const labels = ["Jan", "Feb", "Mar"];

  it("writes each month's total above its stack, and nothing for a month that totals nothing", () => {
    const { container } = render(<BarChart labels={labels} partialIndex={null} series={bars} stacked totals tip={tip} ariaLabel="Bars" />);
    // Totals are the decorative text; March totals nothing, so it has none.
    const totals = [...container.querySelectorAll("text")].filter((t) => t.getAttribute("aria-hidden") === "true").map((t) => t.textContent);
    expect(totals).toEqual(["1.5k", "2.3k"]);
  });

  it("leaves totals out when the months are too narrow to carry them", () => {
    const many = Array.from({ length: 40 }, (_, i) => `M${i}`);
    const wide = [{ key: "a", label: "A", colour: "#00f", values: many.map(() => 100_000) }];
    const { container } = render(<BarChart labels={many} partialIndex={null} series={wide} stacked totals tip={tip} ariaLabel="Bars" />);
    expect([...container.querySelectorAll("text")].filter((t) => t.getAttribute("aria-hidden") === "true")).toHaveLength(0);
  });

  it("writes no totals unless asked", () => {
    const { container } = render(<BarChart labels={labels} partialIndex={null} series={bars} stacked tip={tip} ariaLabel="Bars" />);
    expect([...container.querySelectorAll("text")].filter((t) => t.getAttribute("aria-hidden") === "true")).toHaveLength(0);
  });
});

describe("BarChart value labels", () => {
  const labels = ["Jan", "Feb", "Mar"];
  const single = [{ key: "a", label: "A", colour: "#00f", values: [100_000, 0, 250_000] }];
  const decorative = (container: HTMLElement) => [...container.querySelectorAll("text")].filter((t) => t.getAttribute("aria-hidden") === "true").map((t) => t.textContent);

  it("writes each bar's value above it, and nothing for a month of nothing", () => {
    const { container } = render(<BarChart labels={labels} partialIndex={null} series={single} valueLabels tip={tip} ariaLabel="Bars" />);
    expect(decorative(container)).toEqual(["1.0k", "2.5k"]);
  });

  it("writes none unless asked", () => {
    const { container } = render(<BarChart labels={labels} partialIndex={null} series={single} tip={tip} ariaLabel="Bars" />);
    expect(decorative(container)).toEqual([]);
  });

  it("leaves the figures out when the bars are too narrow to carry them", () => {
    const many = Array.from({ length: 40 }, (_, i) => `M${i}`);
    const { container } = render(<BarChart labels={many} partialIndex={null} series={[{ key: "a", label: "A", colour: "#00f", values: many.map(() => 100_000) }]} valueLabels tip={tip} ariaLabel="Bars" />);
    expect(decorative(container)).toEqual([]);
  });
});

describe("BarChart overlay labels", () => {
  const labels = ["Jan", "Feb"];
  const stack = [
    { key: "a", label: "A", colour: "#00f", values: [100_000, 300_000] },
    { key: "b", label: "B", colour: "#0f0", values: [0, -100_000] },
  ];
  // February's net total (200k) sits below its stack (300k above zero, 100k below).
  const overlay = { label: "Total", colour: "#000", values: [100_000, 200_000] };
  const labelled = (container: HTMLElement) => [...container.querySelectorAll("text")].filter((t) => t.getAttribute("aria-hidden") === "true");

  it("writes each marker's value, and puts it above the stack when the stack reaches higher", () => {
    const { container } = render(<BarChart labels={labels} partialIndex={null} series={stack} stacked overlay={overlay} overlayLabels tip={tip} ariaLabel="Bars" />);
    const texts = labelled(container);
    expect(texts.map((t) => t.textContent)).toEqual(["1.0k", "2.0k"]);
    // The second label clears the stack's top, not just the marker, which sits lower.
    const marker = container.querySelectorAll("circle")[1];
    expect(Number(texts[1].getAttribute("y"))).toBeLessThan(Number(marker.getAttribute("cy")) - 9);
  });

  it("writes none unless asked", () => {
    const { container } = render(<BarChart labels={labels} partialIndex={null} series={stack} stacked overlay={overlay} tip={tip} ariaLabel="Bars" />);
    expect(labelled(container)).toHaveLength(0);
  });
});

describe("tooltip emphasis", () => {
  it("makes the strong row's name and value bold and full strength, and leaves the others muted", () => {
    const { container } = render(<><TipRow name="Cash" value="1" /><TipRow name="Net worth" value="2" strong /></>);
    const [plain, strong] = [...container.children] as HTMLElement[];
    expect(plain.firstElementChild).toHaveClass("text-muted-foreground");
    expect(plain.firstElementChild).not.toHaveClass("font-semibold");
    expect(strong.firstElementChild).toHaveClass("font-semibold", "text-foreground");
    expect(strong.lastElementChild).toHaveClass("font-semibold", "text-foreground");
  });

  it("monthTip passes the strong flag to its row", () => {
    const { container } = render(<>{monthTip({ title: "Jan", partial: false, partialNote: "", rows: [{ name: "Part", value: "1" }, { name: "Total", value: "2", strong: true }] })}</>);
    const rows = [...container.querySelectorAll("div.flex")] as HTMLElement[];
    expect(rows[0].firstElementChild).not.toHaveClass("font-semibold");
    expect(rows[1].firstElementChild).toHaveClass("font-semibold");
  });
});

describe("labelMoney", () => {
  it("keeps thousands compact and writes amounts under a thousand as whole units, one decimal under ten", () => {
    expect(labelMoney(1_234_500)).toBe("12k");
    expect(labelMoney(-150_000)).toBe("-1.5k");
    expect(labelMoney(8_988)).toBe("90");
    expect(labelMoney(-8_988)).toBe("-90");
    expect(labelMoney(850)).toBe("8.5");
    expect(labelMoney(4)).toBe("0");
    expect(labelMoney(-4)).toBe("0");
  });
});
