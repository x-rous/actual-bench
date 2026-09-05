import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_MATCH_CONFIG, DEFAULT_TEXT_PRESET } from "@/lib/reconciliation/match/config";
import { DEFAULT_APPLY_CONFIG } from "@/lib/reconciliation/session/plan";
import { fingerprintStatement } from "@/lib/reconciliation/statement/normalize";
import type { ReconciliationSessionStatus } from "@/lib/app-db/reconciliationRepository";
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
function renderWith(text: string, writeSettingsLocked = false) {
  render(
    <ImportPanel
      accountName="Global Money Credit Card"
      matchConfig={DEFAULT_MATCH_CONFIG}
      matchPreset={DEFAULT_TEXT_PRESET}
      applyConfig={DEFAULT_APPLY_CONFIG}
      writeSettingsLocked={writeSettingsLocked}
      onApplyConfigChange={() => {}}
      profiles={[]}
      onMatchConfigChange={() => {}}
      onApplyProfile={() => {}}
      onSaveProfile={() => {}}
      onReadyChange={() => {}}
    />
  );

  fireEvent.change(screen.getByLabelText("Or paste statement rows"), { target: { value: text } });
}

/**
 * The panel with a real `applyConfig`, so the write settings can be changed and
 * their effect observed. `renderWith` holds the config fixed, which is right
 * for layout assertions and useless for behaviour.
 */
function LiveImportPanel({ text }: { text: string }) {
  const [applyConfig, setApplyConfig] = useState(DEFAULT_APPLY_CONFIG);
  return (
    <ImportPanel
      accountName="Global Money Credit Card"
      matchConfig={DEFAULT_MATCH_CONFIG}
      matchPreset={DEFAULT_TEXT_PRESET}
      applyConfig={applyConfig}
      writeSettingsLocked={false}
      onApplyConfigChange={setApplyConfig}
      profiles={[]}
      onMatchConfigChange={() => {}}
      onApplyProfile={() => {}}
      onSaveProfile={() => {}}
      onReadyChange={() => {}}
    />
  );
}

