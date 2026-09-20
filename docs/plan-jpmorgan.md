# JPMorgan static data plan

Provider-specific decisions behind `api/jpmorgan/**` (the feed
`scripts/update-data.ts` generates) — what am.jpmorgan.com publishes, which
of its endpoints the updater reads, how the shared catalog columns are
derived from them, and which values legitimately stay `—`. The shared UI
behaviour lives in [`ui-contract.md`](./ui-contract.md) and
[`catalog-ui-requirements.md`](./catalog-ui-requirements.md).

## 1. Provider research (live, September 2026)

| Question | Finding |
| --- | --- |
| Catalog | The ETF fund explorer (`https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf`) is rendered client-side from `https://am.jpmorgan.com/FundsMarketingHandler/fund-explorer?country=us&role=adv&userLoggedIn=false&language=en&fundType=etf` — one JSON array with every listed US JPMorgan ETF share class (78 funds at the time of writing). Every entry carries ticker, CUSIP (`identifier`), legal name, asset class, fund inception, NAV + NAV date, market price, premium/discount (percent), net assets (dollars), month-end 30-day SEC yield (fraction) and the official month-end + quarter-end returns "At NAV" and at market price (fractions; annualized beyond one year). It carries **no** expense ratio, dividend yield or distribution frequency (those fields are `null` for every fund). |
| Fund page | `https://am.jpmorgan.com/us/en/asset-management/adv/products/<name-slug>-etf-shares-<cusip>` — the CUSIP suffix is what the server resolves, the slug is cosmetic. The page's fund facts, expenses, yields, performance tables and dividend schedule are rendered client-side from `FundsMarketingHandler/product-data?cusip=<CUSIP>&country=us&role=adv&language=en&userLoggedIn=false` (`fundData.shareClass` = facts, expenses, yields, returns, latest dividend; `fundData.dailyHoldingsAll.data` = the **complete** daily holdings list, the same rows as the "Download holdings" workbook plus the security identifier — CUSIP for US securities, SEDOL for foreign ones). The static HTML contains none of it, so the JSON is the machine source. |
| History | `FundsMarketingHandler/historicalData?cusip=<CUSIP>&…` returns the NAV, closing market price and premium/discount for **every business day since inception** (`historicalETFClosingPriceList`, e.g. 1,591 rows for JEPI, 2,348 for JPST), the dividend schedule (`dividendsDistributionHistoryList`: the last twelve payments with ex/record/pay dates, amount and reinvestment NAV), the monthly return chart, calendar-year returns and the official **quarter-end** returns (`quarterlyPerformanceReturns`). |
| Human downloads | `FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=…` (holdings workbook, no identifiers), `excel?type=historicalNav&cusip=…&fromDate=…&toDate=…` (NAV + market price workbook) and `excel?type=performanceChart&cusip=…` (growth of $10,000). Recorded as provenance links in `meta.json`; the JSON endpoints above are the machine source. `excel?type=dividendHistory` answers an empty file even with a date range. |
| Catalog fallback | The public early-NAV report `https://am.jpmorgan.com/content/dam/jpm-am-aem/americas/us/en/supplemental/early-nav-report/jpm-early-nav-etf.csv` (name, ticker, CUSIP, NAV, net assets for every ETF — no returns or categories). |
| SEC | Every listed ticker maps to the **J.P. Morgan Exchange-Traded Fund Trust** (CIK 0001485894) in `https://www.sec.gov/files/company_tickers_mf.json`, so the shared EDGAR N-PORT-P fallback works for the whole line-up without a hand-kept CIK table. |
| Yahoo | The chart API answers HTTP 429 to the first request from GitHub Actions runners. It is therefore never the primary source here — it stays an optional fallback for a fund whose official history is unavailable. |
| Access | am.jpmorgan.com answers a plain browser `User-Agent` with `Accept: application/json`; no cookies, tokens or logged-in role are required. |

## 2. Source ladder

Every value is filled from the best available source in this order; the
Overview tab and `meta.json` record which one supplied it.

