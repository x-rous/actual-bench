# Fixture unloan-daily-example

id: act365f-unloan-daily-example
country: AU
currency: AUD
source-name: Unloan (a division of Commonwealth Bank of Australia), 'How do banks calculate the interest on my home loan?'
source-url: https://www.unloan.com.au/learn/how-do-banks-calculate-the-interest-on-my-home-loan
source-type: lender publication
verified: 2026-09-29
conventions: actual-365-fixed
engine-versions: daycount-act365f@1, money-kernel@1
coverage: reference

Published worked example, quoted from the page: "($600,000 x 0.045) / 365 = $73.97 interest
charged daily". The page gives no date; any one-day period reproduces it, so the row uses
2024-07-01 to 2024-07-02. The exact value is 73.9726...; the published cents are the same under
half-up, half-even and down, so the example does not pin a rounding mode. `half-up` is an
interpretation.
