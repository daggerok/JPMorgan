// Bun's test runner provides these globals at runtime.
// @ts-ignore bun types are intentionally not required for this zero-dependency Bun script.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  parseRange,
  parseAumRange,
  normalizeNumberText,
  parseCsv,
  findHeaderRowIndex,
  csvRecords,
  pickColumn,
  normalizeJpmorganCategory,
  parseFundExplorer,
  parseEarlyNavCsv,
  parseProductData,
  parseProductHoldings,
  parseHistoricalData,
  navTotalReturnDays,
  holdingTickerFor,
  decodeDividendFrequency,
  annualizedSinceInception,
  weightsSum,
  parseNport,
  parseNportAccessions,
  nportUrlFor,
  pickEftsCik,
  parseFundTickerMap,
  parseCompanyTickerMap,
  edgarSeriesFilingsUrl,
  parseEdgarAtomFilings,
  parseChart,
  priceReturns,
  lastCompletedQuarterEnd,
  annualizedToTotal,
  totalToAnnualized,
  indicatedYield,
  inferDistributionFrequency,
  deriveCatalogMetrics,
  formatEdgarDate,
  formatJpmorganDate,
  fractionToPercent,
  toIsoDate,
  isoToEpoch,
  epochToIsoDate,
  numberOrNull,
  normalizeHoldingName,
  normalizeHoldingNameCore,
  cleanHoldingTicker,
  fundNameSlug,
  jpmorganFundPageUrl,
  jpmorganFundExplorerUrl,
  jpmorganProductDataUrl,
  jpmorganHistoricalDataUrl,
  jpmorganHoldingsDownloadUrl,
  jpmorganPricesDownloadUrl,
  HOLDINGS_HEADERS,
  BOND_SHEET_HEADERS,
  HISTORY_HEADERS,
  YAHOO_HISTORY_HEADERS,
} from './update-data';

// ---------------------------------------------------------------------------
// Range parsers (same contract as daggerok/iShares, daggerok/SPDR, daggerok/Fidelity)
// ---------------------------------------------------------------------------

describe('parseRange', () => {
  test('empty and ":" mean no restriction', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
  });

  test('inclusive bounds', () => {
    expect(parseRange('1:5', 'X')).toEqual({ min: 1, max: 5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(parseRange(':3', 'X')).toEqual({ min: undefined, max: 3 });
  });

  test('percent signs and $ signs are optional', () => {
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('$1:$2', 'X')).toEqual({ min: 1, max: 2 });
  });

  test('colonless values are rejected', () => {
    expect(() => parseRange('15', 'X')).toThrow(/colon is required/);
  });

  test('min greater than max is rejected', () => {
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
  });
});

describe('parseAumRange', () => {
  test('empty and ":" mean no restriction', () => {
    expect(parseAumRange('')).toBeUndefined();
    expect(parseAumRange(':')).toBeUndefined();
  });

  test('numeric bounds with K/M/B/T suffixes', () => {
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('1B:')).toEqual({ min: 1_000_000_000, max: undefined });
  });

  test('preset bounds', () => {
    expect(parseAumRange('nano')).toEqual({ min: 0, max: 10_000_000 });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(parseAumRange('small')).toEqual({ min: 300_000_000, max: 2_000_000_000 });
    expect(parseAumRange('mid')).toEqual({ min: 2_000_000_000, max: 10_000_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
  });

  test('colonless values are rejected', () => {
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
  });
});

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

describe('normalizeNumberText', () => {
  test('expands scientific notation', () => {
    expect(normalizeNumberText('2.97057744E8')).toBe('297057744');
    expect(normalizeNumberText('1.5e-3')).toBe('0.0015');
  });

  test('keeps plain numbers and text untouched', () => {
    expect(normalizeNumberText('1,234.56')).toBe('1234.56');
    expect(normalizeNumberText('Apple Inc')).toBe('Apple Inc');
    expect(normalizeNumberText('')).toBe('');
    expect(normalizeNumberText('-')).toBe('-');
  });
});

describe('numberOrNull', () => {
  test('accepts the am.jpmorgan.com placeholder styles', () => {
    expect(numberOrNull('--')).toBeNull();
    expect(numberOrNull('—')).toBeNull();
    expect(numberOrNull('N/A')).toBeNull();
    expect(numberOrNull('4.56')).toBe(4.56);
    expect(numberOrNull('$1,234.56')).toBe(1234.56);
    expect(numberOrNull('0.40%')).toBe(0.4);
  });
});

describe('toIsoDate / formatJpmorganDate / formatEdgarDate', () => {
  test('US and ISO dates both normalize to ISO', () => {
    expect(toIsoDate('08/21/2026')).toBe('2026-08-21');
    expect(toIsoDate('2026-08-21')).toBe('2026-08-21');
    expect(toIsoDate('2026-8-1')).toBe('2026-08-01');
    expect(toIsoDate('n/a')).toBe('n/a');
  });

  test('JPMorgan workbooks render MM/DD/YYYY, the feed renders "Mon D YYYY"', () => {
    expect(formatJpmorganDate('2026-08-21')).toBe('08/21/2026');
    expect(formatEdgarDate('2026-06-30')).toBe('Jun 30 2026');
  });

  test('epoch days convert to ISO', () => {
    expect(isoToEpoch('2026-01-15')).toBe(Date.UTC(2026, 0, 15) / 1000);
    expect(isoToEpoch('nope')).toBeNull();
  });
});

describe('parseCsv / header detection', () => {
  test('handles quotes, embedded commas and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  test('drops blank lines and strips a BOM', () => {
    const rows = parseCsv('\uFEFFTicker,Name\r\n\r\nJEPI,JPMorgan Equity Premium Income ETF\r\n');
    expect(rows).toEqual([
      ['Ticker', 'Name'],
      ['JEPI', 'JPMorgan Equity Premium Income ETF'],
    ]);
  });

  test('finds the header row after preamble lines', () => {
    const rows = parseCsv(['J.P. Morgan Asset Management', 'Early NAV report', '', EARLY_NAV_FIXTURE].join('\n'));
    const headerIndex = findHeaderRowIndex(rows, ['Ticker', 'CUSIP', 'NAV']);
    expect(headerIndex).toBe(2);
    expect(rows[headerIndex][0]).toBe('Date');
    expect(findHeaderRowIndex(rows, ['Nope'])).toBe(-1);
  });

  test('csvRecords keeps the first of two identically named columns', () => {
    const rows = parseCsv('Fund Ticker,Ticker,Name\nQQQ,QQQ,Apple Inc');
    const records = csvRecords(rows, 0);
    expect(pickColumn(records[0], ['Ticker'])).toBe('QQQ');
    expect(pickColumn(records[0], ['Name'])).toBe('Apple Inc');
    expect(pickColumn(records[0], ['Missing'])).toBe('');
  });

  test('csvRecords skips empty rows and trims cells', () => {
    const rows = parseCsv('Ticker,Name\n JEPI , JPMorgan Equity Premium Income ETF \n,,\n');
    expect(csvRecords(rows, 0)).toEqual([{ Ticker: 'JEPI', Name: 'JPMorgan Equity Premium Income ETF' }]);
  });
});

// ---------------------------------------------------------------------------
// Catalog layer: the fund explorer JSON and the early-NAV CSV fallback
// ---------------------------------------------------------------------------