| Block | 1st | 2nd | 3rd |
| --- | --- | --- | --- |
| Catalog (tickers, names, asset class, CUSIP, inception, NAV/price/premium, net assets, month-end SEC yield, official returns) | fund explorer JSON | early-NAV report CSV | previously published `index.json` + SEC registrant table (`source: 'seed'`) |
| Expense ratio (gross → *Expense* column; net kept alongside), exchange, ISIN, shares outstanding, holdings count | product-data JSON | previous index | `—` |
| Dividend yield | product-data 12-month rolling yield (daily) | product-data month-end yield | indicated: latest distribution × payments per year ÷ market price |
| 30-day SEC yield | product-data daily `etfSecYield` | product-data month-end / fund explorer | 7-day SEC yield (money market fund) |
| Returns (YTD, 1Y, 3Y, 5Y, 10Y, SI; 1-month) | product-data "At NAV" month-end block + cumulative block | fund explorer month-end block | derived from the official daily NAV history with the published distributions reinvested (`priceReturns`) |
| Quarter-end returns | historicalData `quarterlyPerformanceReturns` ("At NAV") | fund explorer quarter-end block | — |
| Holdings | product-data `dailyHoldingsAll` (other full-list containers if empty) | SEC EDGAR N-PORT-P | previously published pages |
| History | historicalData daily NAV / market price / premium-discount | Yahoo chart API (unless `SKIP_YAHOO`) | previously published pages |
| Distributions | historicalData dividend schedule | product-data latest dividend | Yahoo dividend events (fallback path) |
| Frequency | product-data `dividendsFrequency` code (`MDEC` monthly, `QDEC` quarterly, `SDEC` semi-annual, `YDEC` annual) | cadence inferred from the dividend ex-dates | previous run |

## 3. Column derivation

- `ytd`, `tr1y`, `cagr3y`, `cagr5y`, `cagr10y`, `siAnn` — official JPMorgan
  **NAV total returns** (fractions × 100, rounded to 4 decimals) → *YTD
  Return*, *TR 1Y*, *CAGR 3Y/5Y/10Y*, *SI Ann.*
- `tr3y`, `tr5y`, `tr10y` — the official **cumulative** figures from
  product-data (`cumulativePerformanceReturns`, "At NAV"); when a fund lacks
  that block the exact inverse `(1 + CAGR nY)^n − 1` is used.
- `mo1` — the official one-month return; `qtd` — derived from the daily NAV
  history with the published distributions reinvested at the reinvestment
  NAV (a NAV total-return index; JPMorgan publishes no quarter-to-date figure).
- `siAnn` is published only for funds at least one year old: JPMorgan reports
  the since-inception return of younger funds **cumulatively**, so publishing
  it under "SI Ann." would mislabel it. Funds between 0.75 and 1 year old get
  the annualized NAV total return derived from the daily history, younger
  funds stay `—`.
- Derived windows are only computed where the reinvestment index is complete
  (`reinvestmentCoverageStart`): the fund page's dividend schedule is capped
  at the last twelve payments, so for a fund that has paid more than twelve
  times the index is trusted from one payment interval before the earliest
  listed ex-date. Older windows (e.g. the since-inception window of a weekly
  payer) stay `—` instead of understating the return.
- Frequency words are the ones the shared `formatDividendFrequency` codes:
  `Monthly`, `Quarterly`, `Semi-annually`, `Annually` (plus `Daily`/`Weekly`
  raw when a fund declares them and the cadence cannot be inferred).
- Holdings rows: `Name` = security description, `Ticker` = exchange symbol
  for equity-like security types only (bond, money-market paper, repo,
  currency and derivative rows carry issuer codes such as `T` or `COF` in
  the source, which are blanked to `-` so the Watchlist keys them by
  `Identifier`), `Identifier` = CUSIP / SEDOL, `Weight` = `% of net assets`,
  `Market Value`, `Shares Held`, `Asset Category` = security type, plus
  `Coupon` / `Maturity` when any row has them (bond funds).
