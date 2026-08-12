import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_MATCH_CONFIG, DEFAULT_TEXT_PRESET } from "@/lib/reconciliation/match/config";
import { ImportPanel } from "./ImportPanel";

/**
 * The import preview's contract (PR-037 / F-092).
 *
 * The screen exists so a user can satisfy themselves the statement was read
 * correctly before anything is matched. It used to show `rows.slice(0, 8)`,
 * which cannot answer that question for a real statement: a column mapped
 * wrongly from row 40 onward looks perfect in the first eight.
 *
 * The parser has its own tests; what is asserted here is only that every row it
 * produced reaches the screen.
 */

function statement(rowCount: number): string {
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    // Deliberately digit-free text: a text column whose values end in digits is
    // currently classified numeric and dropped from the text channels (F-093),
    // which is a parser matter rather than a layout one.
    const suffix = String.fromCharCode(65 + (index % 26));
    return `2026-08-${day},MERCHANT ${suffix},Online purchase,-${index + 1}.00`;
  });
  return ["Date,Description,Memo,Amount", ...rows].join("\n");
}

/** Render the panel and paste a statement into it, as a user without a file does. */
function renderWith(text: string) {
  render(
    <ImportPanel
      accountName="Global Money Credit Card"
      matchConfig={DEFAULT_MATCH_CONFIG}
      matchPreset={DEFAULT_TEXT_PRESET}
      profiles={[]}
      onMatchConfigChange={() => {}}
      onApplyProfile={() => {}}
      onSaveProfile={() => {}}
      onReadyChange={() => {}}
    />
  );

  fireEvent.change(screen.getByLabelText("Or paste statement rows"), { target: { value: text } });
}

function previewRows(): HTMLElement[] {
  const table = screen.getByRole("table", { name: /every row parsed/i });
  return [...table.querySelectorAll("tbody tr")] as HTMLElement[];
}