// A trimmed copy of three am.jpmorgan.com fund-explorer entries (fractions for
// yields/returns, percent for premium/discount, dollars for net assets).
const FUND_EXPLORER_FIXTURE = [
  {
    ticker: 'JEPI',
    identifier: '46641Q332',
    name: 'JPMorgan Equity Premium Income ETF',
    displayName: 'Equity Premium Income ETF',
    assetClass: 'U.S. Equity',
    fundTypeCode: 'N_ETF',
    assetsUnderManagement: 45123456789.12,
    nav: 56.2213,
    navDate: '2026-09-18',
    marketPrice: 56.24,
    premiumDiscountPercentage: 0.0332,
    secYield: 0.0744,
    unsubSecYield: 0.0744,
    secYieldEffectiveDate: '2026-08-31',
    fundInceptionDate: '2020-05-20',
    ytdReturn: 0.0372,
    ytdReturnEffectiveDate: '2026-09-18',
    performanceReturnEffectiveDate: '2026-08-31',
    performanceReturnEffectiveDateForQuarterEnd: '2026-06-30',
    atNavPerformanceReturn: { ytd: 0.0536, mt1: 0.0153, mt3: 0.0402, yr1: 0.0905, yr3: 0.0951, yr5: 0.1002, yr10: null, inception: 0.1125 },
    marketPriceReturns: { ytd: 0.0541, mt1: 0.0155, yr1: 0.0908, yr3: 0.0952, yr5: 0.1003, yr10: null, inception: 0.1126 },
    atNavPerformanceReturnForQuarterEnd: { ytd: 0.022, yr1: 0.0777, yr3: 0.0899, yr5: 0.0747, yr10: null, inception: 0.1082 },
    ongoingCharge: null,
    distributionFrequency: null,
  },
  {
    ticker: 'JPST',
    identifier: '46641Q837',
    name: 'JPMorgan Ultra-Short Income ETF',
    assetClass: 'Fixed Income Taxable',
    fundTypeCode: 'N_ETF',
    assetsUnderManagement: 33000000000,
    nav: 50.71,
    navDate: '2026-09-18',
    marketPrice: 50.72,
    premiumDiscountPercentage: 0.02,
    secYield: 0.0421,
    fundInceptionDate: '2017-05-17',
    performanceReturnEffectiveDate: '2026-08-31',
    atNavPerformanceReturn: { ytd: 0.0311, mt1: 0.0026, yr1: 0.0409, yr3: 0.0517, yr5: 0.0367, yr10: null, inception: 0.031 },
    atNavPerformanceReturnForQuarterEnd: { ytd: 0.0166, yr1: 0.0409, yr3: 0.0517, yr5: 0.0367, yr10: null, inception: 0.0305 },
  },
  {
    ticker: 'JLVP',
    identifier: '46654Q443',
    name: 'JPMorgan Active Value Plus ETF',
    assetClass: 'U.S. Equity',
    fundTypeCode: 'N_ETF',
    assetsUnderManagement: 27260413.79,
    nav: 49.56438871,
    navDate: '2026-09-18',
    marketPrice: 49.56,
    premiumDiscountPercentage: -0.0089,
    secYield: null,
    fundInceptionDate: '2026-07-30',
    performanceReturnEffectiveDate: '2026-08-31',
    atNavPerformanceReturn: { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, inception: 0.019 },
  },
  { ticker: 'JMFXX', identifier: '4812C0555', name: 'JPMorgan Prime Money Market Fund', assetClass: 'Money Market', fundTypeCode: 'N_MF' },
];

describe('parseFundExplorer', () => {
  const funds = parseFundExplorer(FUND_EXPLORER_FIXTURE);

  test('reads the ETF entries, alphabetized, and drops other fund types', () => {
    expect(funds.map((fund) => fund.ticker)).toEqual(['JEPI', 'JLVP', 'JPST']);
    expect(funds.every((fund) => fund.source === 'jpmorgan')).toBe(true);
  });

  test('keeps the CUSIP, asset class, inception and the fund page URL', () => {
    const jepi = funds.find((fund) => fund.ticker === 'JEPI')!;
    expect(jepi.cusip).toBe('46641Q332');
    expect(jepi.name).toBe('JPMorgan Equity Premium Income ETF');
    expect(jepi.category).toBe('U.S. Equity');
    expect(jepi.inception).toBe('2020-05-20');
    expect(jepi.asOfDate).toBe('2026-09-18');
    expect(jepi.fundPage).toBe('https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-etf-shares-46641q332');
    expect(jepi.trustCik).toBe('0001485894');
  });

  test('reads NAV, market price, premium/discount and net assets as numbers', () => {
    const jepi = funds.find((fund) => fund.ticker === 'JEPI')!;
    expect(jepi.nav).toBe(56.2213);
    expect(jepi.close).toBe(56.24);
    expect(jepi.premiumDiscount).toBe(0.0332);
    expect(jepi.netAssets).toBe(45123456789.12);
  });

  test('converts fraction yields and returns to percent, keeping missing ones null', () => {
    const jepi = funds.find((fund) => fund.ticker === 'JEPI')!;
    expect(jepi.secYield).toBe(7.44);
    expect(jepi.returns).toEqual({ ytd: 5.36, yr1: 9.05, yr3: 9.51, yr5: 10.02, yr10: null, sinceInception: 11.25 });
    expect(jepi.returnsAsOfDate).toBe('2026-08-31');
    expect(jepi.marketReturns.yr1).toBe(9.08);
    expect(jepi.quarterEnd).toEqual({ ytd: 2.2, yr1: 7.77, yr3: 8.99, yr5: 7.47, yr10: null, sinceInception: 10.82 });
    expect(jepi.quarterEndAsOfDate).toBe('2026-06-30');
    const jlvp = funds.find((fund) => fund.ticker === 'JLVP')!;
    expect(jlvp.secYield).toBeNull();
    expect(jlvp.returns.ytd).toBeNull();
    expect(jlvp.returns.sinceInception).toBe(1.9);
    expect(jlvp.quarterEndAsOfDate).toBeNull();
  });

  test('the explorer carries no expense ratio or dividend yield (product-data does)', () => {
    expect(funds.every((fund) => fund.ter === null && fund.dividendYield === null)).toBe(true);
  });

  test('accepts the wrapped payload shapes and rejects anything else', () => {
    expect(parseFundExplorer({ funds: FUND_EXPLORER_FIXTURE }).length).toBe(3);
    expect(parseFundExplorer({ data: FUND_EXPLORER_FIXTURE }).length).toBe(3);
    expect(() => parseFundExplorer({ error: 'nope' })).toThrow(/not a fund list/);
  });
});

const EARLY_NAV_FIXTURE = [
  'Date, Fund Name, Ticker, CUSIP, NAV, Previous NAV, NAV Change, % OF NAV Change, Net Assets, Shares Outstanding, Distribution Factor, ST Cap Gains, LT Cap Gains',
  '09/18/2026, JPMorgan Equity Premium Income ETF, JEPI, 46641Q332, 56.2213, 56.4101, -0.1888, -0.33, 45123456789.12, 802600000, 0.00000000, 0.00000000, 0.00000000',
  '09/18/2026, JPMorgan Ultra-Short Income ETF, JPST, 46641Q837, 50.7100, 50.7000, 0.0100, 0.02, 33000000000, 650000000, 0.00000000, 0.00000000, 0.00000000',
  '',
  'The early NAV report is provided for informational purposes only and is subject to change.',
].join('\r\n');

describe('parseEarlyNavCsv (catalog fallback)', () => {
  test('reads ticker, CUSIP, NAV and net assets despite the padded headers', () => {
    const funds = parseEarlyNavCsv(EARLY_NAV_FIXTURE);
    expect(funds.map((fund) => fund.ticker)).toEqual(['JEPI', 'JPST']);
    const jepi = funds[0];
    expect(jepi.cusip).toBe('46641Q332');
    expect(jepi.name).toBe('JPMorgan Equity Premium Income ETF');
    expect(jepi.nav).toBe(56.2213);
    expect(jepi.netAssets).toBe(45123456789.12);
    expect(jepi.asOfDate).toBe('2026-09-18');
    expect(jepi.source).toBe('early-nav');
    expect(jepi.fundPage).toContain('-etf-shares-46641q332');
  });

  test('rejects a file without the ETF columns', () => {
    expect(() => parseEarlyNavCsv('Fund Name,Price\nX,1')).toThrow(/header row not found/);
  });
});

describe('normalizeJpmorganCategory', () => {
  test('keeps the published asset class and repairs its punctuation', () => {
    expect(normalizeJpmorganCategory('U.S. Equity')).toBe('U.S. Equity');
    expect(normalizeJpmorganCategory('  Fixed Income   Taxable ')).toBe('Fixed Income Taxable');
    expect(normalizeJpmorganCategory('')).toBe('ETF');
    expect(normalizeJpmorganCategory(null)).toBe('ETF');
  });
});

// ---------------------------------------------------------------------------
// Product-data layer
// ---------------------------------------------------------------------------

