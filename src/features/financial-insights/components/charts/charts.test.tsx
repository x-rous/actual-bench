import { render } from "@testing-library/react";
import { compactAxis, labelMoney, signedLabelMoney } from "../../format";
import { BarChart } from "./BarChart";
import { CompositionChart } from "./CompositionChart";
import { FlowChart } from "./FlowChart";
import { LineChart } from "./LineChart";
import { LABEL_HALO, spreadLabels } from "./labels";
import { monthTip } from "./monthTip";
import { TipRow } from "./Tip";

const tip = () => null;

describe("compactAxis", () => {
  it("keeps the plain compact labels when they are all different", () => {
    expect(compactAxis([0, 500_000, 1_000_000])).toEqual(["0", "5.0k", "10k"]);
  });

  it("never returns two ticks with the same label, however close they are", () => {
    // Whole minor units 0.01 apart, at the size of thousands: only five decimals of k tell them apart.
    const labels = compactAxis([100_000_000, 100_000_001, 100_000_002]);
    expect(new Set(labels).size).toBe(3);
    // Past that the exact amount is written.
    expect(new Set(compactAxis([1_000_000_000_000, 1_000_000_000_001])).size).toBe(2);
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

  it("puts each label beside its own last point, apart from the others, and above the month rectangles so its tooltip is reachable", () => {
    const lines = [...series, { key: "early", label: "Closed", colour: "#0a0", values: [10_000, null, null] }, { key: "near", label: "Near net worth", colour: "#a0a", values: [10_000, 20_000, 299_000] }];
    const { container } = render(<LineChart labels={["Jan", "Feb", "Mar"]} partialIndex={null} series={lines} tip={tip} ariaLabel="Lines" endLabels />);
    const labels = [...container.querySelectorAll("text")].filter((t) => t.querySelector("title"));
    const at = (name: string) => labels.find((t) => t.querySelector("title")?.textContent === name)!;
    const x = (name: string) => Number(at(name).getAttribute("x")), y = (name: string) => Number(at(name).getAttribute("y"));
    // A line that ended in January is labelled beside January, not at the right edge.
    expect(x("Closed")).toBeLessThan(x("Net worth"));
    expect(x("Net worth")).toBe(x("Debts"));
    // Net worth (3.0k) and the line ending at 2.99k are the same height, so their labels are pushed apart; Debts is clear of both.
    expect(Math.abs(y("Net worth") - y("Near net worth"))).toBeGreaterThanOrEqual(13);
    expect(Math.abs(y("Net worth") - y("Debts"))).toBeGreaterThanOrEqual(13);
    // Painted last in the drawing, so the transparent month rectangles do not sit over them.
    const order = [...container.querySelectorAll("svg *")];
    const lastRect = Math.max(...order.map((e, i) => (e.tagName === "rect" ? i : -1)));
    expect(order.indexOf(labels[0])).toBeGreaterThan(lastRect);
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

  it("writes a net-negative total below its stack, and keeps a label that would leave the drawing inside it", () => {
    const owed = [{ key: "a", label: "A", colour: "#00f", values: [-100_000, -300_000] }];
    const { container } = render(<BarChart labels={["Jan", "Feb"]} partialIndex={null} series={owed} stacked totals tip={tip} ariaLabel="Bars" height={230} />);
    const totals = [...container.querySelectorAll("text")].filter((t) => t.getAttribute("aria-hidden") === "true");
    expect(totals.map((t) => t.textContent)).toEqual(["-1.0k", "-3.0k"]);
    const bars = [...container.querySelectorAll("rect[fill='#00f']")];
    totals.forEach((t, i) => {
      const y = Number(t.getAttribute("y"));
      expect(y).toBeGreaterThan(Number(bars[i].getAttribute("y")) + Number(bars[i].getAttribute("height")) - 1);
      expect(y).toBeLessThanOrEqual(230);
    });
  });

  it("keeps the labels of all-negative overlay totals inside the drawing", () => {
    const owed = [{ key: "a", label: "A", colour: "#00f", values: [-100_000, -300_000] }];
    const { container } = render(<BarChart labels={["Jan", "Feb"]} partialIndex={null} series={owed} stacked overlay={{ label: "Total", colour: "#000", values: [-100_000, -300_000] }} overlayLabels tip={tip} ariaLabel="Bars" />);
    const labelYs = [...container.querySelectorAll("text")].filter((t) => t.getAttribute("aria-hidden") === "true").map((t) => Number(t.getAttribute("y")));
    expect(labelYs).toHaveLength(2);
    labelYs.forEach((y) => expect(y).toBeGreaterThanOrEqual(12));
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

describe("signedLabelMoney", () => {
  it("writes the sign out: + above zero, − below it, and 0 for nothing", () => {
    expect(signedLabelMoney(240_000)).toBe("+2.4k");
    expect(signedLabelMoney(-1_400_000)).toBe("−14k");
    expect(signedLabelMoney(0)).toBe("0");
    expect(signedLabelMoney(-8_988)).toBe("−90");
    expect(signedLabelMoney(850)).toBe("+8.5");
    expect(signedLabelMoney(-32)).toBe("−0.3");
  });
});

describe("FlowChart kept labels", () => {
  const labels = ["Jan", "Feb", "Mar", "Apr"];
  const props = { labels, received: [500_000, 100_000, 300_000, 20_000], spent: [380_000, 150_000, 300_000, 10_000], tip, onSelect: () => undefined };
  const written = (container: HTMLElement) => [...container.querySelectorAll("text")].filter((t) => t.getAttribute("aria-hidden") === "true");

  it("writes what was kept beside each marker with its sign, and nothing for a month still being checked", () => {
    const { container } = render(<FlowChart {...props} partialIndex={null} kept={[120_000, -50_000, null, 10_000]} />);
    expect(written(container).map((t) => t.textContent)).toEqual(["+1.2k", "−500", "+100"]);
  });

  it("puts a figure above its marker when something was kept and below it when not", () => {
    const { container } = render(<FlowChart {...props} partialIndex={null} kept={[120_000, -50_000, 0, 10_000]} />);
    const markers = container.querySelectorAll("circle");
    const [saved, overspent] = written(container);
    expect(Number(saved.getAttribute("y"))).toBeLessThan(Number(markers[0].getAttribute("cy")));
    expect(Number(overspent.getAttribute("y"))).toBeGreaterThan(Number(markers[1].getAttribute("cy")));
  });

  it("outlines the figures, so they read over a bar", () => {
    const { container } = render(<FlowChart {...props} partialIndex={null} kept={[120_000, -50_000, 0, 10_000]} />);
    // jsdom drops the properties it does not know (paint-order), so the outline is checked by its stroke and by the shared style.
    expect(written(container)[0].getAttribute("style")).toContain("stroke: var(--card)");
    expect(LABEL_HALO).toMatchObject({ paintOrder: "stroke", stroke: "var(--card)" });
  });

  it("leaves the partial month, which is not compared, without a figure", () => {
    const { container } = render(<FlowChart {...props} partialIndex={3} kept={[120_000, -50_000, 0, 10_000]} />);
    expect(written(container).map((t) => t.textContent)).toEqual(["+1.2k", "−500", "0"]);
  });

  it("leaves the figures out when the months are too narrow for them", () => {
    const many = Array.from({ length: 40 }, (_, i) => `M${i}`);
    const { container } = render(<FlowChart labels={many} partialIndex={null} received={many.map(() => 100_000)} spent={many.map(() => 60_000)} kept={many.map(() => 40_000)} tip={tip} onSelect={() => undefined} />);
    expect(written(container)).toHaveLength(0);
  });
});

describe("CompositionChart net worth labels", () => {
  const month = (property: number, loans: number) => ({ cash: 0, fixed: 0, invest: 0, property, vehicle: 0, other: 0, loans, cards: 0, otherLiability: 0 });
  const months = [month(320_000_000, -15_000_000), month(330_000_000, -15_000_000), month(340_000_000, -16_000_000)];
  const netWorth = [300_000_000, 320_000_000, 340_000_000];
  const base = { labels: ["Jan", "Feb", "Mar"], partialIndex: null, months, netWorth, hidden: new Set<never>(), showNetWorth: true };
  const written = (container: HTMLElement) => [...container.querySelectorAll("text")].filter((t) => t.getAttribute("aria-hidden") === "true").map((t) => t.textContent);

  it("writes net worth beside each marker and no totals of what is owned or owed", () => {
    const { container } = render(<CompositionChart {...base} />);
    expect(written(container)).toEqual(["3.0m", "3.2m", "3.4m"]);
  });

  it("writes nothing when net worth is switched off", () => {
    const { container } = render(<CompositionChart {...base} showNetWorth={false} />);
    expect(written(container)).toEqual([]);
  });

  it("skips a month before the budget has data", () => {
    const { container } = render(<CompositionChart {...base} hasData={[false, true, true]} />);
    expect(written(container)).toEqual(["3.2m", "3.4m"]);
  });

  it("keeps only the first and last when the months are too narrow for every figure", () => {
    const many = Array.from({ length: 40 }, (_, i) => `M${i}`);
    const { container } = render(<CompositionChart {...base} labels={many} months={many.map(() => month(320_000_000, -15_000_000))} netWorth={many.map((_, i) => 300_000_000 + i * 1_000_000)} />);
    expect(written(container)).toEqual(["3.0m", "3.4m"]);
  });
});
