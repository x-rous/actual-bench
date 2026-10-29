import { render, screen } from "@testing-library/react";
import { HeadlineMetrics } from "./HeadlineMetrics";
import type { Headline } from "../../lib/results";

const headline: Headline = { regularRepaymentMinor: 837_957, repaymentChanges: false, totalRepaidMinor: 40_211_273, totalInterestMinor: 5_211_273, payoffDate: "2027-11-01", closingBalanceMinor: 0 };

describe("the headline figures of a tracked loan", () => {
  it("say how many installments are paid and how much has been repaid, under the first two figures", () => {
    render(<HeadlineMetrics headline={headline} deltas={null} digits={2} frequencyLabel="monthly" announce={null} calculating={false}
      details={{ interest: "Paid so far 48,798.24 · still to pay 3,315.00", payoff: "1 yr left", repayment: "36 of 48 installments paid · 12 left", repaid: "Paid so far 301,665.00 · still to pay 100,447.73" }} />);
    expect(screen.getByText("36 of 48 installments paid · 12 left")).toBeInTheDocument();
    expect(screen.getByText("Paid so far 301,665.00 · still to pay 100,447.73")).toBeInTheDocument();
    expect(screen.getByText("Paid so far 48,798.24 · still to pay 3,315.00")).toBeInTheDocument();
  });

  it("show nothing extra for a loan that is only a calculation", () => {
    render(<HeadlineMetrics headline={headline} deltas={null} digits={2} frequencyLabel="monthly" announce={null} calculating={false} details={{ interest: "Paid so far 0.00 · still to pay 5,211.27", payoff: "2 yrs left" }} />);
    expect(screen.queryByText(/installments? paid/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Paid so far/)).toHaveLength(1);
  });
});