- History rows: `Date`, `NAV`, `Market Price`, `Premium/Discount`, oldest
  first; the Yahoo fallback keeps the sibling layout `Date`, `Close`,
  `Adj Close`, `Volume`.

## 4. Documented gaps (`—` with a reason)

| Value | When it is `—` | Why |
| --- | --- | --- |
| YTD Return | funds launched in the current calendar year (JIDE 2026-01-27, ROCQ / ROCY 2026-03-18, JPFP 2026-05-27, JLVP 2026-07-30) | JPMorgan publishes no YTD figure for them and a partial-year YTD would not be comparable; the Overview shows the derived 1-month and quarter-to-date figures instead. |
| TR/CAGR 3Y, 5Y, 10Y | funds younger than the period (at the time of writing 20 funds lack 3Y, 33 lack 5Y, 60 lack 10Y) | not applicable (the same rule as every sibling feed); a window is also left `—` when JPMorgan publishes no figure and the reinvestment index cannot cover it (BBHY's 10Y until its tenth anniversary is reported officially). |
| TR 1Y | funds younger than one year (the five above plus JMMF, 2025-12-10) | not applicable. |
| SI Ann. | funds younger than 0.75 years; a 0.75–1 year old fund that has already paid more than twelve distributions | JPMorgan's since-inception figure for them is cumulative, and annualizing a sub-year return would be misleading; for the frequent payer the capped dividend schedule cannot rebuild the since-launch total return (JMMF, a weekly-paying money market ETF launched 2025-12-10). |
| Dividend Yield | funds that have not paid a distribution yet (JIDE, JPFP, JLVP — annual payers launched in 2026) | nothing to compute a trailing or indicated yield from. |
| SEC Yield | only if JPMorgan publishes neither a 30-day nor a 7-day figure (JTEK at the time of writing) | recorded as "not published by JPMorgan for this fund" in `meta.json`. |
| QTD (Overview only) | ETF share classes that did not exist on the first day of the quarter: JLVP (launched 2026-07-30) and the mutual-fund conversions JPRF / LGDS (ETF shares since 2026-07-10; their official returns carry the predecessor fund's record) | the daily NAV history starts after the quarter began, so no quarter-to-date figure can be derived; JPMorgan publishes none either. |
| Distributions rows | limited to the last twelve payments | that is what the fund page's dividend schedule publishes; older payments are not exposed by any public JPMorgan endpoint. |

Everything else — NAV, net assets, expense ratio, exchange, inception,
frequency, holdings count and as-of date, history count — is published for
every fund (78 funds, 42,401 holdings rows and 90,939 history rows in the
first full pass, 0 failures).

## 5. Determinism and freshness

- Per-fund files are rewritten only when their content changes
  (`writeIfChanged`), pages are removed when a fund shrinks, and numbers are
  written as plain decimal strings. Holdings rows keep the published
  descending-weight order with a canonical tie-break (market value, name,
  identifier, ticker — `compareHoldingRows`) because am.jpmorgan.com answers
  equal rows (zero-weight currency contracts, equal lots) in a different
  order from one request to the next. Two runs against unchanged sources
  differ only in `index.json#generatedAt` and `update-state.json#savedAt`
  (the sibling convention).
- `api/jpmorgan/raw/**` is written only with `STORE_RAW_DOWNLOADS=1` (never
  by the workflow).
- The workflow is `workflow_dispatch` only and commits `api/jpmorgan/**`
  alone as `github-actions[bot]`.

## 6. Verification

```bash
bun install --frozen-lockfile
bun test
bunx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --types bun,node --skipLibCheck scripts/update-data.ts scripts/update-data.test.ts
bun ./scripts/check-index.ts
git diff --check
```

`scripts/update-data.test.ts` covers the fund-explorer, early-NAV,
product-data, holdings and historicalData parsers with trimmed copies of the
live payloads; `scripts/ui.test.ts` boots the real `app.tsx` against the
generated feed.