const PRODUCT_DATA_FIXTURE = {
  fundData: {
    name: 'JPMorgan Equity Premium Income ETF',
    assetClass: 'U.S. Equity',
    fundInceptionDate: '2020-05-20',
    dividendsFrequency: 'MDEC',
    numberOfHoldings: 135,
    numberOfHoldingsEffectiveDate: '2026-09-17',
    benchmarks: [{ benchmark: { name: 'S&P 500 Index' } }],
    shareClass: {
      ticker: 'JEPI',
      cusip: '46641Q332',
      isin: null,
      shareClassInceptionDate: '2020-05-20',
      tradingInfo: { exchange: 'NYSE-Arca' },
      expenses: { netExpense: 0.35, grossExpense: 0.35 },
      fees: { expenseRatio: 0.35 },
      nav: { price: 56.2213, date: '2026-09-18', marketValueNavPrice: 56.24 },
      marketPrice: { amount: 56.24, date: '2026-09-18', premiumDiscountPercentage: 0.0332 },
      netGrossAssetClass: 45123456789.12,
      grossAssetClassEffectiveDate: '2026-09-18',
      sharesOutstanding: 802600000,
      secYield: { dividendYield: 0.0842, effectiveDate: '2026-09-18' },
      yieldMonthEnd: { effectiveDate: '2026-08-31', dividendYield: 0.0839, thirtyDaySecYield: 0.0744, thirtyDayUnsubSecYield: 0.0744, twlvMthSimpleYield: 0.0841 },
      etfSecYield: { thirtyDaySecYield: 0.0759, thirtyDayUnsubSecYield: 0.0759, effectiveDate: '2026-09-17' },
      fundShareclassDividend: { exDate: '2026-09-01', dividendAmount: 0.37421, payDate: '2026-09-04', recordDate: '2026-09-01' },
      performanceReturns: [
        { performanceFactor: 'At NAV', oneMonth: 0.0153, threeMonths: 0.0402, ytd: 0.0536, oneYear: 0.0905, threeYears: 0.0951, fiveYears: 0.1002, tenYears: null, inception: 0.1125, effectiveDate: '2026-08-31' },
        { performanceFactor: 'Market Price Returns', oneMonth: 0.0155, ytd: 0.0541, oneYear: 0.0908, threeYears: 0.0952, fiveYears: 0.1003, tenYears: null, inception: 0.1126, effectiveDate: '2026-08-31' },
        { performanceFactor: 'S&P 500 Index', ytd: 0.11, oneYear: 0.17, effectiveDate: '2026-08-31' },
      ],
      cumulativePerformanceReturns: [
        { performanceFactor: 'At NAV', oneYear: 0.0905, threeYears: 0.3133, fiveYears: 0.6117, tenYears: null, inception: 0.9524, effectiveDate: '2026-08-31' },
        { performanceFactor: 'Market Price Returns', oneYear: 0.0908, threeYears: 0.3137, fiveYears: 0.6125, tenYears: null, inception: 0.9535, effectiveDate: '2026-08-31' },
      ],
    },
    dailyHoldingsAll: {
      effectiveDate: '2026-09-17',
      data: [
        { securityDescription: 'NVIDIA CORP COMMON', securityId: '67066G104', securityTicker: 'NVDA', securityType: 'DOMESTIC COMMON STOCK', shares: 4301234, marketValue: 879922379.14, netAssetValuePercent: 1.94, marketValuePercent: 1.95, country: 'United States', currencyCode: 'USD' },
        { securityDescription: 'SPX 09/22/2026 5990 ELN', securityId: '46654Q104', securityTicker: 'SPX', securityType: 'EQUITY LINKED NOTES', shares: 11500000, marketValue: 120345678.9, netAssetValuePercent: 0.27 },
        { securityDescription: 'JPMORGAN PRIME MONEY', securityId: '46637K844', securityTicker: 'JIMXX', securityType: 'MONEY MARKET', shares: 934627, marketValue: 934534.38, netAssetValuePercent: 0.01 },
        { securityDescription: 'USD CASH', securityId: null, securityTicker: null, securityType: 'CURRENCIES', shares: 1000, marketValue: 1000, netAssetValuePercent: 0 },
        { securityDescription: 'MITSUBISHI UFJ FINANCIAL', securityId: '6335171', securityTicker: '8306', securityType: 'FOREIGN COMMON STOCK', shares: 100, marketValue: 1000, netAssetValuePercent: 0.01 },
        { securityDescription: '', securityId: 'IGNORED', securityTicker: 'X', securityType: 'DOMESTIC COMMON STOCK', shares: 1, marketValue: 1, netAssetValuePercent: 0.01 },
      ],
    },
  },
};

describe('parseProductData', () => {
  const product = parseProductData(PRODUCT_DATA_FIXTURE, 'JEPI');

  test('reads the fund facts, exchange, expenses and inception', () => {
    expect(product.ticker).toBe('JEPI');
    expect(product.name).toBe('JPMorgan Equity Premium Income ETF');
    expect(product.cusip).toBe('46641Q332');
    expect(product.exchange).toBe('NYSE-Arca');
    expect(product.grossExpense).toBe(0.35);
    expect(product.netExpense).toBe(0.35);
    expect(product.inception).toBe('2020-05-20');
    expect(product.assetClass).toBe('U.S. Equity');
    expect(product.benchmark).toBe('S&P 500 Index');
    expect(product.frequencyCode).toBe('MDEC');
    expect(product.numberOfHoldings).toBe(135);
    expect(product.sharesOutstanding).toBe(802600000);
  });

  test('prefers the daily 30-day SEC yield and the 12-month rolling dividend yield', () => {
    expect(product.secYield).toBe(7.59);
    expect(product.secYieldDate).toBe('2026-09-17');
    expect(product.secYieldKind).toContain('daily');
    expect(product.dividendYield).toBe(8.42);
    expect(product.dividendYieldDate).toBe('2026-09-18');
    expect(product.dividendYieldKind).toContain('12-month rolling');
  });

  test('falls back to the month-end yields when the daily blocks are empty', () => {
    const payload = structuredClone(PRODUCT_DATA_FIXTURE);
    payload.fundData.shareClass.etfSecYield = {} as any;
    payload.fundData.shareClass.secYield = {} as any;
    const fallback = parseProductData(payload, 'JEPI');
    expect(fallback.secYield).toBe(7.44);
    expect(fallback.secYieldKind).toContain('month-end');
    expect(fallback.dividendYield).toBe(8.39);
    expect(fallback.dividendYieldKind).toContain('month-end');
  });

  test('reads NAV, market price, premium/discount, net assets and the latest dividend', () => {
    expect(product.nav).toBe(56.2213);
    expect(product.navDate).toBe('2026-09-18');
    expect(product.marketPrice).toBe(56.24);
    expect(product.premiumDiscount).toBe(0.0332);
    expect(product.netAssets).toBe(45123456789.12);
    expect(product.netAssetsDate).toBe('2026-09-18');
    expect(product.latestDividend).toEqual({ exDate: '2026-09-01', amount: 0.37421, payDate: '2026-09-04', recordDate: '2026-09-01' });
  });

  test('keeps the official "At NAV" month-end returns, 1-month included, and the cumulative block', () => {
    expect(product.monthEnd).toEqual({ ytd: 5.36, yr1: 9.05, yr3: 9.51, yr5: 10.02, yr10: null, sinceInception: 11.25, asOfDate: '2026-08-31', mo1: 1.53, mo3: 4.02 });
    expect(product.monthEndMarket.yr1).toBe(9.08);
    expect(product.cumulative).toEqual({ yr1: 9.05, yr3: 31.33, yr5: 61.17, yr10: null, sinceInception: 95.24 });
    expect(product.cumulativeAsOfDate).toBe('2026-08-31');
  });

  test('rejects an empty product-data answer (unknown CUSIP)', () => {
    expect(() => parseProductData({ fundData: null, error: null }, 'XXXX')).toThrow(/no fundData/);
  });
});