describe("import preview", () => {
  it("shows every parsed row, not a sample of them", () => {
    renderWith(statement(40));

    // The old cap was eight. A statement's later rows are exactly where a
    // mis-read column shows up, so all of them have to be reachable.
    expect(previewRows()).toHaveLength(40);
  });

  it("offers no pagination — the preview is one scrollable list", () => {
    renderWith(statement(40));

    expect(screen.queryByRole("button", { name: /next page|show all|load more/i })).toBeNull();
  });

  it("keeps a column for each of the statement's two text channels", () => {
    renderWith(statement(3));

    const table = screen.getByRole("table", { name: /every row parsed/i });
    for (const heading of ["Date", "Imported payee", "Notes", "Reference", "Amount"]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }

    const first = previewRows()[0];
    expect(within(first).getByText("MERCHANT A")).toBeInTheDocument();
    expect(within(first).getByText("Online purchase")).toBeInTheDocument();
  });

  it("reports rows it could not read without dropping the ones it could", () => {
    // The bad row here carries an unreadable *amount*. A bad date would have
    // been the obvious fixture, but one unparseable date currently flips the
    // whole file's detected format and nothing parses at all (F-093) - a
    // parser defect this layout work deliberately leaves alone.
    renderWith(
      [
        "Date,Description,Amount",
        "2026-08-01,GOOD,-10.00",
        "2026-08-02,ALSO GOOD,-20.00",
        "2026-08-03,STILL GOOD,-30.00",
        "2026-08-04,BAD,N/A",
      ].join("\n")
    );

    expect(previewRows()).toHaveLength(3);
    expect(screen.getByText(/1 could not be read/)).toBeInTheDocument();
  });

  it("keeps every control available after the layout change", () => {
    renderWith(statement(5));

    // Mapping moved into the preview header, interpretation stayed on the left,
    // and the raw text is behind a button — but nothing was lost.
    expect(screen.getByLabelText("Source column for the posted date")).toBeInTheDocument();
    expect(screen.getByLabelText("Source column for the imported payee")).toBeInTheDocument();
    expect(screen.getByLabelText("Source column for the notes")).toBeInTheDocument();
    expect(screen.getByLabelText("Source column for the reference")).toBeInTheDocument();
    expect(screen.getByLabelText("Source column for the amount")).toBeInTheDocument();

    expect(screen.getByLabelText("Date format")).toBeInTheDocument();
    expect(screen.getByLabelText("Amounts")).toBeInTheDocument();
    expect(screen.getByLabelText("Decimal")).toBeInTheDocument();
    expect(screen.getByLabelText("Compare statement text against")).toBeInTheDocument();
    expect(screen.getByLabelText("Match transactions within (days)")).toBeInTheDocument();
    expect(screen.getByLabelText("Look beyond the statement period (days)")).toBeInTheDocument();

    expect(screen.getByLabelText("Profile name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save profile/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit pasted statement/i })).toBeInTheDocument();
  });

  it("puts the mapping selectors in the preview header, above the values they feed", () => {
    renderWith(statement(5));

    // The point of the move: the control and the column it controls are the
    // same column, so a wrong mapping is visible rather than deduced.
    const table = screen.getByRole("table", { name: /every row parsed/i });
    expect(
      within(table).getByLabelText("Source column for the imported payee")
    ).toBeInTheDocument();
  });

  it("names source columns by their header and a real value from them", () => {
    renderWith(statement(5));

    const select = screen.getByLabelText("Source column for the imported payee");
    const options = [...select.querySelectorAll("option")].map((option) => option.textContent);

    // "Column 3" says nothing; "Description · MERCHANT A" is recognisable.
    expect(options).toContain("Description · MERCHANT A");
    expect(options).toContain("Date · 2026-08-01");
  });

  it("keeps advanced matching options available but out of the way", () => {
    renderWith(statement(5));

    // Present in the DOM inside a closed disclosure: available, but not
    // spending permanent height in a pane that must not scroll.
    const advanced = screen.getByText("Advanced matching options").closest("details");
    expect(advanced).not.toBeNull();
    expect(advanced).not.toHaveAttribute("open");
    expect(within(advanced as HTMLElement).getByRole("checkbox", { name: /ignore/i })).toBeInTheDocument();
  });

  it("shows no column mapping for a format that states its own fields", () => {
    renderWith(
      ["!Type:Bank", "D01/08/2026", "T-125.50", "PAMAZON AE", "MOnline purchase", "^"].join("\n")
    );

    expect(screen.queryByLabelText("Source column for the imported payee")).toBeNull();
    // ...but the format's own interpretation controls are there.
    expect(screen.getByLabelText(/Swap the payee and memo/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Use the memo when the payee is empty/)).toBeInTheDocument();
  });

  it("gives a debit/credit file a column each, under its own selector", () => {
    // The mapping most worth being able to see: reversing these two signs every
    // outflow the wrong way, and matching requires the exact signed amount.
    renderWith(
      [
        "Date,Description,Debit,Credit",
        "2026-08-01,SHOP,141.37,",
        "2026-08-02,SALARY,,5000.00",
      ].join("\n")
    );

    const table = screen.getByRole("table", { name: /every row parsed/i });
    expect(within(table).getByRole("columnheader", { name: "Debit" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Credit" })).toBeInTheDocument();
    expect(within(table).getByLabelText("Source column for debits")).toBeInTheDocument();
    expect(within(table).getByLabelText("Source column for credits")).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Amount" })).toBeNull();

    // Each row's normalized amount sits in the column its sign puts it in.
    const [outflow, inflow] = previewRows();
    expect([...outflow.querySelectorAll("td")].at(-2)).toHaveTextContent("-141.37");
    expect([...outflow.querySelectorAll("td")].at(-1)).toHaveTextContent("-");
    expect([...inflow.querySelectorAll("td")].at(-1)).toHaveTextContent("5,000.00");
  });

  it("names the statement once, and not in a banner of its own", () => {
    renderWith(statement(3));

    // The filename belongs to the source card; row count and period describe the
    // preview and live over it. Three copies of one name is what this replaced.
    expect(screen.getAllByText("Pasted statement")).toHaveLength(1);
  });
});
