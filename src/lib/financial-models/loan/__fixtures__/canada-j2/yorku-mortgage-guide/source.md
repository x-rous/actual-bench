# Fixture yorku-mortgage-guide

id: canada-j2-yorku-mortgage-guide
country: CA
currency: CAD
source-name: York University, 'A Guide to Mortgage Interest Calculations in Canada' (course page, author not shown)
source-url: https://www.yorku.ca/amarshal/mortgage.htm
source-type: academic publication
verified: 2026-09-29
conventions: nominal-compounded-semiannual, level-payment, monthly
engine-versions: rate-quote@1, repayment@1, money-kernel@1
coverage: reference

Published worked example: a $100,000 mortgage at 6% compounded semi-annually, 25 years of monthly
payments. The page gives the monthly rate as 0.493862% (from (1 + rM)^12 − 1 = 0.0609), the
present-value factor 156.297225 and the payment $639.81. All three are reproduced independently
(Python decimal at 100 digits and the oracle).