describe('parseProductHoldings', () => {
  const holdings = parseProductHoldings(PRODUCT_DATA_FIXTURE.fundData, 'JEPI')!;

  test('normalizes to the shared sheet headers and keeps the as-of date', () => {
    expect(holdings.headers).toEqual(HOLDINGS_HEADERS);
    expect(holdings.asOfDate).toBe('2026-09-17');
    expect(holdings.rows.length).toBe(5); // the nameless row is dropped
    expect(holdings.rows[0]).toEqual({
      Name: 'NVIDIA CORP COMMON',
      Ticker: 'NVDA',
      Identifier: '67066G104',
      Weight: '1.94',
      'Market Value': '879922379.14',
      'Shares Held': '4301234',
      'Asset Category': 'DOMESTIC COMMON STOCK',
    });
  });

  test('rows without an exchange ticker keep "-" (Watchlist keys them by Identifier)', () => {
    const eln = holdings.rows.find((row) => row.Name.startsWith('SPX'))!;
    expect(eln.Ticker).toBe('-'); // "SPX" is the underlying, not a listed symbol
    expect(eln.Identifier).toBe('46654Q104');
    const cash = holdings.rows.find((row) => row.Name === 'USD CASH')!;
    expect(cash.Ticker).toBe('-');
    expect(cash.Identifier).toBe('-');
    expect(cash.Weight).toBe('0');
  });

  test('money market and foreign stock rows keep their published symbols; SEDOLs are identifiers too', () => {
    expect(holdings.rows.find((row) => row.Name === 'JPMORGAN PRIME MONEY')!.Ticker).toBe('JIMXX');
    const foreign = holdings.rows.find((row) => row.Name === 'MITSUBISHI UFJ FINANCIAL')!;
    expect(foreign.Ticker).toBe('8306');
    expect(foreign.Identifier).toBe('6335171');
  });

  test('bond funds add Coupon and Maturity columns', () => {
    const bonds = parseProductHoldings(
      {
        dailyHoldingsAll: {
          effectiveDate: '2026-09-17',
          data: [
            { securityDescription: 'UNITED STATES TREASURY NOTE 4.25% 2028', securityId: '91282CJN2', securityTicker: 'T', securityType: 'TREASURY NOTES', shares: 50000000, marketValue: 50123456.78, netAssetValuePercent: 1.51, couponRate: 4.25, finalLegalMaturityDate: '2028-11-15' },
            { securityDescription: 'CAPITAL ONE FINANCIAL 5.7%', securityId: '14040HCX5', securityTicker: 'COF', securityType: 'CORPORATE BONDS', shares: 1000000, marketValue: 1012345.6, netAssetValuePercent: 0.03, couponRate: 5.7, finalLegalMaturityDate: '2030-02-01' },
            { securityDescription: 'TRI-PARTY REPO', securityId: 'REPO0001', securityTicker: null, securityType: 'REPURCHASE AGREEMENTS', shares: 2000000, marketValue: 2000000, netAssetValuePercent: 0.06 },
          ],
        },
      },
      'JPST',
    )!;
    expect(bonds.headers).toEqual(BOND_SHEET_HEADERS);
    expect(bonds.rows[0].Ticker).toBe('-'); // "T" is an issuer code, not an exchange symbol
    expect(bonds.rows[0].Identifier).toBe('91282CJN2');
    expect(bonds.rows[0].Coupon).toBe('4.25');
    expect(bonds.rows[0].Maturity).toBe('Nov 15 2028');
    expect(bonds.rows[1].Ticker).toBe('-');
    expect(bonds.rows[2].Coupon).toBe('');
    expect(bonds.rows[2].Maturity).toBe('');
    expect(weightsSum(bonds.rows)).toBe(1.6);
  });

  test('falls back to the other full-list containers, never to the ten-row teaser', () => {
    const row = { securityDescription: 'APPLE INC COMMON STOCK', securityId: '037833100', securityTicker: 'AAPL', securityType: 'DOMESTIC COMMON STOCK', shares: 10, marketValue: 2000, netAssetValuePercent: 1.5 };
    const monthly = parseProductHoldings({ dailyHoldingsAll: { data: [] }, dailyHoldings: { data: [row] }, holdings: { monthlyHoldings: { effectiveDate: '2026-08-31', data: [row] } } }, 'XXXX')!;
    expect(monthly.container).toBe('holdings.monthlyHoldings');
    expect(monthly.asOfDate).toBe('2026-08-31');
    expect(monthly.rows.length).toBe(1);
    expect(parseProductHoldings({ dailyHoldings: { data: [row] } }, 'XXXX')).toBeNull();
  });

  test('returns null when the fund publishes no positions', () => {
    expect(parseProductHoldings({ dailyHoldingsAll: { data: [] } }, 'XXXX')).toBeNull();
    expect(parseProductHoldings({}, 'XXXX')).toBeNull();
  });
});

describe('holdingTickerFor', () => {
  test('keeps equity-like symbols and blanks issuer codes', () => {
    expect(holdingTickerFor('DOMESTIC COMMON STOCK', 'AAPL')).toBe('AAPL');
    expect(holdingTickerFor('REIT', 'PLD')).toBe('PLD');
    expect(holdingTickerFor('ADR', 'TSM')).toBe('TSM');
    expect(holdingTickerFor('MONEY MARKET', 'JIMXX')).toBe('JIMXX');
    expect(holdingTickerFor('EXCHANGE TRADED FUND', 'JEPQ')).toBe('JEPQ');
    expect(holdingTickerFor('TREASURY NOTES', 'T')).toBe('');
    expect(holdingTickerFor('CORPORATE BONDS', 'COF')).toBe('');
    expect(holdingTickerFor('COMMERCIAL PAPER', 'GS')).toBe('');
    expect(holdingTickerFor('EQUITY INDEX FUTURES', 'ESZ6')).toBe('');
    expect(holdingTickerFor('EQUITY LINKED NOTES', 'SPX')).toBe('');
    expect(holdingTickerFor('CURRENCIES', 'USD')).toBe('');
    expect(holdingTickerFor('SPOT CONTRACTS', 'JPY')).toBe('');
    expect(holdingTickerFor('', 'MSFT')).toBe('MSFT');
    expect(holdingTickerFor('DOMESTIC COMMON STOCK', 'n/a')).toBe('');
  });
});