function renderLive(text: string) {
  render(<LiveImportPanel text={text} />);
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
    for (const heading of ["Date", "Reference", "Amount"]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    // The two text columns now carry a destination tag in their header, so
    // their accessible name is the column name plus where it is going.
    expect(
      within(table).getByRole("columnheader", { name: /^Imported payee →/ })
    ).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /^Notes →/ })).toBeInTheDocument();

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
    expect(screen.getByText(/1 row could not be read/)).toBeInTheDocument();
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
    expect(
      screen.getByLabelText("Report transactions outside the period (days)")
    ).toBeInTheDocument();

    // Moved here from the review screen: the notes source feeds the transform
    // engine, so it has to be settled before any transformation runs.
    expect(screen.getByRole("radio", { name: "The statement's payee" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Leave it to your rules" })).toBeInTheDocument();
    // This fixture is a CSV, where the Notes column mapping is the notes
    // decision — so there is no second control here to contradict it (F-128).
    expect(screen.queryByRole("checkbox", { name: /Use the statement's memo/ })).toBeNull();
    expect(screen.getByText(/column you mapped above the preview/i)).toBeInTheDocument();

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
    expect(screen.getByLabelText(/Use the memo as a fallback for empty payees/)).toBeInTheDocument();

    // And, having no mapping to defer to, it is the format that carries the
    // two notes switches (F-127, F-128).
    expect(
      screen.getByRole("checkbox", { name: /Use the statement's memo/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Also include the statement's payee/ })
    ).toBeInTheDocument();
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

  it("says the bank's text is kept as the imported payee whichever payee you choose", () => {
    renderWith(statement(3));

    // The gap this closes: "Leave it to your rules" read as though the bank's
    // text would be discarded, when it is recorded either way.
    for (const option of ["The statement's payee", "Leave it to your rules"]) {
      const radio = screen.getByRole("radio", { name: option });
      fireEvent.click(radio);
      expect(screen.getByText(/recorded as the imported payee either way|still recorded as the imported payee/i)).toBeInTheDocument();
    }
  });

  it("locks write choices after Apply starts and keeps their focus target visible", () => {
    renderWith(statement(3), true);

    const payeeChoice = screen.getByRole("radio", { name: "The statement's payee" });
    expect(payeeChoice).toBeDisabled();
    expect(payeeChoice.closest("label")).toHaveClass(
      "has-[input:focus-visible]:ring-2"
    );
  });
});

// ─── The preview answers the write settings (F-132) ───────────────────────────

describe("import preview — what the rows will become", () => {
  const QIF = ["!Type:Bank", "D01/08/2026", "T-125.50", "PAMAZON AE", "MOnline purchase", "^"].join(
    "\n"
  );

  function notesCell() {
    return previewRows()[0].querySelectorAll("td")[2];
  }

  it("shows the memo alone by default, and says where it goes", () => {
    renderLive(QIF);

    expect(screen.getByRole("columnheader", { name: /^Notes → memo/ })).toBeInTheDocument();
    expect(notesCell()).toHaveTextContent("Online purchase");
  });

  it("adds the payee, joined, when both switches are on", () => {
    renderLive(QIF);

    fireEvent.click(screen.getByRole("checkbox", { name: /Also include the statement's payee/ }));

    expect(
      screen.getByRole("columnheader", { name: /^Notes → memo \+ payee/ })
    ).toBeInTheDocument();
    expect(notesCell()).toHaveTextContent("Online purchase — AMAZON AE");
  });

  it("says the column is not written when both switches are off", () => {
    renderLive(QIF);

    fireEvent.click(screen.getByRole("checkbox", { name: /Use the statement's memo/ }));

    expect(screen.getByRole("columnheader", { name: /^Notes not written/ })).toBeInTheDocument();
    // Rendered as a decision, not as a parse failure.
    expect(notesCell()).toHaveTextContent("empty");
  });

  it("follows the mapping on a CSV, where there is no control to follow instead", () => {
    renderLive(statement(3));

    expect(screen.getByRole("columnheader", { name: /^Notes → notes/ })).toBeInTheDocument();
    expect(notesCell()).toHaveTextContent("Online purchase");
  });

  it("names where the imported payee is headed, and follows the payee choice", () => {
    renderLive(QIF);

    expect(
      screen.getByRole("columnheader", { name: /^Imported payee → payee & imported payee/ })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Leave it to your rules" }));

    expect(
      screen.getByRole("columnheader", { name: /^Imported payee → imported payee/ })
    ).toBeInTheDocument();
  });
});

// ─── The consumed memo, counted (F-131) ───────────────────────────────────────

describe("import preview — a memo spent as the payee", () => {
  // Two rows with no payee, one with. Under the fallback the first two give up
  // their memo to become the payee, and have nothing left for the notes.
  const QIF = [
    "!Type:Bank",
    "D01/08/2026", "T-125.50", "P", "MDIRECT DEBIT BRITISH GAS", "^",
    "D02/08/2026", "T-14.00", "P", "MSTANDING ORDER GYM", "^",
    "D03/08/2026", "T-9.99", "PAMAZON AE", "MOnline purchase", "^",
  ].join("\n");

  it("says how many rows lost their memo, and what those rows get instead", () => {
    renderLive(QIF);

    const notice = screen.getByRole("status", { name: "" });
    expect(notice).toHaveTextContent(/2 rows have no memo left/);
    expect(notice).toHaveTextContent(/empty notes/);
  });

  it("changes what it promises once the payee is included", () => {
    renderLive(QIF);
    fireEvent.click(screen.getByRole("checkbox", { name: /Also include the statement's payee/ }));

    expect(screen.getByText(/2 rows have no memo left/)).toBeInTheDocument();
    expect(screen.getByText(/the payee only/)).toBeInTheDocument();
  });

  it("disappears when the fallback that caused it is turned off", () => {
    renderLive(QIF);
    fireEvent.click(
      screen.getByLabelText(/Use the memo as a fallback for empty payees/)
    );

    expect(screen.queryByText(/no memo left/)).toBeNull();
  });

  it("never appears for a CSV, which has no fallback", () => {
    renderLive(statement(3));
    expect(screen.queryByText(/no memo left/)).toBeNull();
  });
});

// ─── The duplicate-statement warning (F-126) ──────────────────────────────────

describe("importing a statement that has been seen before", () => {
  const CSV = statement(3);

  /**
   * The statement's fingerprint, taken from the panel's own parse rather than
   * recomputed here — a second parse in the test could agree with the code and
   * still both be wrong.
   */
  function fingerprintOf(text: string): string {
    let fingerprint = "";
    const { unmount } = render(
      <ImportPanel
        accountName="Global Money Credit Card"
        matchConfig={DEFAULT_MATCH_CONFIG}
        matchPreset={DEFAULT_TEXT_PRESET}
        applyConfig={DEFAULT_APPLY_CONFIG}
        writeSettingsLocked={false}
        onApplyConfigChange={() => {}}
        profiles={[]}
        onMatchConfigChange={() => {}}
        onApplyProfile={() => {}}
        onSaveProfile={() => {}}
        onReadyChange={(result) => {
          // Null for an empty statement, which this fixture never is.
          if (result) fingerprint = fingerprintStatement(result.rows) ?? "";
        }}
      />
    );
    fireEvent.change(screen.getByLabelText("Or paste statement rows"), { target: { value: text } });
    unmount();
    return fingerprint;
  }

  function renderKnown(known: {
    status: ReconciliationSessionStatus;
    appliedAt: string | null;
  }) {
    render(
      <ImportPanel
        accountName="Global Money Credit Card"
        matchConfig={DEFAULT_MATCH_CONFIG}
        matchPreset={DEFAULT_TEXT_PRESET}
        applyConfig={DEFAULT_APPLY_CONFIG}
        writeSettingsLocked={false}
        onApplyConfigChange={() => {}}
        profiles={[]}
        knownStatements={[
          {
            fingerprint: fingerprintOf(CSV),
            accountName: "Global Money Credit Card",
            tag: "August 2026",
            createdAt: "2026-09-05T09:00:00.000Z",
            ...known,
          },
        ]}
        onMatchConfigChange={() => {}}
        onApplyProfile={() => {}}
        onSaveProfile={() => {}}
        onReadyChange={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText("Or paste statement rows"), { target: { value: CSV } });
  }

  it("says it was applied, and that anything created is skipped", () => {
    renderKnown({ status: "completed", appliedAt: "2026-09-05T10:00:00.000Z" });

    expect(screen.getByText(/already been applied/)).toBeInTheDocument();
    expect(screen.getByText(/recognised and skipped/)).toBeInTheDocument();
  });

  it("says it was started and not applied, and claims nothing about skipping", () => {
    // The single old message asserted "anything already applied is recognised
    // and skipped" for a session where nothing was applied.
    renderKnown({ status: "needs_review", appliedAt: null });

    expect(screen.getByText(/didn't apply it/)).toBeInTheDocument();
    expect(screen.queryByText(/recognised and skipped/)).toBeNull();
  });

  it("names a failure as a failure", () => {
    renderKnown({ status: "failed", appliedAt: null });

    expect(screen.getByText(/failed/)).toBeInTheDocument();
  });

  it("can be dismissed", () => {
    renderKnown({ status: "needs_review", appliedAt: null });

    fireEvent.click(screen.getByRole("button", { name: /Dismiss the duplicate-statement notice/ }));

    expect(screen.queryByText(/didn't apply it/)).toBeNull();
  });
});