describe('decodeDividendFrequency', () => {
  test('maps the JPMorgan cadence codes to the shared frequency words', () => {
    expect(decodeDividendFrequency('MDEC')).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    expect(decodeDividendFrequency('QDEC')).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
    expect(decodeDividendFrequency('SDEC')).toEqual({ frequency: 'Semi-annually', paymentsPerYear: 2 });
    expect(decodeDividendFrequency('YDEC')).toEqual({ frequency: 'Annually', paymentsPerYear: 1 });
    expect(decodeDividendFrequency('DACC')).toEqual({ frequency: 'Daily', paymentsPerYear: null });
    expect(decodeDividendFrequency('')).toBeNull();
    expect(decodeDividendFrequency(null)).toBeNull();
    expect(decodeDividendFrequency('ZZZ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Historical-data layer
// ---------------------------------------------------------------------------

const HISTORICAL_DATA_FIXTURE = {
  historicalETFClosingPriceList: [
    { date: '2026-09-18', navPrice: 56.2213, marketValueNavPrice: 56.24, premiumDiscountPercentage: 0.0332, currentQuarter: true },
    { date: '2026-09-17', navPrice: 56.4101, marketValueNavPrice: 56.43, premiumDiscountPercentage: 0.0353, currentQuarter: true },
    { date: '2026-09-01', navPrice: 55.9, marketValueNavPrice: 55.92, premiumDiscountPercentage: 0.0358, currentQuarter: true },
    { date: '2026-08-29', navPrice: 56.3, marketValueNavPrice: 56.31, premiumDiscountPercentage: 0.0178, currentQuarter: false },
    { date: 'not-a-date', navPrice: 1, marketValueNavPrice: 1, premiumDiscountPercentage: 0 },
    { date: '2026-08-28', navPrice: null, marketValueNavPrice: null, premiumDiscountPercentage: null },
  ],
  historicalETFNAVMarketPriceList: [
    { date: '2026-09-18', navPrice: 56.2213, marketValueNavPrice: 56.24 },
    { date: '2020-05-20', navPrice: 50, marketValueNavPrice: 50.02, premiumDiscountPercentage: 0.04 },
  ],
  dividendsDistributionHistoryList: [
    { dividendAmount: 0.37421, exDate: '2026-09-01', recordDate: '2026-09-01', payDate: '2026-09-04', reinvestNavPr: 55.9, distributionTypeCode: 'DVDYLD' },
    { dividendAmount: 0.4102, exDate: '2026-08-01', recordDate: '2026-08-01', payDate: '2026-08-05', reinvestNavPr: 56.1, distributionTypeCode: 'DVDYLD' },
    { dividendAmount: 0, exDate: '2026-07-01' },
    { dividendAmount: 0.39, exDate: null },
  ],
  performanceDataForChart: [
    { date: '2026-07-31', cumulativeNoLoadPercentage: 0.0217 },
    { date: '2026-08-31', cumulativeNoLoadPercentage: 0.0153 },
  ],
  quarterlyPerformanceReturns: [
    { performanceFactor: 'At NAV', oneMonth: 0.0153, threeMonths: 0.0188, ytd: 0.022, oneYear: 0.0777, threeYears: 0.0899, fiveYears: 0.0747, tenYears: null, inception: 0.1082, effectiveDate: '2026-06-30' },
    { performanceFactor: 'Market Price Returns', oneMonth: 0.0155, threeMonths: 0.019, ytd: 0.0222, oneYear: 0.078, threeYears: 0.09, fiveYears: 0.0748, tenYears: null, inception: 0.1083, effectiveDate: '2026-06-30' },
  ],
};

describe('parseHistoricalData', () => {
  const historical = parseHistoricalData(HISTORICAL_DATA_FIXTURE, 'JEPI');

  test('merges the daily lists into one ascending NAV / market price series', () => {
    expect(historical.points.map((point) => point.date)).toEqual(['2020-05-20', '2026-08-29', '2026-09-01', '2026-09-17', '2026-09-18']);
    expect(historical.points[4]).toEqual({ date: '2026-09-18', nav: 56.2213, marketPrice: 56.24, premiumDiscount: 0.0332 });
    expect(historical.points[0].premiumDiscount).toBe(0.04);
  });

  test('keeps positive dividends only, oldest first, with the reinvestment NAV', () => {
    expect(historical.dividends.map((dividend) => dividend.exDate)).toEqual(['2026-08-01', '2026-09-01']);
    expect(historical.dividends[1]).toEqual({
      epoch: isoToEpoch('2026-09-01')!,
      amount: 0.37421,
      exDate: '2026-09-01',
      payDate: '2026-09-04',
      recordDate: '2026-09-01',
      reinvestNav: 55.9,
      type: 'DVDYLD',
    });
  });

  test('reads the official quarter-end "At NAV" returns and the monthly chart', () => {
    expect(historical.quarterEnd).toEqual({ ytd: 2.2, yr1: 7.77, yr3: 8.99, yr5: 7.47, yr10: null, sinceInception: 10.82, asOfDate: '2026-06-30', mo1: 1.53, mo3: 1.88 });
    expect(historical.quarterEndMarket.yr1).toBe(7.8);
    expect(historical.monthlyReturns).toEqual([
      { date: '2026-07-31', value: 2.17 },
      { date: '2026-08-31', value: 1.53 },
    ]);
  });

  test('tolerates an empty payload and rejects a non-object', () => {
    const empty = parseHistoricalData({}, 'XXXX');
    expect(empty.points).toEqual([]);
    expect(empty.dividends).toEqual([]);
    expect(empty.quarterEnd.asOfDate).toBeNull();
    expect(() => parseHistoricalData(null as any, 'XXXX')).toThrow(/not an object/);
  });
});

describe('navTotalReturnDays', () => {
  test('reinvests each published distribution at its reinvestment NAV', () => {
    const points = [
      { date: '2026-08-29', nav: 56.3, marketPrice: 56.31, premiumDiscount: 0.0178 },
      { date: '2026-09-01', nav: 55.9, marketPrice: 55.92, premiumDiscount: 0.0358 },
      { date: '2026-09-17', nav: 56.4101, marketPrice: 56.43, premiumDiscount: 0.0353 },
    ];
    const dividends = [{ epoch: isoToEpoch('2026-09-01')!, amount: 0.37421, exDate: '2026-09-01', payDate: '', recordDate: '', reinvestNav: 55.9, type: 'DVDYLD' }];
    const days = navTotalReturnDays(points, dividends);
    expect(days.map((day) => day.date)).toEqual(['2026-08-29', '2026-09-01', '2026-09-17']);
    expect(days[0]).toEqual({ date: '2026-08-29', close: 56.3, adjClose: 56.3, volume: 0 });
    const factor = 1 + 0.37421 / 55.9;
    expect(days[1].adjClose).toBeCloseTo(55.9 * factor, 6);
    expect(days[2].adjClose).toBeCloseTo(56.4101 * factor, 6);
    // Total return over the window = price return plus the reinvested payout.
    expect(days[2].adjClose / days[0].adjClose - 1).toBeCloseTo((56.4101 * factor) / 56.3 - 1, 6);
  });

  test('uses the ex-date NAV when no reinvestment NAV is published and skips pre-history payouts', () => {
    const points = [
      { date: '2026-09-01', nav: 50, marketPrice: 50, premiumDiscount: 0 },
      { date: '2026-09-02', nav: 51, marketPrice: 51, premiumDiscount: 0 },
    ];
    const dividends = [
      { epoch: isoToEpoch('2026-08-01')!, amount: 1, exDate: '2026-08-01', payDate: '', recordDate: '', reinvestNav: null, type: '' },
      { epoch: isoToEpoch('2026-09-01')!, amount: 0.5, exDate: '2026-09-01', payDate: '', recordDate: '', reinvestNav: null, type: '' },
    ];
    const days = navTotalReturnDays(points, dividends);
    expect(days[0].adjClose).toBeCloseTo(50 * 1.01, 6);
    expect(days[1].adjClose).toBeCloseTo(51 * 1.01, 6);
    expect(navTotalReturnDays([], dividends)).toEqual([]);
  });
});

describe('annualizedSinceInception', () => {
  test('publishes the official since-inception figure only once the fund is a year old', () => {
    expect(annualizedSinceInception(11.25, '2020-05-20', '2026-08-31')).toBe(11.25);
    expect(annualizedSinceInception(1.9, '2026-07-30', '2026-08-31')).toBeNull();
    expect(annualizedSinceInception(1.9, '2025-08-31', '2026-08-31')).toBe(1.9);
    expect(annualizedSinceInception(null, '2020-05-20', '2026-08-31')).toBeNull();
    expect(annualizedSinceInception(5, null, '2026-08-31')).toBe(5);
  });
});

describe('sheet headers', () => {
  test('official history rows carry NAV, market price and premium/discount; Yahoo fallback keeps the sibling layout', () => {
    expect(HISTORY_HEADERS).toEqual(['Date', 'NAV', 'Market Price', 'Premium/Discount']);
    expect(YAHOO_HISTORY_HEADERS).toEqual(['Date', 'Close', 'Adj Close', 'Volume']);
  });
});

describe('nport fixtures', () => {
  test('parses positions, identifiers and the report period', () => {
    const xml = `
      <nportRegDoc><genInfo><regName>J.P. Morgan Exchange-Traded Fund Trust</regName><regCik>0001485894</regCik>
      <seriesName>JPMorgan Equity Premium Income ETF</seriesName><seriesId>S000068402</seriesId>
      <repPdDate>2026-06-30</repPdDate></genInfo>
      <invstOrSec><name>Apple Inc</name><cusip>037833100</cusip><balance>124827810</balance>
      <valUSD>26312454069.90</valUSD><pctVal>8.24</pctVal><assetCat>EC</assetCat></invstOrSec>
      <invstOrSec><title>US TREASURY 4.125% 05/15/2028</title>
      <identifiers><cusip value="912810H80"/></identifiers><balance>5000000</balance>
      <valUSD>5100000</valUSD><pctVal>2.5</pctVal><assetCat>OB</assetCat></invstOrSec>
      </nportRegDoc>`;
    const parsed = parseNport(xml);
    expect(parsed.seriesName).toBe('JPMorgan Equity Premium Income ETF');
    expect(parsed.regCik).toBe('0001485894');
    expect(parsed.repPdDate).toBe('2026-06-30');
    expect(parsed.holdings.length).toBe(2);
    expect(parsed.holdings[0].Identifier).toBe('037833100');
    expect(parsed.holdings[0].Ticker).toBe('-');
    expect(parsed.holdings[1].Identifier).toBe('912810H80');
    expect(parsed.holdings[1].Name).toBe('US TREASURY 4.125% 05/15/2028');
    expect(parsed.totalValue).toBeCloseTo(26317554069.9, 1);
    expect(parsed.netAssets).toBeNull();
  });

  test('reads the reported net assets when the filing carries a fundInfo block', () => {
    const parsed = parseNport(
      '<genInfo><seriesName>JPMorgan BetaBuilders U.S. Equity ETF</seriesName><repPdDate>2026-04-30</repPdDate></genInfo>' +
        '<fundInfo><totAssets>88500000000.00</totAssets><netAssets>87850000000.00</netAssets></fundInfo>' +
        '<invstOrSec><name>MGM Resorts International</name><cusip>552953101</cusip><valUSD>180990316.32</valUSD><pctVal>0.2059893365</pctVal></invstOrSec>',
    );
    expect(parsed.netAssets).toBe(87850000000);
    expect(parsed.holdings.length).toBe(1);
  });

  test('falls back to other identifiers when the CUSIP is N/A', () => {
    const parsed = parseNport(
      '<invstOrSec><name>FUND X</name><cusip>N/A</cusip><identifiers><other value="XSCUSIP1"/></identifiers><valUSD>10</valUSD></invstOrSec>',
    );
    expect(parsed.holdings[0].Identifier).toBe('XSCUSIP1');
  });

  test('tolerates empty bodies and missing values', () => {
    expect(() => parseNport('')).not.toThrow();
    const parsed = parseNport('<genInfo><seriesName>Empty</seriesName></genInfo>');
    expect(parsed.holdings).toEqual([]);
    expect(parsed.totalValue).toBe(0);
  });

  test('submissions parser keeps only NPORT-P forms and builds the archive URL', () => {
    const accessions = parseNportAccessions({
      cik: '913760',
      filings: {
        recent: {
          form: ['NPORT-P', '13F-HR', 'NPORT-P'],
          accessionNumber: ['0000913760-26-000111', '0000913760-26-000112', '0000913760-26-000113'],
          filingDate: ['2026-07-21', '2026-08-10', '2026-04-21'],
          reportDate: ['2026-06-30', '2026-06-30', '2026-03-31'],
        },
      },
    });
    expect(accessions.map((entry) => entry.accession)).toEqual(['0000913760-26-000111', '0000913760-26-000113']);
    expect(accessions[0].url).toBe(nportUrlFor('0000913760', '0000913760-26-000111'));
    expect(accessions[0].url).toContain('/Archives/edgar/data/913760/000091376026000111/primary_doc.xml');
  });
});

describe('pickEftsCik', () => {
  const payload = {
    hits: [
      { _source: { display_names: { cik: 12345, names: ['Some Other Trust'] } } },
      { _source: { display_names: { cik: 1485894, names: ['JPMorgan Equity Premium Income ETF', 'J.P. MORGAN EXCHANGE-TRADED FUND TRUST'] } } },
    ],
  };
  test('chooses the registrant whose name matches the fund', () => {
    expect(pickEftsCik(payload, 'JPMorgan Equity Premium Income ETF')).toBe('0001485894');
  });

  test('returns null when nothing matches', () => {
    expect(pickEftsCik(payload, 'Unknown Fund')).toBeNull();
  });

  test('reads the real EDGAR full-text search payload shape', () => {
    const real = {
      hits: {
        total: { value: 2, relation: 'eq' },
        hits: [
          { _source: { ciks: ['0001667919'], display_names: ['FIRST TRUST EXCHANGE-TRADED FUND VIII  (CIK 0001667919)'] } },
          { _source: { ciks: ['0001485894'], display_names: ['J.P. MORGAN EXCHANGE-TRADED FUND TRUST  (CIK 0001485894)'] } },
        ],
      },
    };
    expect(pickEftsCik(real, 'J.P. Morgan Exchange-Traded Fund Trust')).toBe('0001485894');
    expect(pickEftsCik(real, '')).toBe('0001667919');
  });
});

describe('SEC lookup tables', () => {
  const fundTickers = {
    fields: ['cik', 'seriesId', 'classId', 'symbol'],
    data: [
      [1485894, 'S000068402', 'C000218810', 'JEPI'],
      [1485894, 'S000054790', 'C000172198', 'JPST'],
      [1485894, 'S000061995', 'C000200806', 'bbjp'],
      [0, 'S000000000', 'C000000000', 'ZZZ'],
    ],
  };

  test('maps every ticker to its registrant CIK and series', () => {
    const map = parseFundTickerMap(fundTickers);
    expect(map.get('JEPI')).toEqual({ cik: '0001485894', seriesId: 'S000068402', classId: 'C000218810' });
    expect(map.get('JPST')?.cik).toBe('0001485894');
    expect(map.get('BBJP')?.seriesId).toBe('S000061995');
    expect(map.has('ZZZ')).toBe(false);
  });

  test('tolerates an unusable payload', () => {
    expect(parseFundTickerMap({}).size).toBe(0);
    expect(parseFundTickerMap({ fields: ['cik'], data: ['nope'] }).size).toBe(0);
  });

  test('maps issuer names back to exchange tickers', () => {
    const map = parseCompanyTickerMap({
      '0': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
      '1': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
      '2': { cik_str: 1, ticker: '', title: 'No Ticker Inc' },
    });
    expect(map.get(normalizeHoldingName('NVIDIA Corp'))).toBe('NVDA');
    expect(map.get(normalizeHoldingName('Apple Inc.'))).toBe('AAPL');
    expect(map.get(normalizeHoldingName('No Ticker Inc'))).toBeUndefined();
  });
});

describe('EDGAR series filings', () => {
  const atom = `<?xml version="1.0" encoding="ISO-8859-1"?>
    <feed>
      <entry>
        <accession-number>0001209466-26-000952</accession-number>
        <filing-date>2026-06-29</filing-date>
        <filing-href>https://www.sec.gov/Archives/edgar/data/1209466/000120946626000952/0001209466-26-000952-index.htm</filing-href>
        <filing-type>NPORT-P</filing-type>
      </entry>
      <entry>
        <accession-number>0001209466-26-000514</accession-number>
        <filing-date>2026-04-01</filing-date>
        <filing-href>https://www.sec.gov/Archives/edgar/data/1209466/000120946626000514/0001209466-26-000514-index.htm</filing-href>
        <filing-type>NPORT-P</filing-type>
      </entry>
      <entry>
        <accession-number>0001209466-26-000001</accession-number>
        <filing-date>2026-01-05</filing-date>
        <filing-type>N-CEN</filing-type>
      </entry>
    </feed>`;

  test('builds the browse-edgar Atom URL for one series', () => {
    const url = edgarSeriesFilingsUrl('S000060812', 5);
    expect(url).toContain('https://www.sec.gov/cgi-bin/browse-edgar?');
    expect(url).toContain('CIK=S000060812');
    expect(url).toContain('type=NPORT-P');
    expect(url).toContain('output=atom');
    expect(url).toContain('count=5');
  });

  test('keeps N-PORT-P entries newest first and builds the primary document URL', () => {
    const filings = parseEdgarAtomFilings(atom);
    expect(filings.map((entry) => entry.accession)).toEqual(['0001209466-26-000952', '0001209466-26-000514']);
    expect(filings[0].filed).toBe('2026-06-29');
    expect(filings[0].url).toBe('https://www.sec.gov/Archives/edgar/data/1209466/000120946626000952/primary_doc.xml');
  });

  test('tolerates an empty or unrelated feed', () => {
    expect(parseEdgarAtomFilings('')).toEqual([]);
    expect(parseEdgarAtomFilings('<feed><entry><filing-type>10-K</filing-type></entry></feed>')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// History fallback layer (Yahoo chart)
// ---------------------------------------------------------------------------

function chartFixture(options: { closes?: (number | null)[]; adj?: (number | null)[]; dividends?: Record<string, { date: number; amount: number }> } = {}) {
  const start = Date.UTC(2020, 0, 2) / 1000;
  const closes = options.closes ?? [100, 105, 110, 111, 120];
  const adj = options.adj ?? closes;
  const timestamps = closes.map((_, index) => start + index * 86_400);
  return {
    chart: {
      result: [
        {
          meta: {
            fullExchangeName: 'NasdaqGS',
            longName: 'JPMorgan Equity Premium Income ETF',
            navPrice: 706.3,
            regularMarketPrice: 706.32,
            regularMarketTime: Date.UTC(2026, 7, 21, 20, 0) / 1000,
            firstTradeDate: start,
          },
          timestamp: timestamps,
          indicators: { quote: [{ close: closes, volume: timestamps.map(() => 1000) }], adjclose: [{ adjclose: adj }] },
          events: { dividends: options.dividends ?? {} },
        },
      ],
    },
  };
}

describe('chart fixtures', () => {
  test('builds trading days, skips null closes, keeps adjusted closes', () => {
    const chart = parseChart(chartFixture({ closes: [100, null, 110], adj: [90, null, 99] }));
    expect(chart.days.map((day) => day.close)).toEqual([100, 110]);
    expect(chart.days.map((day) => day.adjClose)).toEqual([90, 99]);
    expect(chart.navPrice).toBe(706.3);
    expect(chart.exchangeName).toBe('NasdaqGS');
  });

  test('falls back to raw closes when adjclose is absent', () => {
    const payload = chartFixture({ closes: [100, 101] }) as any;
    delete payload.chart.result[0].indicators.adjclose;
    const chart = parseChart(payload);
    expect(chart.days.map((day) => day.adjClose)).toEqual([100, 101]);
  });

  test('sorts dividends chronologically and drops non-positive amounts', () => {
    const chart = parseChart(
      chartFixture({
        dividends: {
          '2': { date: Date.UTC(2026, 5, 15) / 1000, amount: 0.7 },
          '1': { date: Date.UTC(2026, 2, 15) / 1000, amount: 0.65 },
          '0': { date: Date.UTC(2025, 11, 15) / 1000, amount: -1 },
        },
      }),
    );
    expect(chart.dividends.map((entry) => entry.amount)).toEqual([0.65, 0.7]);
  });

  test('throws on an empty result', () => {
    expect(() => parseChart({ chart: { result: [] } })).toThrow(/empty result/);
  });
});

describe('priceReturns', () => {
  const days = [
    { date: '2015-01-02', close: 100, adjClose: 100, volume: 1 },
    { date: '2022-01-03', close: 200, adjClose: 195, volume: 1 },
    { date: '2023-01-03', close: 220, adjClose: 214, volume: 1 },
    { date: '2026-01-02', close: 300, adjClose: 290, volume: 1 },
    { date: '2026-06-30', close: 320, adjClose: 310, volume: 1 },
    { date: '2026-07-01', close: 322, adjClose: 312, volume: 1 },
    { date: '2026-08-21', close: 340, adjClose: 330, volume: 1 },
  ];
  const now = new Date(Date.UTC(2026, 7, 21));

  test('derives YTD, 1Y, CAGRs and SI anchored to the last close', () => {
    const returns = priceReturns(days, now);
    expect(returns.asOfDate).toBe('2026-08-21');
    // Each anchor is the last trading day at or before the period start, so a
    // thin fixture keeps falling back to the newest day that is early enough.
    expect(returns.ytd).toBeCloseTo(54.21, 2); // 2023-01-03 (the 2026-01-01 anchor)
    expect(returns.yr1).toBeCloseTo(54.21, 2); // 2023-01-03 (nothing between 2025 and 2023)
    expect(returns.cagr3y).toBeCloseTo(15.53, 2); // 2026-01-02 (3y before 2026-08-21)
    expect(returns.mo1).toBeCloseTo(5.77, 2); // 2026-07-01 (the 2026-07-21 anchor)
    expect(returns.siAnn).toBeGreaterThan(0);
  });

  test('young funds produce nulls instead of made-up returns', () => {
    const young = priceReturns([{ date: '2026-08-20', close: 10, adjClose: 10, volume: 1 }], now);
    expect(young.asOfDate).toBe('2026-08-20');
    expect(young.ytd).toBeNull();
    expect(young.cagr3y).toBeNull();
    expect(young.siAnn).toBeNull();
  });

  test('empty history yields an empty returns block', () => {
    expect(priceReturns([], now).asOfDate).toBe('');
  });
});

describe('lastCompletedQuarterEnd', () => {
  test('anchors to the last completed quarter', () => {
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 7, 21))).toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 0, 15))).toISOString().slice(0, 10)).toBe('2025-12-31');
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 4, 1))).toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 10, 1))).toISOString().slice(0, 10)).toBe('2026-09-30');
  });
});

// ---------------------------------------------------------------------------
// Derived metrics
// ---------------------------------------------------------------------------

describe('annualizedToTotal / totalToAnnualized', () => {
  test('annualizedToTotal inverts annualization exactly', () => {
    expect(annualizedToTotal(20.15, 3)).toBeCloseTo(73.45, 2);
    expect(annualizedToTotal(null, 3)).toBeNull();
    expect(annualizedToTotal(10, 0)).toBeNull();
  });

  test('round-trips through totalToAnnualized', () => {
    expect(totalToAnnualized(annualizedToTotal(12.5, 5), 5)).toBeCloseTo(12.5, 1);
  });

  test('guards bad input', () => {
    expect(totalToAnnualized('n/a' as any, 5)).toBeNull();
  });
});

describe('indicatedYield', () => {
  test('computes latest distribution x frequency / price', () => {
    expect(indicatedYield(0.7, 4, 706.32)).toBeCloseTo(0.4, 1);
    expect(indicatedYield(0.65, 12, 41.72)).toBe(18.7);
  });

  test('guards missing pieces', () => {
    expect(indicatedYield(null, 4, 10)).toBeNull();
    expect(indicatedYield(0.5, 0, 10)).toBeNull();
    expect(indicatedYield(0.5, 4, 0)).toBeNull();
  });
});

describe('inferDistributionFrequency', () => {
  test('detects quarterly and monthly cadences', () => {
    const quarterly = [0, 1, 2, 3].map((i) => ({ epoch: Date.UTC(2026, 0 + i * 3, 15) / 1000, amount: 1 }));
    expect(inferDistributionFrequency(quarterly).frequency).toBe('Quarterly');
    const monthly = Array.from({ length: 6 }, (_, i) => ({ epoch: Date.UTC(2026, i, 15) / 1000, amount: 1 }));
    expect(inferDistributionFrequency(monthly)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
  });

  test('no distributions means None (commodity / crypto style funds)', () => {
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });
});

describe('deriveCatalogMetrics', () => {
  test('official JPMorgan returns win over the derived ones', () => {
    const metrics = deriveCatalogMetrics(
      { ytd: 15.97, yr1: 18.34, yr3: 20.15, yr5: 17.42, yr10: 16.88, sinceInception: 19.44 },
      { asOfDate: '2026-08-21', ytd: 13.79, yr1: 54.21, cagr3y: 18.99, cagr5y: 12, cagr10y: 11, siAnn: 10, mo1: 1, qtd: 2 },
      0.44,
      null,
      null,
      null,
      706.32,
    );
    expect(metrics.ytd).toBe(15.97);
    expect(metrics.tr1y).toBe(18.34);
    expect(metrics.cagr3y).toBe(20.15);
    expect(metrics.tr3y).toBe(annualizedToTotal(20.15, 3));
    expect(metrics.dividendYield).toBe(0.44);
    expect(metrics.secYield).toBeNull();
    expect(metrics.returnsBasis).toContain('official JPMorgan NAV total returns');
  });

  test('falls back to derived returns and the indicated yield', () => {
    const metrics = deriveCatalogMetrics(
      { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null },
      { asOfDate: '2026-08-21', ytd: 13.79, yr1: 54.21, cagr3y: 18.99, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null },
      null,
      null,
      0.65,
      12,
      41.72,
    );
    expect(metrics.ytd).toBe(13.79);
    expect(metrics.tr1y).toBe(54.21);
    expect(metrics.cagr5y).toBeNull();
    expect(metrics.dividendYield).toBe(18.7);
    expect(metrics.dividendYieldText).toBe('18.70%');
    expect(metrics.returnsBasis).toContain('not official NAV returns');
  });

  test('official cumulative figures replace the annualized-to-total approximation', () => {
    const metrics = deriveCatalogMetrics(
      { ytd: 5.36, yr1: 9.05, yr3: 9.51, yr5: 10.02, yr10: null, sinceInception: 11.25 },
      { asOfDate: '2026-09-18', ytd: 3.7, yr1: 9, cagr3y: 9.4, cagr5y: 10, cagr10y: null, siAnn: 11, mo1: 1, qtd: 2 },
      8.42,
      7.59,
      0.37421,
      12,
      56.24,
      { yr1: 9.05, yr3: 31.33, yr5: 61.17, yr10: null, sinceInception: 95.24 },
    );
    expect(metrics.tr3y).toBe(31.33);
    expect(metrics.tr5y).toBe(61.17);
    expect(metrics.tr10y).toBeNull();
    expect(metrics.cagr3y).toBe(9.51);
    expect(metrics.secYield).toBe(7.59);
    expect(metrics.secYieldText).toBe('7.59%');
  });
});

// ---------------------------------------------------------------------------
// Holding name normalization and the ticker seed
// ---------------------------------------------------------------------------

describe('normalizeHoldingName', () => {
  test('strips legal-form suffixes and fillers', () => {
    expect(normalizeHoldingName('Apple Inc.')).toBe('APPLE');
    expect(normalizeHoldingName('Microsoft Corp Common Stock')).toBe('MICROSOFT');
    expect(normalizeHoldingName('THE BOEING CO')).toBe('BOEING');
    // share classes are canonicalized, never dropped: GOOG and GOOGL must not collide
    expect(normalizeHoldingName('Alphabet Inc. Class C Capital Stock')).toBe('ALPHABET CL C');
    expect(normalizeHoldingName('Alphabet Inc. Class A Common Stock')).toBe('ALPHABET CL A');
    expect(normalizeHoldingName('Alphabet Inc Cl C')).toBe('ALPHABET CL C');
  });

  test('core form drops the remaining spaces', () => {
    expect(normalizeHoldingNameCore('Apple Inc.')).toBe('APPLE');
  });

  test('share classes stay distinguishable', () => {
    expect(normalizeHoldingName('Alphabet Inc Cl A')).not.toBe(normalizeHoldingName('Alphabet Inc Cl C'));
  });

  test('a trailing security word is peeled, a lone one is not', () => {
    expect(normalizeHoldingName('Berkshire Hathaway Inc Del')).toBe('BERKSHIRE HATHAWAY');
    // "Cap Stk" is not in the filler/suffix vocabulary (it is only normalized,
    // never dropped): the class marker survives, which is what matters.
    expect(normalizeHoldingName('Berkshire Hathaway Inc Cap Stk Cl A')).toBe('BERKSHIRE HATHAWAY CL A');
    expect(normalizeHoldingName('Berkshire Hathaway Inc Cap Stock Class A')).toBe('BERKSHIRE HATHAWAY CL A');
  });

  test('empty and junk names normalize to empty', () => {
    expect(normalizeHoldingName('')).toBe('');
    expect(normalizeHoldingName('---')).toBe('');
  });
});

describe('cleanHoldingTicker', () => {
  test('keeps class-share markers', () => {
    expect(cleanHoldingTicker('brk-b')).toBe('BRK-B');
    expect(cleanHoldingTicker('SCE^L')).toBe('SCE^L');
    expect(cleanHoldingTicker('BF/A')).toBe('BF/A');
  });

  test('rejects placeholders', () => {
    expect(cleanHoldingTicker('')).toBe('');
    expect(cleanHoldingTicker('N/A')).toBe('');
    expect(cleanHoldingTicker('see file')).toBe('');
  });
});

describe('am.jpmorgan.com URL builders', () => {
  test('fundNameSlug folds names into the fund page slug', () => {
    expect(fundNameSlug('JPMorgan Equity Premium Income ETF')).toBe('jpmorgan-equity-premium-income-etf');
    expect(fundNameSlug('JPMorgan Ultra-Short Income ETF')).toBe('jpmorgan-ultra-short-income-etf');
    expect(fundNameSlug('JPMorgan BetaBuilders U.S. Equity ETF')).toBe('jpmorgan-betabuilders-us-equity-etf');
    expect(fundNameSlug('JPMorgan Income & Growth ETF')).toBe('jpmorgan-income-and-growth-etf');
    expect(fundNameSlug('')).toBe('');
  });

  test('jpmorganFundPageUrl builds the CUSIP-keyed fund page', () => {
    expect(jpmorganFundPageUrl('JPMorgan Equity Premium Income ETF', '46641Q332')).toBe(
      'https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-etf-shares-46641q332',
    );
    expect(jpmorganFundPageUrl('', '46641Q332')).toBe('https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-etf-etf-shares-46641q332');
  });

  test('jpmorganFundExplorerUrl builds the catalog JSON URL', () => {
    expect(jpmorganFundExplorerUrl()).toBe('https://am.jpmorgan.com/FundsMarketingHandler/fund-explorer?country=us&role=adv&userLoggedIn=false&language=en&fundType=etf');
    expect(jpmorganFundExplorerUrl('per')).toContain('role=per');
  });

  test('jpmorganProductDataUrl / jpmorganHistoricalDataUrl build the per-fund JSON URLs', () => {
    expect(jpmorganProductDataUrl('46641Q332')).toBe('https://am.jpmorgan.com/FundsMarketingHandler/product-data?cusip=46641Q332&country=us&role=adv&language=en&userLoggedIn=false');
    expect(jpmorganHistoricalDataUrl('46641Q332')).toBe('https://am.jpmorgan.com/FundsMarketingHandler/historicalData?cusip=46641Q332&country=us&role=adv&language=en&userLoggedIn=false');
  });

  test('jpmorganHoldingsDownloadUrl / jpmorganPricesDownloadUrl build the human workbook links', () => {
    expect(jpmorganHoldingsDownloadUrl('46641Q332')).toBe('https://am.jpmorgan.com/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=46641Q332&country=us&role=adv&locale=en-US');
    expect(jpmorganPricesDownloadUrl('46641Q332')).toBe('https://am.jpmorgan.com/FundsMarketingHandler/excel?type=historicalNav&cusip=46641Q332&country=us&role=adv&locale=en-US');
    expect(jpmorganPricesDownloadUrl('46641Q332', 'adv', '2020-05-20', '2026-09-18')).toContain('&fromDate=2020-05-20&toDate=2026-09-18');
  });

  test('fractionToPercent converts the published fractions and keeps nulls', () => {
    expect(fractionToPercent(0.0536)).toBe(5.36);
    expect(fractionToPercent(0.0951)).toBe(9.51);
    expect(fractionToPercent('0.1')).toBe(10);
    expect(fractionToPercent(null)).toBeNull();
    expect(fractionToPercent('--')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Client-side catalog helpers (app.tsx)
//
// app.tsx is compiled in the browser by Babel standalone and calls init() at
// module scope, so it cannot be imported here. The catalog's frequency column
// is nevertheless a pure function of the published data and its coded labels
// are what the column sorts on, so its source is extracted and exercised
// directly instead of being left untested.
// ---------------------------------------------------------------------------

const APP_SOURCE = readFileSync(new URL('../app.tsx', import.meta.url), 'utf8');

function extractClientFunction(name: string): (...args: any[]) => any {
  const match = new RegExp(`\\nfunction ${name}\\(([^)]*)\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(APP_SOURCE);
  if (!match) throw new Error(`${name} not found in app.tsx`);
  const parameters = match[1]
    .split(',')
    .map(parameter => parameter.split(':')[0].split('=')[0].trim())
    .filter(Boolean)
    .join(', ');
  return new Function(parameters, match[2]) as (...args: any[]) => any;
}

const formatDividendFrequency = extractClientFunction('formatDividendFrequency');

describe('formatDividendFrequency (catalog Frequency column)', () => {
  test('codes the published cadences with a sortable two-digit prefix', () => {
    expect(formatDividendFrequency('Monthly')).toBe('01 - Monthly');
    expect(formatDividendFrequency('Quarterly')).toBe('04 - Quarterly');
    expect(formatDividendFrequency('Semi-annually')).toBe('06 - Semi-annually');
    expect(formatDividendFrequency('Annually')).toBe('12 - Annually');
    expect(formatDividendFrequency('None')).toBe('00 - None');
    expect(formatDividendFrequency('Unknown')).toBe('00 - Unknown');
    expect(formatDividendFrequency('Irregular')).toBe('99 - Irregular');
  });

  test('accepts the hyphenated spellings and is case-insensitive', () => {
    expect(formatDividendFrequency('semi-annually')).toBe('06 - Semi-annually');
    expect(formatDividendFrequency('Semi-Annual')).toBe('06 - Semi-annually');
    expect(formatDividendFrequency('semiannual')).toBe('06 - Semi-annually');
    expect(formatDividendFrequency('annual')).toBe('12 - Annually');
    expect(formatDividendFrequency('monthly')).toBe('01 - Monthly');
  });

  test('treats missing data as "00 - —" instead of dropping the cell', () => {
    expect(formatDividendFrequency(undefined)).toBe('00 - —');
    expect(formatDividendFrequency(null)).toBe('00 - —');
    expect(formatDividendFrequency('')).toBe('00 - —');
    expect(formatDividendFrequency('  ')).toBe('00 - —');
    expect(formatDividendFrequency('-')).toBe('00 - —');
  });

  test('passes an unknown published value through unchanged', () => {
    expect(formatDividendFrequency('Weekly')).toBe('Weekly');
    expect(formatDividendFrequency('Daily')).toBe('Daily');
  });

  test('the updater emits the spellings the column codes (decodeDividendFrequency + inferDistributionFrequency)', () => {
    for (const code of ['MDEC', 'QDEC', 'SDEC', 'YDEC']) {
      expect(formatDividendFrequency(decodeDividendFrequency(code)!.frequency)).toMatch(/^\d\d - /);
    }
    const semiannual = inferDistributionFrequency([
      { epoch: isoToEpoch('2025-06-20')!, amount: 1 },
      { epoch: isoToEpoch('2025-12-20')!, amount: 1 },
      { epoch: isoToEpoch('2026-06-20')!, amount: 1 },
    ]);
    expect(semiannual).toEqual({ frequency: 'Semi-annually', paymentsPerYear: 2 });
    expect(formatDividendFrequency(semiannual.frequency)).toBe('06 - Semi-annually');
  });

  test('coded labels sort in descending cadence order without extra comparators', () => {
    const codes = ['Monthly', 'Quarterly', 'Semi-annually', 'Annually', 'None', 'Irregular']
      .map(formatDividendFrequency)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    expect(codes).toEqual(['00 - None', '01 - Monthly', '04 - Quarterly', '06 - Semi-annually', '12 - Annually', '99 - Irregular']);
  });
});
