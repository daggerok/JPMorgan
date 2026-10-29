// Bun's test runner provides these globals at runtime.
// @ts-ignore bun types are intentionally not required for this zero-dependency Bun script.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  runOrder,
  CLOSED_FUNDS,
  closedFund,
  CONTROL_NAMES,
  runUpdater,
  setApiRootForTests,
  configureFetchForTests,
  paceRequests,
  fetchWithRetry,
  chartUrl,
  emptyMetrics,
  withYieldBasis,
  yieldBasisFromKind,
  indexRowFromMeta,
  readConfig,
  resolveControls,
  runtimeControls,
  isCertError,
  installSystemCa,
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
  holdingsGuard,
  holdingsWeightCount,
  HOLDINGS_GUARD_RELAX,
  isUsListing,
  nportHoldingsSheet,
  nportIsFresh,
  nportTickers,
  parseNportFiling,
  parseSecCompanyNames,
  parseSecFundTickers,
  withoutYoungReturns,
  compareHoldingRows,
  parseHistoricalData,
  navTotalReturnDays,
  reinvestmentCoverageStart,
  DIVIDEND_SCHEDULE_CAP,
  holdingTickerFor,
  decodeDividendFrequency,
  weightsSum,
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
  numberOrNull,
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

// Portability: fixed time zone, quiet console, restored fetch/exitCode/fetch settings after every test.
// Every control is passed explicitly to the resolver, so exported workflow variables never leak in.
const realFetch = globalThis.fetch;
// the seven 52-week keys withRange52w puts into every index row in front of returnsBasis and performanceAsOf (range-52w block)
const RANGE_KEYS = ['week52Low', 'week52High', 'range52w', 'range52wClose', 'range52wAsOf', 'range52wSince', 'range52wBasis'];
const withRangeKeys = (keys: string[]): string[] => keys.flatMap((key) => (key === 'returnsBasis' ? [...RANGE_KEYS, key] : [key]));
const rangeless = (metrics: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(metrics).filter(([key]) => !RANGE_KEYS.includes(key)));
const realLog = console.log;
const realError = console.error;
const realTz = process.env.TZ;
const FETCH_DEFAULTS = { timeoutMs: 45_000, sleepMs: 0, deadlineMs: 25 * 60_000, lanes: 1 };
beforeEach(() => {
  process.env.TZ = 'UTC';
  console.log = () => {};
  console.error = () => {};
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.error = realError;
  if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;
  configureFetchForTests(FETCH_DEFAULTS);
  process.exitCode = 0;
});

const config = JSON.parse(readFileSync(new URL('./update-data.config.json', import.meta.url), 'utf8')) as Record<string, string>;
// resolveControls(file, advanced, inputs, env)
const resolve = (env: Record<string, string> = {}, file: Record<string, unknown> = {}, advanced: unknown = {}, inputs: Record<string, string> = {}) => resolveControls(file, advanced, inputs, env);

// Trimmed inline samples of the am.jpmorgan.com payloads (fractions for yields/returns, percent for premium/discount).
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

const EARLY_NAV_FIXTURE = [
  'Date, Fund Name, Ticker, CUSIP, NAV, Previous NAV, NAV Change, % OF NAV Change, Net Assets, Shares Outstanding, Distribution Factor, ST Cap Gains, LT Cap Gains',
  '09/18/2026, JPMorgan Equity Premium Income ETF, JEPI, 46641Q332, 56.2213, 56.4101, -0.1888, -0.33, 45123456789.12, 802600000, 0.00000000, 0.00000000, 0.00000000',
  '09/18/2026, JPMorgan Ultra-Short Income ETF, JPST, 46641Q837, 50.7100, 50.7000, 0.0100, 0.02, 33000000000, 650000000, 0.00000000, 0.00000000, 0.00000000',
  '',
  'The early NAV report is provided for informational purposes only and is subject to change.',
].join('\r\n');

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
    // NVDA's weight is raised so the sample adds up to ~100% like a real sheet (holdingsGuard rejects a sum outside 50..150)
    dailyHoldingsAll: {
      effectiveDate: '2026-09-17',
      data: [
        { securityDescription: 'NVIDIA CORP COMMON', securityId: '67066G104', securityTicker: 'NVDA', securityType: 'DOMESTIC COMMON STOCK', shares: 4301234, marketValue: 879922379.14, netAssetValuePercent: 97.94, marketValuePercent: 1.95, country: 'United States', currencyCode: 'USD' },
        { securityDescription: 'SPX 09/22/2026 5990 ELN', securityId: '46654Q104', securityTicker: 'SPX', securityType: 'EQUITY LINKED NOTES', shares: 11500000, marketValue: 120345678.9, netAssetValuePercent: 0.27 },
        { securityDescription: 'JPMORGAN PRIME MONEY', securityId: '46637K844', securityTicker: 'JIMXX', securityType: 'MONEY MARKET', shares: 934627, marketValue: 934534.38, netAssetValuePercent: 0.01 },
        { securityDescription: 'USD CASH', securityId: null, securityTicker: null, securityType: 'CURRENCIES', shares: 1000, marketValue: 1000, netAssetValuePercent: 0 },
        { securityDescription: 'MITSUBISHI UFJ FINANCIAL', securityId: '6335171', securityTicker: '8306', securityType: 'FOREIGN COMMON STOCK', shares: 100, marketValue: 1000, netAssetValuePercent: 0.01 },
        { securityDescription: '', securityId: 'IGNORED', securityTicker: 'X', securityType: 'DOMESTIC COMMON STOCK', shares: 1, marketValue: 1, netAssetValuePercent: 0.01 },
      ],
    },
  },
};

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

// ---------------------------------------------------------------------------
// controls: resolver precedence, strict validation, aliases, system CA (no network)
// ---------------------------------------------------------------------------

describe('controls', () => {
  test('precedence: file < advanced < nonblank input < env, blank input keeps the lower layer', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'JEPI' }, { CONCURRENCY: 3, TICKERS: 'JEPQ' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
    expect(c.CONCURRENCY).toBe('5');
    expect(c.TICKERS).toBe('JEPQ');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '' }).CONCURRENCY).toBe('3');
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
    expect(resolveControls({ TICKERS: 'JEPI' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  });

  test('brand and legacy env aliases reach the resolver, the canonical name wins', () => {
    expect(resolve({ JPMORGAN_LIMIT: '7' }).MAX_FETCHES).toBe('7');
    expect(resolve({ HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('500');
    expect(resolve({ JPMORGAN_TICKERS: 'JEPI', TICKERS: 'JEPQ' }).TICKERS).toBe('JEPI');
    expect(resolve({ JPMORGAN_LIMIT: '7', MAX_FETCHES: '9' }, { MAX_FETCHES: 3 }).MAX_FETCHES).toBe('9');
  });

  test('config file: keys == CONTROL_NAMES, string values, scheduled path == defaults, SEC contact', async () => {
    expect(Object.keys(config).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(config)) expect(typeof value).toBe('string');
    const scheduled = resolveControls(config, {}, {}, {});
    expect(scheduled).toEqual(config);
    expect(await runtimeControls({})).toEqual(scheduled);
    expect(config.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(JSON.stringify(config)).not.toContain('example.com');
    expect(resolve({ SEC_UA: 'x y z@w.io' }, config).SEC_UA).toBe('x y z@w.io');
    expect(resolve({ USE_SYSTEM_CA: 'AUTO' }, config).USE_SYSTEM_CA).toBe('auto');
  });

  test('strict validation: invalid values are errors, never a silent fallback', () => {
    const badFile: unknown[] = [
      { UNKNOWN: 1 }, { OUTPUT_DIR: 'x' }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_RETRIES: 0 },
      { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { SKIP_YAHOO: 'maybe' }, { AUM: '9:1' }, { TER: '5' },
      { PERFORMANCE_1Y: '9:1' }, { TICKERS: ['JEPI'] }, { TICKERS: { a: 1 } }, { USE_SYSTEM_CA: 'maybe' }, null, [], 'x',
    ];
    for (const value of badFile) expect(() => resolveControls(value)).toThrow();
    const badEnv: [string, string, RegExp][] = [
      ['HISTORY_RANGE', 'garbage', /HISTORY_RANGE/],
      ['HISTORY_RANGE', '6mo', /HISTORY_RANGE/],
      ['ROLE', 'ad v', /ROLE/],
      ['API_BASE', 'ftp://example.test', /API_BASE/],
      ['FUND_EXPLORER_URL', 'http://am.jpmorgan.com/x', /FUND_EXPLORER_URL/],
      ['EARLY_NAV_URL', 'not a url', /EARLY_NAV_URL/],
      ['USE_SYSTEM_CA', 'maybe', /USE_SYSTEM_CA/],
      ['SEC_UA', 'x\0bad', /./],
      ['TICKERS', 'a\r\nb', /./],
    ];
    for (const [name, value, message] of badEnv) expect(() => resolve({ [name]: value })).toThrow(message);
    expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
    expect(() => resolveControls({}, {}, { TICKERS: 'a\nb' })).toThrow();
    expect(() => resolveControls({}, null)).toThrow();
    expect(() => resolveControls({}, [])).toThrow();
    // the valid neighbours still pass
    expect(resolve({ HISTORY_RANGE: '5y' }).HISTORY_RANGE).toBe('5y');
    expect(resolve({ HISTORY_RANGE: 'MAX' }).HISTORY_RANGE).toBe('MAX');
    expect(resolve({ API_BASE: 'http://localhost:8080/mirror' }).API_BASE).toBe('http://localhost:8080/mirror');
    for (const value of ['auto', 'true', 'false', 'True', 'FALSE']) expect(resolve({ USE_SYSTEM_CA: value }).USE_SYSTEM_CA).toBe(value.toLowerCase());
  });
});

describe('controls 2', () => {
  test('range filters: bounds, suffixes, presets; a stray colon, no colon or min > max is an error', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseRange('1:5', 'X')).toEqual({ min: 1, max: 5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(parseRange(':3', 'X')).toEqual({ min: undefined, max: 3 });
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('$1:$2', 'X')).toEqual({ min: 1, max: 2 });
    expect(() => parseRange('15', 'X')).toThrow(/colon is required/);
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('1:2:3', 'PERFORMANCE_1Y')).toThrow(/exactly one colon/);

    expect(parseAumRange('')).toBeUndefined();
    expect(parseAumRange(':')).toBeUndefined();
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('1B:')).toEqual({ min: 1_000_000_000, max: undefined });
    const presets: Record<string, [number, number | undefined]> = { nano: [0, 10e6], micro: [10e6, 300e6], small: [300e6, 2e9], mid: [2e9, 10e9], large: [10e9, undefined] };
    for (const [name, [min, max]] of Object.entries(presets)) expect(parseAumRange(name)).toEqual({ min, max });
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
    expect(() => parseAumRange('abc:')).toThrow(/AUM/);
    expect(() => parseAumRange('x1B:')).toThrow(/AUM/);
    expect(() => parseAumRange('1B:2B:3B')).toThrow(/exactly one colon/);
  });

  test('provider defaults: readConfig turns the config file into typed settings', () => {
    const typed = readConfig(resolveControls(config));
    expect(typed).toMatchObject({
      tickers: [], maxFetches: 0, requestSleep: 1, concurrency: 2, holdingsPageSize: 250, historyPageSize: 1000, maxRetries: 2,
      historyRange: 'max', role: 'adv', edgarFallback: true, skipYahoo: false, skipJpmorgan: false, storeRawDownloads: false, secUa: config.SEC_UA,
    });
    expect(typed.aumRange).toBeUndefined();
    expect(typed.fundExplorerUrl).toContain('/FundsMarketingHandler/fund-explorer?country=us&role=adv');
    expect(readConfig(resolveControls(config, { MAX_RETRIES: 1 })).maxRetries).toBe(1);
    expect(readConfig(resolveControls(config, { AUM: '1B:' })).aumRange).toEqual({ min: 1e9, max: undefined });
    expect(readConfig(resolveControls(config, { API_BASE: 'http://127.0.0.1:1/x/' })).fundExplorerUrl).toStartWith('http://127.0.0.1:1/x/fund-explorer');
  });

  test('USE_SYSTEM_CA: certificate errors are recognized; auto restarts once, true restarts, false and an active CA do nothing', async () => {
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET' })).toBe(false);
    expect(isCertError(new Error('HTTP 403 Forbidden'))).toBe(false);
    expect(isCertError(null)).toBe(false);

    let restarts = 0;
    const reexec = (() => { restarts += 1; return undefined as never; }) as () => never;
    installSystemCa('false', reexec, false);
    installSystemCa('auto', reexec, true);
    installSystemCa('true', reexec, true);
    expect(globalThis.fetch).toBe(realFetch);
    expect(restarts).toBe(0);
    installSystemCa('true', reexec, false);
    expect(restarts).toBe(1);

    restarts = 0;
    let next: () => Promise<Response> = async () => new Response('ok');
    globalThis.fetch = (async () => next()) as unknown as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    expect(await (await fetch('https://example.invalid/')).text()).toBe('ok');
    next = async () => { throw new Error('ECONNRESET'); };
    await expect(fetch('https://example.invalid/')).rejects.toThrow('ECONNRESET');
    expect(restarts).toBe(0);
    next = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } }); };
    await fetch('https://example.invalid/');
    expect(restarts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// parsing: one small inline sample per payload, missing values become null
// ---------------------------------------------------------------------------

describe('parsing', () => {
  test('numbers, dates and CSV helpers', () => {
    expect(normalizeNumberText('2.97057744E8')).toBe('297057744');
    expect(normalizeNumberText('1.5e-3')).toBe('0.0015');
    for (const text of ['Apple Inc', '', '-']) expect(normalizeNumberText(text)).toBe(text);
    expect(normalizeNumberText('1,234.56')).toBe('1234.56');
    for (const placeholder of ['--', '—', 'N/A']) expect(numberOrNull(placeholder)).toBeNull();
    expect(numberOrNull('$1,234.56')).toBe(1234.56);
    expect(numberOrNull('0.40%')).toBe(0.4);
    expect([fractionToPercent(0.0536), fractionToPercent('0.1'), fractionToPercent(null), fractionToPercent('--')]).toEqual([5.36, 10, null, null]);

    expect(toIsoDate('08/21/2026')).toBe('2026-08-21');
    expect(toIsoDate('2026-8-1')).toBe('2026-08-01');
    expect(toIsoDate('n/a')).toBe('n/a');
    expect(formatJpmorganDate('2026-08-21')).toBe('08/21/2026');
    expect(formatEdgarDate('2026-06-30')).toBe('Jun 30 2026');
    expect(isoToEpoch('2026-01-15')).toBe(Date.UTC(2026, 0, 15) / 1000);
    expect(isoToEpoch('nope')).toBeNull();

    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCsv('﻿Ticker,Name\r\n\r\nJEPI,Fund\r\n')).toEqual([['Ticker', 'Name'], ['JEPI', 'Fund']]);
    const rows = parseCsv(['J.P. Morgan Asset Management', 'Early NAV report', '', EARLY_NAV_FIXTURE].join('\n'));
    expect(findHeaderRowIndex(rows, ['Ticker', 'CUSIP', 'NAV'])).toBe(2);
    expect(findHeaderRowIndex(rows, ['Nope'])).toBe(-1);
    const records = csvRecords(parseCsv('Fund Ticker,Ticker,Name\nQQQ,QQQ,Apple Inc'), 0);
    expect([pickColumn(records[0], ['Ticker']), pickColumn(records[0], ['Name']), pickColumn(records[0], ['Missing'])]).toEqual(['QQQ', 'Apple Inc', '']);
    expect(csvRecords(parseCsv('Ticker,Name\n JEPI , Fund \n,,\n'), 0)).toEqual([{ Ticker: 'JEPI', Name: 'Fund' }]);
  });

  test('catalog: fund explorer keeps ETFs only, converts fractions to percent, null stays null', () => {
    const funds = parseFundExplorer(FUND_EXPLORER_FIXTURE);
    expect(funds.map((fund) => fund.ticker)).toEqual(['JEPI', 'JLVP', 'JPST']);
    expect(funds.every((fund) => fund.source === 'jpmorgan' && fund.ter === null && fund.dividendYield === null)).toBe(true);
    const jepi = funds[0];
    expect(jepi).toMatchObject({
      cusip: '46641Q332', name: 'JPMorgan Equity Premium Income ETF', category: 'U.S. Equity', inception: '2020-05-20', asOfDate: '2026-09-18',
      fundPage: 'https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-etf-shares-46641q332',
      trustCik: '0001485894', nav: 56.2213, close: 56.24, premiumDiscount: 0.0332, netAssets: 45123456789.12, secYield: 7.44, returnsAsOfDate: '2026-08-31', quarterEndAsOfDate: '2026-06-30',
    });
    expect(jepi.returns).toEqual({ ytd: 5.36, yr1: 9.05, yr3: 9.51, yr5: 10.02, yr10: null, sinceInception: 11.25 });
    expect(jepi.marketReturns.yr1).toBe(9.08);
    expect(jepi.quarterEnd).toEqual({ ytd: 2.2, yr1: 7.77, yr3: 8.99, yr5: 7.47, yr10: null, sinceInception: 10.82 });
    const jlvp = funds[1];
    expect(jlvp.secYield).toBeNull();
    expect(jlvp.returns.ytd).toBeNull();
    expect(jlvp.returns.sinceInception).toBe(1.9);
    expect(jlvp.quarterEndAsOfDate).toBeNull();
    expect(parseFundExplorer({ funds: FUND_EXPLORER_FIXTURE }).length).toBe(3);
    expect(parseFundExplorer({ data: FUND_EXPLORER_FIXTURE }).length).toBe(3);
    expect(() => parseFundExplorer({ error: 'nope' })).toThrow(/not a fund list/);
  });

  test('catalog fallback: early-NAV CSV reads padded headers, rejects a file without ETF columns; categories are repaired', () => {
    const funds = parseEarlyNavCsv(EARLY_NAV_FIXTURE);
    expect(funds.map((fund) => fund.ticker)).toEqual(['JEPI', 'JPST']);
    expect(funds[0]).toMatchObject({ cusip: '46641Q332', name: 'JPMorgan Equity Premium Income ETF', nav: 56.2213, netAssets: 45123456789.12, asOfDate: '2026-09-18', source: 'early-nav' });
    expect(funds[0].fundPage).toContain('-etf-shares-46641q332');
    expect(() => parseEarlyNavCsv('Fund Name,Price\nX,1')).toThrow(/header row not found/);
    expect(normalizeJpmorganCategory('  Fixed Income   Taxable ')).toBe('Fixed Income Taxable');
    expect(normalizeJpmorganCategory('')).toBe('ETF');
    expect(normalizeJpmorganCategory(null)).toBe('ETF');
  });

  test('fund page: product-data facts, daily yields win over month-end, official At NAV returns, empty answer rejected', () => {
    const product = parseProductData(PRODUCT_DATA_FIXTURE, 'JEPI');
    expect(product).toMatchObject({
      ticker: 'JEPI', cusip: '46641Q332', exchange: 'NYSE-Arca', grossExpense: 0.35, netExpense: 0.35, inception: '2020-05-20', assetClass: 'U.S. Equity',
      benchmark: 'S&P 500 Index', frequencyCode: 'MDEC', numberOfHoldings: 135, sharesOutstanding: 802600000,
      nav: 56.2213, navDate: '2026-09-18', marketPrice: 56.24, premiumDiscount: 0.0332, netAssets: 45123456789.12, netAssetsDate: '2026-09-18',
      secYield: 7.59, secYieldDate: '2026-09-17', dividendYield: 8.42, dividendYieldDate: '2026-09-18', cumulativeAsOfDate: '2026-08-31',
    });
    expect(product.secYieldKind).toContain('daily');
    expect(product.dividendYieldKind).toContain('12-month rolling');
    expect(product.latestDividend).toEqual({ exDate: '2026-09-01', amount: 0.37421, payDate: '2026-09-04', recordDate: '2026-09-01' });
    expect(product.monthEnd).toEqual({ ytd: 5.36, yr1: 9.05, yr3: 9.51, yr5: 10.02, yr10: null, sinceInception: 11.25, asOfDate: '2026-08-31', mo1: 1.53, mo3: 4.02 });
    expect(product.monthEndMarket.yr1).toBe(9.08);
    expect(product.cumulative).toEqual({ yr1: 9.05, yr3: 31.33, yr5: 61.17, yr10: null, sinceInception: 95.24 });

    const payload = structuredClone(PRODUCT_DATA_FIXTURE);
    payload.fundData.shareClass.etfSecYield = {} as any;
    payload.fundData.shareClass.secYield = {} as any;
    const fallback = parseProductData(payload, 'JEPI');
    expect([fallback.secYield, fallback.dividendYield]).toEqual([7.44, 8.39]);
    expect(fallback.secYieldKind).toContain('month-end');
    expect(fallback.dividendYieldKind).toContain('month-end');
    expect(() => parseProductData({ fundData: null, error: null }, 'XXXX')).toThrow(/no fundData/);
  });
});

describe('parsing 2', () => {
  test('holdings: shared headers, "-" for unlisted tickers, bond columns, container fallback, null when empty', () => {
    const holdings = parseProductHoldings(PRODUCT_DATA_FIXTURE.fundData, 'JEPI')!;
    expect(holdings.headers).toEqual(HOLDINGS_HEADERS);
    expect(holdings.asOfDate).toBe('2026-09-17');
    expect(holdings.rows.length).toBe(5); // the nameless row is dropped
    expect(holdings.rows[0]).toEqual({ Name: 'NVIDIA CORP COMMON', Ticker: 'NVDA', Identifier: '67066G104', Weight: '97.94', 'Market Value': '879922379.14', 'Shares Held': '4301234', 'Asset Category': 'DOMESTIC COMMON STOCK' });
    const byName = (name: string) => holdings.rows.find((row) => row.Name.startsWith(name))!;
    expect([byName('SPX').Ticker, byName('SPX').Identifier]).toEqual(['-', '46654Q104']); // "SPX" is the underlying, not a listed symbol
    expect([byName('USD CASH').Ticker, byName('USD CASH').Identifier, byName('USD CASH').Weight]).toEqual(['-', '-', '0']);
    expect(byName('JPMORGAN PRIME').Ticker).toBe('JIMXX');
    expect([byName('MITSUBISHI').Ticker, byName('MITSUBISHI').Identifier]).toEqual(['-', '6335171']); // a SEDOL-keyed foreign listing

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
    expect(bonds.rows.map((row) => row.Identifier)).toEqual(['91282CJN2', 'REPO0001', '14040HCX5']); // weight order
    expect(bonds.rows.map((row) => row.Ticker)).toEqual(['-', '-', '-']); // issuer codes are not exchange symbols
    expect([bonds.rows[0].Coupon, bonds.rows[0].Maturity]).toEqual(['4.25', 'Nov 15 2028']);
    expect([bonds.rows[1].Coupon, bonds.rows[1].Maturity]).toEqual(['', '']);
    expect(weightsSum(bonds.rows)).toBe(1.6);

    const row = { securityDescription: 'APPLE INC COMMON STOCK', securityId: '037833100', securityTicker: 'AAPL', securityType: 'DOMESTIC COMMON STOCK', shares: 10, marketValue: 2000, netAssetValuePercent: 1.5 };
    const monthly = parseProductHoldings({ dailyHoldingsAll: { data: [] }, dailyHoldings: { data: [row] }, holdings: { monthlyHoldings: { effectiveDate: '2026-08-31', data: [row] } } }, 'XXXX')!;
    expect([monthly.container, monthly.asOfDate, monthly.rows.length]).toEqual(['holdings.monthlyHoldings', '2026-08-31', 1]);
    expect(parseProductHoldings({ dailyHoldings: { data: [row] } }, 'XXXX')).toBeNull(); // never the ten-row teaser
    expect(parseProductHoldings({ dailyHoldingsAll: { data: [] } }, 'XXXX')).toBeNull();
    expect(parseProductHoldings({}, 'XXXX')).toBeNull();
  });

  test('ticker hygiene: a foreign listing publishes "-" instead of its bare local code (BetaBuilders CSL, ALL, RIO), U.S. listings and ADRs keep theirs, preferreds get "-"', () => {
    // real BBAX, JEMA, JLVP, BBEM and JPRF rows (trimmed): CSL is CSL Ltd in Sydney and Carlisle in New York, ALL Aristocrat Leisure and
    // Allstate, RIO Rio Tinto Ltd and the NYSE ADR of Rio Tinto plc; JPRF lists an AT&T preferred as TPC (Tutor Perini)
    const data = [
      { securityDescription: 'CSL LTD COMMON STOCK AUD', securityId: '6185495', securityTicker: 'CSL', securityType: 'FOREIGN COMMON STOCK', marketValue: 203564159.02, netAssetValuePercent: 30.4, country: 'Australia', currencyCode: 'AUD' },
      { securityDescription: 'ARISTOCRAT LEISURE LTD', securityId: '6253983', securityTicker: 'ALL', securityType: 'FOREIGN COMMON STOCK', marketValue: 82279838.71, netAssetValuePercent: 12.3, country: 'Australia', currencyCode: 'AUD' },
      { securityDescription: 'RIO TINTO LTD COMMON', securityId: '6220103', securityTicker: 'RIO', securityType: 'FOREIGN COMMON STOCK', marketValue: 116289198.26, netAssetValuePercent: 17.3, country: 'Australia', currencyCode: 'AUD' },
      { securityDescription: 'PETROLEO BRASILEIRO SA -', securityId: '71654V408', securityTicker: 'PBR', securityType: 'ADR', marketValue: 3000, netAssetValuePercent: 10, country: 'Brazil', currencyCode: 'USD' },
      { securityDescription: 'MERCADOLIBRE INC COMMON', securityId: 'B23X1H3', securityTicker: 'MELI', securityType: 'DOMESTIC COMMON STOCK', marketValue: 2000, netAssetValuePercent: 9, country: 'United States', currencyCode: 'USD' },
      { securityDescription: 'JARDINE MATHESON', securityId: '6472119', securityTicker: 'JARD.SI', securityType: 'DOMESTIC COMMON STOCK', marketValue: 1000, netAssetValuePercent: 8, country: 'Hong Kong', currencyCode: 'USD' },
      { securityDescription: 'ON HOLDING AG COMMON', securityId: 'BPF0FP9', securityTicker: 'ONON', securityType: 'DOMESTIC COMMON STOCK', marketValue: 950, netAssetValuePercent: 7.5, country: 'Switzerland', currencyCode: 'USD' },
      { securityDescription: 'INNER MONGOLIA YITAI', securityId: '6019011', securityTicker: '900948', securityType: 'DOMESTIC COMMON STOCK', marketValue: 920, netAssetValuePercent: 7.2, country: 'China', currencyCode: 'USD' },
      { securityDescription: 'ITAU UNIBANCO HOLDING SA', securityId: 'B037HR3', securityTicker: 'ITUB4', securityType: 'FOREIGN PREFERRED STOCK', marketValue: 900, netAssetValuePercent: 7, country: 'Brazil', currencyCode: 'BRL' },
      { securityDescription: 'AT&T INC CALLABLE', securityId: '00206R607', securityTicker: 'TPC', securityType: 'DOMESTIC PREFERRED STOCK', marketValue: 800, netAssetValuePercent: 6, country: 'United States', currencyCode: 'USD' },
    ];
    const rows = parseProductHoldings({ dailyHoldingsAll: { effectiveDate: '2026-10-23', data } }, 'BBAX')!.rows;
    expect(rows.map((row) => [row.Identifier, row.Ticker])).toEqual([
      ['6185495', '-'], ['6220103', '-'], ['6253983', '-'], ['71654V408', 'PBR'], ['B23X1H3', 'MELI'], ['6472119', '-'], ['BPF0FP9', 'ONON'], ['6019011', '-'], ['B037HR3', '-'], ['00206R607', '-'],
    ]);
    expect([isUsListing('037833100', '', ''), isUsListing('US0378331005', 'United States', 'USD'), isUsListing('6185495', 'Australia', 'AUD'), isUsListing('6185495', 'United States', 'TWD'), isUsListing('', '', '')]).toEqual([true, true, false, false, true]);
  });

  test('holdings guard: header-only, renamed weight column, broken weights, a bad weight sum and a halved sheet are rejected', () => {
    const headers = ['Name', 'Ticker', 'Weight'];
    const rows = [{ Name: 'A', Ticker: 'A', Weight: '60%' }, { Name: 'B', Ticker: 'B', Weight: '40%' }];
    expect(holdingsGuard(headers, rows, 2)).toBeNull();
    expect(holdingsGuard(headers, [['A', 'A', '60'], ['B', 'B', '40']], null)).toBeNull();
    expect(holdingsGuard([], [], 0)).toBeNull(); // nothing published before: an empty sheet is honest
    expect(holdingsGuard(headers, [], 505)).toContain('no holdings rows');
    expect(holdingsGuard(['Name', 'Ticker', 'Wt'], rows, 2)).toContain('no weight column');
    expect(holdingsGuard(headers, rows.map((row) => ({ ...row, Weight: '6\u200B0' })), 2)).toContain('numeric weight');
    const allocation = [{ Name: 'Cash&Collateral', Ticker: '-', Weight: '100' }, { Name: 'Equities', Ticker: '-', Weight: '476' }];
    expect(holdingsGuard(headers, allocation, 2)).toContain('outside 50..150');
    expect(holdingsGuard(headers, allocation, 2, ['sum'])).toBeNull();
    expect(holdingsGuard(headers, rows, 5)).toContain('less than half');
  });

  test('holdings order is canonical, so a reshuffled source answer writes identical pages', () => {
    const rows = [
      { securityDescription: 'CURRENCY CONTRACT - CNY', securityId: 'CCTCNY_46707_S', securityTicker: null, securityType: 'SPOT CONTRACTS', shares: -10707163, marketValue: 0, netAssetValuePercent: 0 },
      { securityDescription: 'CURRENCY CONTRACT - CNY', securityId: 'CCTCNY_42963_S', securityTicker: null, securityType: 'SPOT CONTRACTS', shares: -10652727, marketValue: 0, netAssetValuePercent: 0 },
      { securityDescription: 'KOREA 5% 09/26', securityId: '49151FB90', securityTicker: null, securityType: 'MUNICIPAL BONDS', shares: 1000000, marketValue: 1021341.4, netAssetValuePercent: 0.01 },
      { securityDescription: 'KOREA 5% 09/26', securityId: '49151F3A6', securityTicker: null, securityType: 'MUNICIPAL BONDS', shares: 1000000, marketValue: 1021341.4, netAssetValuePercent: 0.01 },
      { securityDescription: 'APPLE INC COMMON STOCK', securityId: '037833100', securityTicker: 'AAPL', securityType: 'DOMESTIC COMMON STOCK', shares: 10, marketValue: 2000, netAssetValuePercent: 1.5 },
      { securityDescription: 'USD CASH', securityId: null, securityTicker: null, securityType: 'CURRENCIES', shares: 0, marketValue: 0.74, netAssetValuePercent: 0 },
    ];
    const ids = (order: typeof rows) => parseProductHoldings({ dailyHoldingsAll: { data: order } }, 'XXXX')!.rows.map((row) => row.Identifier);
    const expected = ['037833100', '49151F3A6', '49151FB90', '-', 'CCTCNY_42963_S', 'CCTCNY_46707_S'];
    expect(ids(rows)).toEqual(expected);
    expect(ids([...rows].reverse())).toEqual(expected);
    expect(ids([rows[1], rows[3], rows[5], rows[0], rows[2], rows[4]])).toEqual(expected);
    expect(compareHoldingRows({ Weight: '' }, { Weight: '-0.04' })).toBeGreaterThan(0); // blank weights sort last
    expect(compareHoldingRows({ Weight: '0', Name: 'B' }, { Weight: '0', Name: 'a' })).toBeLessThan(0); // locale independent
  });

  test('ticker, name and frequency vocabularies', () => {
    const tickers: [string, string, string][] = [
      ['DOMESTIC COMMON STOCK', 'AAPL', 'AAPL'], ['REIT', 'PLD', 'PLD'], ['ADR', 'TSM', 'TSM'], ['MONEY MARKET', 'JIMXX', 'JIMXX'], ['EXCHANGE TRADED FUND', 'JEPQ', 'JEPQ'], ['', 'MSFT', 'MSFT'],
      ['TREASURY NOTES', 'T', ''], ['CORPORATE BONDS', 'COF', ''], ['COMMERCIAL PAPER', 'GS', ''], ['EQUITY INDEX FUTURES', 'ESZ6', ''], ['EQUITY LINKED NOTES', 'SPX', ''],
      ['CURRENCIES', 'USD', ''], ['SPOT CONTRACTS', 'JPY', ''], ['DOMESTIC COMMON STOCK', 'n/a', ''],
    ];
    for (const [type, symbol, expected] of tickers) expect(holdingTickerFor(type, symbol)).toBe(expected);
    const cleaned: [string, string][] = [['brk-b', 'BRK-B'], ['SCE^L', 'SCE^L'], ['BF/A', 'BF/A'], ['', ''], ['N/A', ''], ['see file', '']];
    for (const [input, expected] of cleaned) expect(cleanHoldingTicker(input)).toBe(expected);

    expect(decodeDividendFrequency('MDEC')).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    expect(decodeDividendFrequency('QDEC')).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
    expect(decodeDividendFrequency('SDEC')).toEqual({ frequency: 'Semi-annually', paymentsPerYear: 2 });
    expect(decodeDividendFrequency('YDEC')).toEqual({ frequency: 'Annually', paymentsPerYear: 1 });
    expect(decodeDividendFrequency('DACC')).toEqual({ frequency: 'Daily', paymentsPerYear: null });
    for (const unknown of ['', null, 'ZZZ']) expect(decodeDividendFrequency(unknown)).toBeNull();
    const at = (months: number[]) => months.map((month) => ({ epoch: Date.UTC(2026, month, 15) / 1000, amount: 1 }));
    expect(inferDistributionFrequency(at([0, 3, 6, 9])).frequency).toBe('Quarterly');
    expect(inferDistributionFrequency(at([0, 1, 2, 3, 4, 5]))).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });
});

describe('parsing 3', () => {
  test('history: official NAV series, positive dividends only, quarter-end returns; Yahoo chart fallback', () => {
    const historical = parseHistoricalData(HISTORICAL_DATA_FIXTURE, 'JEPI');
    expect(historical.points.map((point) => point.date)).toEqual(['2020-05-20', '2026-08-29', '2026-09-01', '2026-09-17', '2026-09-18']);
    expect(historical.points[4]).toEqual({ date: '2026-09-18', nav: 56.2213, marketPrice: 56.24, premiumDiscount: 0.0332 });
    expect(historical.points[0].premiumDiscount).toBe(0.04);
    expect(historical.dividends.map((dividend) => dividend.exDate)).toEqual(['2026-08-01', '2026-09-01']);
    expect(historical.dividends[1]).toEqual({ epoch: isoToEpoch('2026-09-01')!, amount: 0.37421, exDate: '2026-09-01', payDate: '2026-09-04', recordDate: '2026-09-01', reinvestNav: 55.9, type: 'DVDYLD' });
    expect(historical.quarterEnd).toEqual({ ytd: 2.2, yr1: 7.77, yr3: 8.99, yr5: 7.47, yr10: null, sinceInception: 10.82, asOfDate: '2026-06-30', mo1: 1.53, mo3: 1.88 });
    expect(historical.quarterEndMarket.yr1).toBe(7.8);
    expect(historical.monthlyReturns).toEqual([{ date: '2026-07-31', value: 2.17 }, { date: '2026-08-31', value: 1.53 }]);
    const empty = parseHistoricalData({}, 'XXXX');
    expect([empty.points, empty.dividends, empty.quarterEnd.asOfDate]).toEqual([[], [], null]);
    expect(() => parseHistoricalData(null as any, 'XXXX')).toThrow(/not an object/);
    expect(HISTORY_HEADERS).toEqual(['Date', 'NAV', 'Market Price', 'Premium/Discount']);
    expect(YAHOO_HISTORY_HEADERS).toEqual(['Date', 'Close', 'Adj Close', 'Volume']);

    const chart = parseChart(chartFixture({ closes: [100, null, 110], adj: [90, null, 99] }));
    expect(chart.days.map((day) => [day.close, day.adjClose])).toEqual([[100, 90], [110, 99]]);
    expect([chart.navPrice, chart.exchangeName]).toEqual([706.3, 'NasdaqGS']);
    const noAdj = chartFixture({ closes: [100, 101] }) as any;
    delete noAdj.chart.result[0].indicators.adjclose;
    expect(parseChart(noAdj).days.map((day) => day.adjClose)).toEqual([100, 101]);
    const dividends = { '2': { date: Date.UTC(2026, 5, 15) / 1000, amount: 0.7 }, '1': { date: Date.UTC(2026, 2, 15) / 1000, amount: 0.65 }, '0': { date: Date.UTC(2025, 11, 15) / 1000, amount: -1 } };
    expect(parseChart(chartFixture({ dividends })).dividends.map((entry) => entry.amount)).toEqual([0.65, 0.7]);
    expect(() => parseChart({ chart: { result: [] } })).toThrow(/empty result/);
  });

  test('SEC EDGAR fallback (shared nport-reader): ticker map, N-PORT sheet with empty missing numbers, no derivative identifiers, tickers only for U.S. equities', () => {
    const map = parseSecFundTickers({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1485894, 'S000068402', 'C000218810', 'JEPI'], [1485894, 'S000061995', 'C000200806', 'bbjp'], [0, 'S0', 'C0', 'ZZZ']] });
    expect(map.get('JEPI')).toEqual({ cik: '0001485894', seriesId: 'S000068402', classId: 'C000218810' });
    expect(map.get('BBJP')?.seriesId).toBe('S000061995');
    expect(map.has('ZZZ')).toBe(false);
    const xml = `<edgarSubmission><genInfo><regName>J.P. Morgan Exchange-Traded Fund Trust</regName><regCik>0001485894</regCik><seriesName>JPMorgan Equity Premium Income ETF</seriesName><seriesId>S000068402</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>87850000000.00</netAssets></fundInfo>
<invstOrSecs><invstOrSec><name>Visa Inc</name><cusip>92826C839</cusip><identifiers><isin value="US92826C8394"/></identifiers><balance>124827810.00000000</balance><curCd>USD</curCd><valUSD>26312454069.9</valUSD><pctVal>8.24</pctVal><assetCat>EC</assetCat></invstOrSec>
<invstOrSec><name>Visa Inc</name><cusip>92826CAD4</cusip><balance>5000000</balance><curCd>USD</curCd><valUSD>5100000</valUSD><assetCat>DBT</assetCat><debtSec><maturityDt>2028-01-31</maturityDt><annualizedRt>4.125</annualizedRt></debtSec></invstOrSec>
<invstOrSec><name>S&amp;P500 EMINI FUT</name><cusip>000000000</cusip><identifiers><other otherDesc="Bloomberg Identifier" value="BBG01VKPGXL9"/></identifiers><curCd>USD</curCd><valUSD>4913771.74</valUSD><pctVal>0.005</pctVal><assetCat>DE</assetCat><derivativeInfo><futrDeriv derivCat="FUT"><descRefInstrmnt><otherRefInst><identifiers><cusip value="78462F103"/><ticker value="SPY"/></identifiers></otherRefInst></descRefInstrmnt></futrDeriv></derivativeInfo></invstOrSec></invstOrSecs></edgarSubmission>`;
    const filing = parseNportFiling(xml);
    expect([filing.seriesId, filing.seriesName, filing.repPdDate, filing.netAssets, filing.positions.length]).toEqual(['S000068402', 'JPMorgan Equity Premium Income ETF', '2026-06-30', 87_850_000_000, 3]);
    const sheet = nportHoldingsSheet(filing, nportTickers(filing.positions, parseSecCompanyNames({ 0: { cik_str: 1403161, ticker: 'V', title: 'VISA INC.' } })));
    expect(sheet.headers).toEqual(BOND_SHEET_HEADERS);
    expect(sheet.rows[0]).toEqual({ Name: 'Visa Inc', Ticker: 'V', Identifier: '92826C839', Weight: '8.24', 'Market Value': '26312454069.9', 'Shares Held': '124827810', 'Asset Category': 'EC', Coupon: '', Maturity: '' });
    // JPM-2: the Visa bond keeps no stock ticker and an empty weight, never 0; the future keeps its own id, not SPY's
    expect(sheet.rows.slice(1).map((row) => [row.Ticker, row.Identifier, row.Weight, row.Coupon, row.Maturity])).toEqual([['-', '92826CAD4', '', '4.125', 'Jan 31 2028'], ['-', 'BBG01VKPGXL9', '0.005', '', '']]);
    expect(nportHoldingsSheet({ ...filing, positions: filing.positions.slice(0, 1) }, ['V']).headers).toEqual(HOLDINGS_HEADERS);
    // a preferred row (EP) never takes the common stock's ticker: the name match alone would give an AT&T preferred "T" (the shared block, Q31)
    const preferred = parseNportFiling('<invstOrSec><name>AT&amp;T Inc.</name><cusip>00206R706</cusip><identifiers><isin value="US00206R7061"/></identifiers><curCd>USD</curCd><valUSD>100</valUSD><pctVal>1</pctVal><assetCat>EP</assetCat></invstOrSec>');
    const att = nportTickers(preferred.positions, parseSecCompanyNames({ 0: { cik_str: 732717, ticker: 'T', title: 'AT&T INC.' } }));
    expect([att, nportHoldingsSheet(preferred, att).rows[0].Ticker]).toEqual([[''], '-']);
  });

  test('am.jpmorgan.com URL builders', () => {
    expect(fundNameSlug('JPMorgan BetaBuilders U.S. Equity ETF')).toBe('jpmorgan-betabuilders-us-equity-etf');
    expect(fundNameSlug('JPMorgan Income & Growth ETF')).toBe('jpmorgan-income-and-growth-etf');
    expect(fundNameSlug('')).toBe('');
    const base = 'https://am.jpmorgan.com';
    expect(jpmorganFundPageUrl('JPMorgan Equity Premium Income ETF', '46641Q332')).toBe(`${base}/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-etf-shares-46641q332`);
    expect(jpmorganFundPageUrl('', '46641Q332')).toBe(`${base}/us/en/asset-management/adv/products/jpmorgan-etf-etf-shares-46641q332`);
    expect(jpmorganFundExplorerUrl()).toBe(`${base}/FundsMarketingHandler/fund-explorer?country=us&role=adv&userLoggedIn=false&language=en&fundType=etf`);
    expect(jpmorganFundExplorerUrl('per')).toContain('role=per');
    expect(jpmorganProductDataUrl('46641Q332')).toBe(`${base}/FundsMarketingHandler/product-data?cusip=46641Q332&country=us&role=adv&language=en&userLoggedIn=false`);
    expect(jpmorganHistoricalDataUrl('46641Q332')).toBe(`${base}/FundsMarketingHandler/historicalData?cusip=46641Q332&country=us&role=adv&language=en&userLoggedIn=false`);
    expect(jpmorganHoldingsDownloadUrl('46641Q332')).toBe(`${base}/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=46641Q332&country=us&role=adv&locale=en-US`);
    expect(jpmorganPricesDownloadUrl('46641Q332', 'adv', '2020-05-20', '2026-09-18')).toContain('type=historicalNav&cusip=46641Q332&country=us&role=adv&locale=en-US&fromDate=2020-05-20&toDate=2026-09-18');
  });
});

// ---------------------------------------------------------------------------
// Mocked fetch and a temporary feed root, shared by metrics, pipeline and network
// ---------------------------------------------------------------------------

type MockFund = { ticker: string; cusip: string; young?: boolean };
const MOCK_FUNDS: MockFund[] = ['AAA', 'BBB', 'CCC'].map((ticker, i) => ({ ticker, cusip: `4664${i}Q332` }));
const TICKERS = MOCK_FUNDS.map((fund) => fund.ticker);

function mockExplorerEntry(fund: MockFund): Record<string, any> {
  const entry = structuredClone(FUND_EXPLORER_FIXTURE[0]) as Record<string, any>;
  entry.ticker = fund.ticker;
  entry.identifier = fund.cusip;
  entry.name = `JPMorgan ${fund.ticker} ETF`;
  if (fund.young) {
    entry.atNavPerformanceReturn = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, inception: null };
    entry.atNavPerformanceReturnForQuarterEnd = {};
  }
  return entry;
}

function mockProduct(fund: MockFund): Record<string, any> {
  const payload = structuredClone(PRODUCT_DATA_FIXTURE) as Record<string, any>;
  payload.fundData.name = `JPMorgan ${fund.ticker} ETF`;
  payload.fundData.shareClass.ticker = fund.ticker;
  payload.fundData.shareClass.cusip = fund.cusip;
  payload.fundData.shareClass.expenses = { netExpense: 0.25, grossExpense: 0.35 };
  if (fund.young) {
    payload.fundData.shareClass.performanceReturns = [];
    payload.fundData.shareClass.cumulativePerformanceReturns = [];
  }
  return payload;
}

function installMockFetch(options: { delayMs?: number; failProduct?: string[]; emptyHistory?: string[]; funds?: MockFund[]; yahoo?: boolean; adjclose?: number[] } = {}): { requests: string[]; peak: () => number } {
  const requests: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const funds = options.funds ?? MOCK_FUNDS;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    requests.push(url);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      const fund = funds.find((item) => item.cusip === /cusip=([^&]+)/.exec(url)?.[1]);
      if (/fund-explorer/.test(url)) return json(funds.map(mockExplorerEntry));
      if (/product-data/.test(url) && fund) return options.failProduct?.includes(fund.ticker) ? new Response('boom', { status: 404 }) : json(mockProduct(fund));
      if (/historicalData/.test(url) && fund) return json(options.emptyHistory?.includes(fund.ticker) ? {} : HISTORICAL_DATA_FIXTURE);
      if (/query1\.finance\.yahoo\.com/.test(url) && options.yahoo) {
        return json({ chart: { result: [{ meta: { exchangeName: 'PCX', regularMarketPrice: 50 }, timestamp: [1780000000, 1780086400], indicators: { quote: [{ close: [50, 51], volume: [1, 2], open: [50, 51], high: [50, 51], low: [50, 51] }], adjclose: [{ adjclose: options.adjclose ?? [50, 51] }] } }] } });
      }
      return new Response('not found', { status: 404 });
    } finally {
      inFlight -= 1;
    }
  }) as unknown as typeof fetch;
  return { requests, peak: () => peak };
}

// Fully explicit controls: nothing is read from process.env.
const controlsFor = (extra: Record<string, string> = {}) => readConfig(resolve({ REQUEST_SLEEP: '0', CONCURRENCY: '1', SKIP_YAHOO: 'true', EDGAR_FALLBACK: 'false', ...extra }));

async function withTempFeed<T>(run: (root: URL, dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'jpm-feed-'));
  setApiRootForTests(pathToFileURL(`${dir}/`));
  try {
    return await run(pathToFileURL(`${dir}/`), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const readJson = async (root: URL, path: string) => JSON.parse(await Bun.file(new URL(path, root)).text());
const readIndex = async (root: URL): Promise<{ funds: Record<string, any>[]; counts: Record<string, number> }> => readJson(root, 'index.json');
/** Every file under dir (sorted paths) with its text: equal snapshots mean a run wrote nothing. */
function contentsOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (path: string): void => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full); else out[full] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}
/** product-data of one fund with every weight cell replaced (renamed fields: blank weights; '-': all-dash weights). */
function rewriteWeights(cusip: string, weight: (row: Record<string, unknown>) => Record<string, unknown>): void {
  const good = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await good(input, init);
    if (!/product-data/.test(String(input)) || !String(input).includes(cusip)) return response;
    const payload = await response.json();
    payload.fundData.dailyHoldingsAll.data = payload.fundData.dailyHoldingsAll.data.map(weight);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// metrics: null for unavailable (never 0), young funds, one key set, basis and date travel together
// ---------------------------------------------------------------------------

describe('metrics', () => {
  const KEYS = ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'dividendYieldText', 'dividendYieldBasis', 'secYield', 'secYieldText', 'returnsBasis', 'performanceAsOf'];
  const noOfficial = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
  const noDerived = { asOfDate: '2026-08-21', ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null };

  test('emptyMetrics has the full key set with null, never 0, and a basis text', () => {
    const metrics = emptyMetrics();
    expect(Object.keys(metrics)).toEqual(KEYS);
    expect(Object.values(metrics)).not.toContain(0);
    expect(metrics.returnsBasis).toBeTruthy();
  });

  test('deriveCatalogMetrics: official wins, derived fills gaps, same key set, returnsBasis then performanceAsOf', () => {
    const official = deriveCatalogMetrics(
      { ytd: 15.97, yr1: 18.34, yr3: 20.15, yr5: 17.42, yr10: 16.88, sinceInception: 19.44 },
      { asOfDate: '2026-08-21', ytd: 13.79, yr1: 54.21, cagr3y: 18.99, cagr5y: 12, cagr10y: 11, siAnn: 10, mo1: 1, qtd: 2 },
      0.44, null, null, null, 706.32, null, '2026-07-31',
    );
    expect(official).toMatchObject({ performanceAsOf: '2026-07-31', ytd: 15.97, tr1y: 18.34, cagr3y: 20.15, dividendYield: 0.44, secYield: null });
    expect(official.tr3y).toBe(annualizedToTotal(20.15, 3));
    expect(official.returnsBasis).toContain('official JPMorgan NAV total returns');

    const derived = deriveCatalogMetrics(noOfficial, { ...noDerived, ytd: 13.79, yr1: 54.21, cagr3y: 18.99 }, null, null, 0.65, 12, 41.72);
    expect(derived).toMatchObject({ ytd: 13.79, tr1y: 54.21, cagr5y: null, dividendYield: 18.7, dividendYieldText: '18.70%', performanceAsOf: '2026-08-21' });
    expect(derived.returnsBasis).toContain('not official NAV returns');

    const mixed = deriveCatalogMetrics({ ...noOfficial, ytd: 1 }, { ...noDerived, ytd: 9, yr1: 5 }, null, null, null, null, 10, null, '2026-07-31');
    expect([mixed.ytd, mixed.tr1y, mixed.performanceAsOf]).toEqual([1, 5, '2026-07-31']);
    expect(mixed.returnsBasis).toContain('official JPMorgan NAV total returns');
    expect(mixed.returnsBasis).toContain('1y derived from the daily NAV history');

    const none = deriveCatalogMetrics(noOfficial, noDerived, null, null, null, null, 10);
    expect(none.returnsBasis).toBeTruthy();
    expect(none.returnsBasis).not.toBe('-');
    expect(none.performanceAsOf).toBeNull();
    expect(none.ytd).toBeNull();

    const cumulative = deriveCatalogMetrics(
      { ytd: 5.36, yr1: 9.05, yr3: 9.51, yr5: 10.02, yr10: null, sinceInception: 11.25 },
      { asOfDate: '2026-09-18', ytd: 3.7, yr1: 9, cagr3y: 9.4, cagr5y: 10, cagr10y: null, siAnn: 11, mo1: 1, qtd: 2 },
      8.42, 7.59, 0.37421, 12, 56.24, { yr1: 9.05, yr3: 31.33, yr5: 61.17, yr10: null, sinceInception: 95.24 },
    );
    expect([cumulative.tr3y, cumulative.tr5y, cumulative.tr10y, cumulative.cagr3y, cumulative.secYield, cumulative.secYieldText]).toEqual([31.33, 61.17, null, 9.51, 7.59, '7.59%']);

    for (const metrics of [official, derived, mixed, none, cumulative]) {
      expect(Object.keys(metrics)).toEqual(KEYS);
      expect(Object.keys(metrics).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    }
  });

  test('dividendYieldBasis: one code per yield source, null with a null yield, kind texts map to codes', () => {
    const basis = (published: number | null, code: string | null, distribution: number | null = null) =>
      deriveCatalogMetrics(noOfficial, noDerived, published, null, distribution, distribution === null ? null : 12, 40, null, null, code).dividendYieldBasis;
    // product-data 12-month rolling yield
    expect(basis(0.44, 'official-trailing-12m')).toBe('official-trailing-12m');
    // a published yield of 0 is still published
    expect(basis(0, 'official-trailing-12m')).toBe('official-trailing-12m');
    // updater estimate from the latest distribution
    expect(basis(null, null, 0.5)).toBe('indicated');
    // a yield carried from an earlier run keeps the code it was stored with, never a new code
    expect(basis(3.1, 'indicated')).toBe('indicated');
    expect(basis(3.1, 'official-trailing-12m', 0.5)).toBe('official-trailing-12m');
    // no yield at all
    expect(basis(null, 'official-trailing-12m')).toBeNull();
    expect(yieldBasisFromKind('12-month rolling dividend yield (daily, official JPMorgan product-data), as of Sep 18 2026')).toBe('official-trailing-12m');
    expect(yieldBasisFromKind('12-month rolling dividend yield (month-end, official JPMorgan product-data)')).toBe('official-trailing-12m');
    expect(yieldBasisFromKind('indicated (latest distribution x payments per year / market price)')).toBe('indicated');
    expect(yieldBasisFromKind('some other official JPMorgan yield')).toBe('official-other');
    expect(yieldBasisFromKind('whatever')).toBe('indicated');
    expect(yieldBasisFromKind('not published: no distributions yet')).toBeNull();
    // withYieldBasis repairs rows from an older feed and nulls an orphan code
    expect(withYieldBasis({ dividendYield: 2 }, 'indicated (x)').dividendYieldBasis).toBe('indicated');
    expect(withYieldBasis({ dividendYield: 2, dividendYieldBasis: 'official-other' }).dividendYieldBasis).toBe('official-other');
    expect(withYieldBasis({ dividendYield: null, dividendYieldBasis: 'indicated' }).dividendYieldBasis).toBeNull();
    expect(emptyMetrics().dividendYieldBasis).toBeNull();
  });

  test('young funds get nulls for horizons they cannot have; since-inception needs a full year', () => {
    const now = new Date(Date.UTC(2026, 7, 21));
    const young = priceReturns([{ date: '2026-08-20', close: 10, adjClose: 10, volume: 1 }], now);
    expect([young.asOfDate, young.ytd, young.cagr3y, young.siAnn]).toEqual(['2026-08-20', null, null, null]);
    expect(priceReturns([], now).asOfDate).toBe('');
    const day = (date: string, adjClose: number) => ({ date, close: adjClose, adjClose, volume: 1 });
    const later = new Date('2026-09-26T00:00:00Z');
    expect(priceReturns([day('2025-11-25', 100), day('2026-09-25', 110)], later, null, '2025-11-25').siAnn).toBeNull();
    expect(priceReturns([day('2024-09-25', 100), day('2026-09-25', 121)], later, null, '2024-09-25').siAnn).toBeCloseTo(10, 1);
    // JPM-7: a HISTORY_RANGE=2y Yahoo window of a 2006 fund starts years after the first trade, so its
    // "since inception" would only repeat the 2-year CAGR; a start within 10 days of the first trade still counts
    expect(priceReturns([day('2024-09-25', 100), day('2026-09-25', 121)], later, null, '2006-04-03').siAnn).toBeNull();
    expect(priceReturns([day('2024-09-25', 100), day('2026-09-25', 121)], later, null, '2024-09-18').siAnn).toBeCloseTo(10, 1);
    expect(priceReturns([day('2024-09-25', 100), day('2026-09-25', 121)], later).siAnn).toBeNull();
    // official returns follow the shared calendar rule: a fund is one year old on its first anniversary, inclusive
    const official: Record<string, number | null> = { ytd: 1.2, yr1: 9.05, yr3: 9.51, yr5: null, yr10: null, sinceInception: 11.25 };
    const horizons = { yr1: 1, yr3: 3, yr5: 5, yr10: 10, sinceInception: 1 };
    expect(withoutYoungReturns(official, '2020-05-20', '2026-08-31', horizons)).toEqual(official);
    expect(withoutYoungReturns(official, '2026-07-30', '2026-08-31', horizons)).toEqual({ ...official, yr1: null, yr3: null, sinceInception: null });
    expect(withoutYoungReturns(official, '2025-08-31', '2026-08-31', horizons)).toEqual({ ...official, yr3: null });
    // 365 days after a 29 February start is one day before the anniversary (the old 365-day rule published it)
    expect(withoutYoungReturns(official, '2024-02-29', '2025-02-28', horizons).sinceInception).toBeNull();
    expect(withoutYoungReturns(official, null, '2026-08-31', horizons)).toEqual(official);
  });

  test('derived returns are anchored to the last close and skip windows before the reinvestment coverage', () => {
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
    const returns = priceReturns(days, now, null, '2015-01-02');
    expect(returns.asOfDate).toBe('2026-08-21');
    expect(returns.ytd).toBeCloseTo(54.21, 2);
    expect(returns.yr1).toBeCloseTo(54.21, 2);
    expect(returns.cagr3y).toBeCloseTo(15.53, 2);
    expect(returns.mo1).toBeCloseTo(5.77, 2);
    expect(returns.siAnn).toBeGreaterThan(0);
    // a weekly payer whose schedule only covers the last 12 payments: long windows stay null
    const covered = priceReturns(days, now, '2026-06-29', '2015-01-02');
    expect([covered.siAnn, covered.ytd, covered.yr1, covered.cagr3y]).toEqual([null, null, null, null]);
    const sinceJuly = ((330 - 312) / 312) * 100;
    expect(covered.qtd).toBeCloseTo(sinceJuly, 2);
    expect(covered.mo1).toBeCloseTo(sinceJuly, 2);
    expect(priceReturns(days, now, '2015-01-02', '2015-01-02')).toEqual(returns);
  });
});

describe('metrics 2', () => {

  test('NAV total return and reinvestment coverage helpers', () => {
    const point = (date: string, nav: number) => ({ date, nav, marketPrice: nav, premiumDiscount: 0 });
    const dividend = (exDate: string, amount = 0.067, reinvestNav: number | null = null) => ({ epoch: isoToEpoch(exDate)!, amount, exDate, payDate: '', recordDate: '', reinvestNav, type: 'DVDYLD' });
    const days = navTotalReturnDays([point('2026-08-29', 56.3), point('2026-09-01', 55.9), point('2026-09-17', 56.4101)], [dividend('2026-09-01', 0.37421, 55.9)]);
    const factor = 1 + 0.37421 / 55.9;
    expect(days[0]).toEqual({ date: '2026-08-29', close: 56.3, adjClose: 56.3, volume: 0 });
    expect(days[1].adjClose).toBeCloseTo(55.9 * factor, 6);
    expect(days[2].adjClose).toBeCloseTo(56.4101 * factor, 6);
    const exNav = navTotalReturnDays([point('2026-09-01', 50), point('2026-09-02', 51)], [dividend('2026-08-01', 1), dividend('2026-09-01', 0.5)]);
    expect(exNav[0].adjClose).toBeCloseTo(50 * 1.01, 6); // ex-date NAV, pre-history payout skipped
    expect(exNav[1].adjClose).toBeCloseTo(51 * 1.01, 6);
    expect(navTotalReturnDays([], [dividend('2026-09-01')])).toEqual([]);

    const points = [point('2025-12-10', 100.06), point('2026-09-18', 100.11)];
    expect(DIVIDEND_SCHEDULE_CAP).toBe(12);
    expect(reinvestmentCoverageStart(points, [])).toBe('2025-12-10');
    expect(reinvestmentCoverageStart(points, [dividend('2026-05-01'), dividend('2026-06-01')])).toBe('2025-12-10');
    const weekly = ['07-06', '07-10', '07-17', '07-24', '07-31', '08-07', '08-14', '08-21', '08-28', '09-04', '09-11', '09-18'].map((md) => dividend(`2026-${md}`));
    expect(reinvestmentCoverageStart(points, weekly)).toBe('2026-06-29'); // median gap 7 days before the earliest ex-date
    const monthly = Array.from({ length: 12 }, (_, i) => dividend(`2026-${String(i + 1).padStart(2, '0')}-01`));
    expect(reinvestmentCoverageStart([point('2026-06-15', 50), points[1]], monthly)).toBe('2026-06-15');
    expect(reinvestmentCoverageStart([], monthly)).toBeNull();
  });

  test('arithmetic helpers and quarter anchors', () => {
    expect(annualizedToTotal(20.15, 3)).toBeCloseTo(73.45, 2);
    expect(annualizedToTotal(null, 3)).toBeNull();
    expect(annualizedToTotal(10, 0)).toBeNull();
    expect(totalToAnnualized(annualizedToTotal(12.5, 5), 5)).toBeCloseTo(12.5, 1);
    expect(totalToAnnualized('n/a' as any, 5)).toBeNull();
    expect(indicatedYield(0.7, 4, 706.32)).toBeCloseTo(0.4, 1);
    expect(indicatedYield(0.65, 12, 41.72)).toBe(18.7);
    expect([indicatedYield(null, 4, 10), indicatedYield(0.5, 0, 10), indicatedYield(0.5, 4, 0)]).toEqual([null, null, null]);
    const quarter = (month: number, dayOfMonth: number) => lastCompletedQuarterEnd(new Date(Date.UTC(2026, month, dayOfMonth))).toISOString().slice(0, 10);
    expect([quarter(7, 21), quarter(0, 15), quarter(4, 1), quarter(10, 1)]).toEqual(['2026-06-30', '2025-12-31', '2026-03-31', '2026-09-30']);
  });

  test('N-PORT freshness: a report replaces published holdings only when strictly newer; nothing published accepts any report', () => {
    expect(nportIsFresh('2026-06-30', '2026-08-31', 135)).toBe(false);
    expect(nportIsFresh('2026-08-31', '2026-08-31', 135)).toBe(false); // the old JPMorgan check took an equal date
    expect(nportIsFresh('2026-09-30', '2026-08-31', 135)).toBe(true);
    expect(nportIsFresh('', '2026-08-31', 135)).toBe(false);
    expect(nportIsFresh('2026-06-30', null, 0)).toBe(true);
    expect(nportIsFresh('2026-06-30', '', 135)).toBe(false); // published rows without a date cannot be compared: keep them
  });
});

describe('metrics 3', () => {
  const KEYS = ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'dividendYieldText', 'dividendYieldBasis', 'secYield', 'secYieldText', 'returnsBasis', 'performanceAsOf'];

  test('dates: month-name and U.S. dates are the same calendar day in every time zone', () => {
    for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = tz;
      expect(['Oct 24, 2026', 'Oct 24 2026', '24 Oct 2026', '10/24/2026', '10/24/26', '2026-10-24', '2026-10-24T00:00:00Z'].map((raw) => toIsoDate(raw))).toEqual(Array(7).fill('2026-10-24'));
      expect(toIsoDate('not a date')).toBe('not a date');
      expect(formatJpmorganDate('Oct 24 2026')).toBe('10/24/2026');
    }
  });

  test('a fund younger than one year publishes no 1y, 3y or since-inception return, official or derived', async () => {
    installMockFetch();
    const good = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await good(input, init);
      if (!/fund-explorer|product-data/.test(String(input))) return response;
      return new Response((await response.text()).split('2020-05-20').join('2026-01-15'), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await withTempFeed(async (root) => {
      await runUpdater(controlsFor({ TICKERS: 'AAA' }));
      const row = (await readIndex(root)).funds[0];
      expect([row.metrics.ytd, row.metrics.tr1y, row.metrics.tr3y, row.metrics.cagr3y, row.metrics.cagr5y, row.metrics.siAnn, row.metrics.performanceAsOf]).toEqual([5.36, null, null, null, null, null, '2026-08-31']);
      expect([row.returns.monthEnd.yr1, row.returns.monthEnd.sinceInception, row.returns.quarterEnd.yr1, row.returns.quarterEnd.sinceInception]).toEqual([null, null, null, null]);
    });
  });

  test('index rows: terValue is the NET ratio, one key set for official and young funds, performanceAsOf dates', async () => {
    installMockFetch({ funds: [MOCK_FUNDS[0], { ...MOCK_FUNDS[1], young: true }] });
    await withTempFeed(async (root) => {
      await runUpdater(controlsFor());
      const [official, young] = (await readIndex(root)).funds;
      expect([official.terValue, official.terGrossValue, official.ter]).toEqual([0.25, 0.35, '0.25%']);
      const meta = await readJson(root, 'funds/AAA/meta.json');
      expect([meta.expenseRatio.value, meta.expenseRatio.gross, meta.expenseRatio.net]).toEqual([0.25, 0.35, 0.25]);
      expect(Object.keys(official.metrics)).toEqual(withRangeKeys(KEYS));
      expect(Object.keys(young.metrics)).toEqual(withRangeKeys(KEYS));
      expect(official.metrics.returnsBasis).toBeTruthy();
      expect(young.metrics.returnsBasis).toBeTruthy();
      for (const row of [official, young]) expect(row.metrics.dividendYieldBasis === null).toBe(row.metrics.dividendYield === null);
      // an official month-end table keeps its own date, the later price-return date is reported separately
      expect([official.returns.monthEnd.asOfDate, official.returns.monthEnd.priceReturnsAsOf, official.metrics.performanceAsOf]).toEqual(['Aug 31 2026', 'Sep 18 2026', '2026-08-31']);
      // without official returns the fund is dated by its price history, never by the product-data table date
      expect([young.returns.monthEnd.asOfDate, young.returns.monthEnd.priceReturnsAsOf]).toEqual(['Sep 18 2026', 'Sep 18 2026']);
      expect([null, '2026-09-18']).toContain(young.metrics.performanceAsOf);
    });
  });
});

// ---------------------------------------------------------------------------
// pipeline: mocked fetch, a 3-fund catalog, a temporary feed root
// ---------------------------------------------------------------------------

describe('pipeline', () => {
  test('a one-ticker run keeps every published row and only fetches the selected fund', async () => {
    installMockFetch();
    await withTempFeed(async (root) => {
      await runUpdater(controlsFor());
      expect((await readIndex(root)).funds.length).toBe(3);
      const mock = installMockFetch();
      await runUpdater(controlsFor({ TICKERS: 'BBB' }));
      const index = await readIndex(root);
      expect(index.funds.map((fund) => fund.ticker)).toEqual(TICKERS);
      expect(index.counts.funds).toBe(3);
      // the published 12-month rolling yield carries its code on every row, fresh or kept
      expect(index.funds.map((fund) => [fund.metrics.dividendYield, fund.metrics.dividendYieldBasis])).toEqual(TICKERS.map(() => [8.42, 'official-trailing-12m']));
      expect(new Set(index.funds.map((fund) => Object.keys(fund.metrics).join()))).toHaveProperty('size', 1);
      for (const fund of index.funds) expect(Object.keys(fund.metrics)).toEqual(expect.arrayContaining(RANGE_KEYS));
      expect(mock.requests.some((url) => url.includes('46641Q332'))).toBe(true);
      expect(mock.requests.some((url) => url.includes('46640Q332'))).toBe(false);
    });
  });

  test('a second identical run writes nothing: same bytes, same mtimes, no temporary files', async () => {
    installMockFetch();
    const snapshot = (dir: string): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (path: string): void => {
        for (const name of readdirSync(path).sort()) {
          const full = join(path, name);
          if (statSync(full).isDirectory()) walk(full); else out[full] = `${statSync(full).mtimeMs}:${readFileSync(full, 'utf8')}`;
        }
      };
      walk(dir);
      return out;
    };
    await withTempFeed(async (_root, dir) => {
      await runUpdater(controlsFor());
      const old = new Date('2000-01-01T00:00:00Z');
      for (const full of Object.keys(snapshot(dir))) utimesSync(full, old, old);
      const first = snapshot(dir);
      await runUpdater(controlsFor());
      expect(snapshot(dir)).toEqual(first);
      expect(Object.keys(first).some((name) => name.endsWith('.tmp'))).toBe(false);
    });
  });

  test('a fund whose source failed keeps its previous state byte for byte; a run where every fund failed errors', async () => {
    installMockFetch();
    await withTempFeed(async (root) => {
      await runUpdater(controlsFor());
      const before = { meta: await Bun.file(new URL('funds/BBB/meta.json', root)).text(), row: (await readIndex(root)).funds[1] };
      installMockFetch({ failProduct: ['BBB'] });
      await runUpdater(controlsFor());
      expect(await Bun.file(new URL('funds/BBB/meta.json', root)).text()).toBe(before.meta);
      expect((await readIndex(root)).funds[1]).toEqual(before.row);
      globalThis.fetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
      await expect(runUpdater(controlsFor())).rejects.toThrow(/every examined fund failed/);
      expect((await readIndex(root)).funds.length).toBe(3);
    });
  });

  test('holdings that fail the guard keep the fund exactly as published and report it failed', async () => {
    const realSummary = process.env.GITHUB_STEP_SUMMARY;
    const summaryDir = mkdtempSync(join(tmpdir(), 'jpm-summary-'));
    try {
      installMockFetch();
      await withTempFeed(async (_root, dir) => {
        await runUpdater(controlsFor());
        const contents = () => {
          const out: Record<string, string> = {};
          const walk = (path: string): void => {
            for (const name of readdirSync(path).sort()) {
              const full = join(path, name);
              if (statSync(full).isDirectory()) walk(full); else out[full] = readFileSync(full, 'utf8');
            }
          };
          walk(dir);
          return out;
        };
        const before = contents();
        // product-data renames its weight fields for BBB: every Weight cell of the fresh sheet turns blank
        const good = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await good(input, init);
          if (!/product-data/.test(String(input)) || !String(input).includes(MOCK_FUNDS[1].cusip)) return response;
          const payload = await response.json();
          payload.fundData.dailyHoldingsAll.data = payload.fundData.dailyHoldingsAll.data.map(({ netAssetValuePercent, marketValuePercent, ...rest }: Record<string, unknown>) => ({ ...rest, weightPct: netAssetValuePercent }));
          return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof fetch;
        const summary = join(summaryDir, 'summary.md');
        process.env.GITHUB_STEP_SUMMARY = summary;
        await runUpdater(controlsFor());
        expect(contents()).toEqual(before);
        expect(readFileSync(summary, 'utf8')).toContain('- failed: 1');
      });
    } finally {
      if (realSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = realSummary;
      rmSync(summaryDir, { recursive: true, force: true });
    }
  });
});

describe('pipeline 2', () => {
  test('a new fund whose holdings the guard rejects gets a catalog-only row, is reported failed and is never read as published data', async () => {
    const realSummary = process.env.GITHUB_STEP_SUMMARY;
    const summaryDir = mkdtempSync(join(tmpdir(), 'jpm-summary-'));
    // product-data renames its weight fields for CCC: every Weight cell of the fresh sheet turns blank
    const rejectCcc = (good: typeof fetch) => (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await good(input, init);
      if (!/product-data/.test(String(input)) || !String(input).includes(MOCK_FUNDS[2].cusip)) return response;
      const payload = await response.json();
      payload.fundData.dailyHoldingsAll.data = payload.fundData.dailyHoldingsAll.data.map(({ netAssetValuePercent, marketValuePercent, ...rest }: Record<string, unknown>) => ({ ...rest, weightPct: netAssetValuePercent }));
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    try {
      await withTempFeed(async (root, dir) => {
        installMockFetch({ funds: MOCK_FUNDS.slice(0, 2) });
        await runUpdater(controlsFor());
        installMockFetch();
        globalThis.fetch = rejectCcc(globalThis.fetch);
        const summary = join(summaryDir, 'summary.md');
        process.env.GITHUB_STEP_SUMMARY = summary;
        await runUpdater(controlsFor());
        expect(readFileSync(summary, 'utf8')).toContain('- failed: 1');
        const rows = (await readIndex(root)).funds;
        expect(rows.map((row) => row.ticker)).toEqual(TICKERS);
        const ghost = rows[2];
        expect(ghost).toMatchObject({ ticker: 'CCC', name: 'JPMorgan CCC ETF', cusip: MOCK_FUNDS[2].cusip, dataFile: null, holdings: 0, history: 0 });
        expect(Object.keys(ghost.metrics)).toEqual(withRangeKeys(Object.keys(emptyMetrics())));
        expect(ghost.metrics.returnsBasis).toBeTruthy();
        expect(Object.values(ghost.metrics).filter((value) => typeof value === 'number')).toEqual([]);
        expect(readdirSync(join(dir, 'funds')).sort()).toEqual(['AAA', 'BBB']);
        // still rejected on its own: the failure fails the run (exit code 1), the catalog-only row stays as it was
        const index = readFileSync(join(dir, 'index.json'), 'utf8');
        installMockFetch();
        globalThis.fetch = rejectCcc(globalThis.fetch);
        await expect(runUpdater(controlsFor({ TICKERS: 'CCC' }))).rejects.toThrow(/every examined fund failed/);
        expect(readFileSync(join(dir, 'index.json'), 'utf8')).toBe(index);
        // fresh holdings pass (a young fund, no returns yet): a full row from the fund's own sources, and nothing of
        // the catalog-only row is read as its previous state (its empty returns block never reaches meta.json)
        installMockFetch({ funds: [MOCK_FUNDS[0], MOCK_FUNDS[1], { ...MOCK_FUNDS[2], young: true }], emptyHistory: ['CCC'] });
        await runUpdater(controlsFor({ TICKERS: 'CCC' }));
        const fresh = (await readIndex(root)).funds[2];
        expect(fresh).toMatchObject({ ticker: 'CCC', dataFile: './funds/CCC/meta.json', terValue: 0.25 });
        expect(fresh.holdings).toBeGreaterThan(0);
        expect((await readJson(root, 'funds/CCC/meta.json')).returns).toBeNull();
      });
    } finally {
      if (realSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = realSummary;
      rmSync(summaryDir, { recursive: true, force: true });
    }
  });

  test('a closed fund is never fetched or reported failed: its files stay as published, its index row says closed, a rerun writes nothing', async () => {
    const entry = { ticker: 'BBB', closed: '2026-10-01', source: 'https://www.sec.gov/Archives/edgar/data/1485894/notice.htm' };
    expect(() => closedFund([{ ...entry, closed: 'soon' }], 'BBB')).toThrow('CLOSED_FUNDS');
    expect(closedFund([entry], 'bbb')).toEqual(entry);
    const contents = (dir: string): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (path: string): void => {
        for (const name of readdirSync(path).sort()) {
          const full = join(path, name);
          if (statSync(full).isDirectory()) walk(full); else out[full] = readFileSync(full, 'utf8');
        }
      };
      walk(dir);
      return out;
    };
    await withTempFeed(async (root, dir) => {
      installMockFetch();
      await runUpdater(controlsFor());
      const first = contents(dir);
      // BBB's fresh holdings would fail the guard if it were still processed
      const mock = installMockFetch();
      const good = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await good(input, init);
        if (!/product-data/.test(String(input)) || !String(input).includes(MOCK_FUNDS[1].cusip)) return response;
        const payload = await response.json();
        payload.fundData.dailyHoldingsAll.data = payload.fundData.dailyHoldingsAll.data.map(({ netAssetValuePercent, marketValuePercent, ...rest }: Record<string, unknown>) => ({ ...rest, weightPct: netAssetValuePercent }));
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;
      CLOSED_FUNDS.push(entry);
      try {
        await runUpdater(controlsFor({ TICKERS: 'BBB' }));
        expect(mock.requests.filter((url) => url.includes(MOCK_FUNDS[1].cusip) || /BBB/.test(url))).toEqual([]);
        expect(process.exitCode).not.toBe(1);
        const closed = contents(dir);
        for (const path of Object.keys(first)) if (!path.endsWith('index.json')) expect([path, closed[path]]).toEqual([path, first[path]]);
        const rows = (await readIndex(root)).funds;
        expect(rows.map((row) => row.ticker)).toEqual(TICKERS);
        expect(rows[1]).toMatchObject({ status: 'closed', closedDate: '2026-10-01', closedSource: entry.source, dataFile: './funds/BBB/meta.json' });
        expect(rows.filter((row) => row.status === 'closed')).toHaveLength(1);
        await runUpdater(controlsFor());
        expect(contents(dir)).toEqual(closed);
      } finally {
        CLOSED_FUNDS.splice(CLOSED_FUNDS.indexOf(entry), 1);
      }
    });
  });

  test('a fund that lost its index row is rebuilt from meta.json; a row without meta gets dataFile null and the full key set', async () => {
    installMockFetch();
    await withTempFeed(async (root) => {
      await runUpdater(controlsFor());
      const index = await readIndex(root);
      const trimmed = { ...index, funds: index.funds.filter((fund) => fund.ticker !== 'CCC').concat([{ ticker: 'ZZZ', name: 'Ghost', dataFile: './funds/ZZZ/meta.json' }]) };
      writeFileSync(new URL('index.json', root), JSON.stringify(trimmed), 'utf8');
      installMockFetch();
      await runUpdater(controlsFor({ TICKERS: 'AAA' }));
      const after = await readIndex(root);
      expect(after.funds.map((fund) => fund.ticker)).toEqual(['AAA', 'BBB', 'CCC', 'ZZZ']);
      const rebuilt = after.funds.find((fund) => fund.ticker === 'CCC')!;
      expect(rebuilt).toMatchObject({ dataFile: './funds/CCC/meta.json', terValue: 0.25 });
      expect(rebuilt.metrics.ytd).toBe(5.36);
      expect(rebuilt.holdings).toBeGreaterThan(0);
      const ghost = after.funds.find((fund) => fund.ticker === 'ZZZ')!;
      expect(ghost.dataFile).toBeNull();
      expect(Object.keys(ghost.metrics)).toEqual(withRangeKeys(Object.keys(emptyMetrics())));
      expect(ghost.metrics.returnsBasis).toBeTruthy();
      // indexRowFromMeta reproduces the row the updater wrote (the 52-week keys are added later, from the history pages)
      const row = after.funds[0];
      const again = indexRowFromMeta(await readJson(root, 'funds/AAA/meta.json'));
      expect(again.metrics).toEqual(rangeless(row.metrics));
      expect(withRangeKeys(Object.keys(again.metrics))).toEqual(Object.keys(ghost.metrics));
      expect(Object.keys(rebuilt.metrics)).toEqual(Object.keys(ghost.metrics));
      expect(rebuilt.metrics.dividendYieldBasis === null).toBe(rebuilt.metrics.dividendYield === null);
      for (const key of ['ticker', 'name', 'cusip', 'ter', 'terValue', 'terGrossValue', 'navValue', 'aumValue', 'closePriceValue', 'holdings', 'history', 'dataFile', 'asOfDate', 'inceptionDate', 'exchange', 'returns', 'distributions']) {
        expect(again[key]).toEqual(row[key]);
      }
    });
  });

  test('an official NAV history is never replaced by the Yahoo schema', async () => {
    installMockFetch();
    await withTempFeed(async (root) => {
      await runUpdater(controlsFor());
      const headers = (await readJson(root, 'funds/AAA/history/001.json')).headers;
      expect(headers).toContain('NAV');
      installMockFetch({ emptyHistory: ['AAA'], yahoo: true });
      await runUpdater(controlsFor({ SKIP_YAHOO: 'false', TICKERS: 'AAA' }));
      expect((await readJson(root, 'funds/AAA/history/001.json')).headers).toEqual(headers);
      expect((await readJson(root, 'funds/AAA/meta.json')).history.source).toBe('previous run');
    });
  });
});

describe('pipeline 3', () => {
  test('two runs on the same Yahoo history write zero changes even when adjusted closes jitter across a cent boundary', async () => {
    const snapshot = (dir: string): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (path: string): void => {
        for (const name of readdirSync(path).sort()) {
          const full = join(path, name);
          if (statSync(full).isDirectory()) walk(full); else out[full] = readFileSync(full, 'utf8');
        }
      };
      walk(dir);
      return out;
    };
    const yahooRun = async (adjclose: number[]) => {
      installMockFetch({ emptyHistory: ['AAA'], yahoo: true, adjclose });
      await runUpdater(controlsFor({ SKIP_YAHOO: 'false', TICKERS: 'AAA' }));
    };
    await withTempFeed(async (root, dir) => {
      // Yahoo float32 noise seen live: SPDV 2024-11-12 came back as 31.544998 and 31.545001 a minute apart
      await yahooRun([49.915001, 50.984999]);
      const first = snapshot(dir);
      expect((await readJson(root, 'funds/AAA/history/001.json')).rows.map((row: Record<string, string>) => row['Adj Close'])).toEqual(['49.92', '50.98']);
      await yahooRun([49.914998, 50.985002]);
      expect(snapshot(dir)).toEqual(first);
      // a real change beyond the noise is still written
      await yahooRun([49.9, 50.97]);
      expect((await readJson(root, 'funds/AAA/history/001.json')).rows.map((row: Record<string, string>) => row['Adj Close'])).toEqual(['49.9', '50.97']);
    });
  });

  test('a HISTORY_RANGE window never shrinks a published Yahoo history: older days are rescaled to the new adjusted closes', async () => {
    await withTempFeed(async (root) => {
      installMockFetch({ emptyHistory: ['AAA'], yahoo: true });
      await runUpdater(controlsFor({ SKIP_YAHOO: 'false', TICKERS: 'AAA' }));
      expect((await readJson(root, 'funds/AAA/meta.json')).history.totalRows).toBe(2);
      // a window that starts on the second published day plus one new day, after a dividend: every adjusted close x 0.99
      const good = globalThis.fetch;
      const windowed = { chart: { result: [{ meta: { exchangeName: 'PCX', regularMarketPrice: 52 }, timestamp: [1780086400, 1780172800], indicators: { quote: [{ close: [51, 52], volume: [2, 3] }], adjclose: [{ adjclose: [50.49, 51.48] }] } }] } };
      globalThis.fetch = (async (input: unknown, init?: RequestInit) =>
        /query1\.finance\.yahoo\.com/.test(String(input)) ? new Response(JSON.stringify(windowed), { status: 200 }) : good(input as RequestInfo, init)) as unknown as typeof fetch;
      await runUpdater(controlsFor({ SKIP_YAHOO: 'false', TICKERS: 'AAA', HISTORY_RANGE: '1y' }));
      const rows = (await readJson(root, 'funds/AAA/history/001.json')).rows;
      expect(rows.map((row: Record<string, string>) => [row.Close, row['Adj Close']])).toEqual([['50', '49.5'], ['51', '50.49'], ['52', '51.48']]);
      // a split moves the raw closes too: no honest join, the published history stays
      const split = JSON.parse(JSON.stringify(windowed));
      split.chart.result[0].indicators.quote[0].close = [25.5, 26];
      split.chart.result[0].indicators.adjclose[0].adjclose = [25.25, 25.74];
      globalThis.fetch = (async (input: unknown, init?: RequestInit) =>
        /query1\.finance\.yahoo\.com/.test(String(input)) ? new Response(JSON.stringify(split), { status: 200 }) : good(input as RequestInfo, init)) as unknown as typeof fetch;
      await runUpdater(controlsFor({ SKIP_YAHOO: 'false', TICKERS: 'AAA', HISTORY_RANGE: '1y' }));
      expect((await readJson(root, 'funds/AAA/history/001.json')).rows).toEqual(rows);
    });
  });

  test('filters and limits: SEC_YIELD filters for real, MAX_FETCHES counts selected funds, the cursor wraps and resets for another filter', async () => {
    installMockFetch();
    await withTempFeed(async (root) => {
      await runUpdater(controlsFor());
      const mock = installMockFetch();
      await runUpdater(controlsFor({ SEC_YIELD: '20:' }));
      expect(mock.requests.some((url) => /product-data|historicalData/.test(url))).toBe(false);
      expect((await readIndex(root)).funds.length).toBe(3);

      const stateBefore = readFileSync(new URL('update-state.json', root), 'utf8');
      await runUpdater(controlsFor({ TICKERS: 'CCC', MAX_FETCHES: '1' }));
      // a TICKERS run never reads, writes or deletes the cursor
      expect(readFileSync(new URL('update-state.json', root), 'utf8')).toBe(stateBefore);
      const seen: string[] = [];
      for (let run = 0; run < 3; run++) {
        await runUpdater(controlsFor({ MAX_FETCHES: '2' }));
        seen.push((await readJson(root, 'update-state.json')).cursor);
      }
      expect(seen).toEqual(['BBB', 'AAA', 'CCC']); // AAA,BBB then CCC,AAA (wrap) then BBB,CCC
      const rotated = readFileSync(new URL('update-state.json', root), 'utf8');
      await runUpdater(controlsFor({ MAX_FETCHES: '1', TICKERS: 'AAA' }));
      expect(readFileSync(new URL('update-state.json', root), 'utf8')).toBe(rotated);
    });
  });

  test('the soft deadline stops taking funds, still writes the full index and resumes where it stopped', async () => {
    installMockFetch({ delayMs: 25 });
    await withTempFeed(async (root) => {
      await runUpdater(controlsFor());
      configureFetchForTests({ deadlineMs: 40 });
      await runUpdater(controlsFor());
      const state = await readJson(root, 'update-state.json');
      expect(state.partial).toBe(true);
      expect(state.cursor).not.toBeNull();
      expect(state.cursor).not.toBe('CCC');
      expect((await readIndex(root)).funds.length).toBe(3);
      configureFetchForTests({ deadlineMs: 25 * 60_000 });
      await runUpdater(controlsFor());
      const done = await readJson(root, 'update-state.json');
      expect([done.partial, done.cursor]).toEqual([false, null]);
    });
  });

  test('a kept fund keeps the dates, distribution rows and source labels of its own meta.json, not the index row', async () => {
    installMockFetch();
    await withTempFeed(async (root) => {
      await runUpdater(controlsFor());
      const first = await readJson(root, 'funds/AAA/meta.json');
      expect([first.holdings.asOfDate, first.distributions.rows.length]).toEqual(['2026-09-17', 2]);
      // AAA's sheet came from an N-PORT filing; this run the fund explorer is down, product-data lists no positions,
      // net assets or dividend, and historicalData has no rows
      const nport = 'SEC EDGAR Form N-PORT-P (accession 0001485894-26-000123, report period 2026-09-17)';
      writeFileSync(new URL('funds/AAA/meta.json', root), JSON.stringify({ ...first, holdings: { ...first.holdings, source: nport } }));
      const base = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/fund-explorer/.test(url)) return new Response('down', { status: 503 });
        if (!url.includes(`cusip=${MOCK_FUNDS[0].cusip}`)) return base(input, init);
        if (/historicalData/.test(url)) return new Response('{}', { status: 200 });
        const payload = mockProduct(MOCK_FUNDS[0]);
        delete payload.fundData.dailyHoldingsAll;
        delete payload.fundData.shareClass.fundShareclassDividend;
        delete payload.fundData.shareClass.netGrossAssetClass;
        return new Response(JSON.stringify(payload), { status: 200 });
      }) as unknown as typeof fetch;
      await runUpdater(controlsFor({ TICKERS: 'AAA', MAX_RETRIES: '1' }));
      const kept = await readJson(root, 'funds/AAA/meta.json');
      // the index row has counts under holdings and history and no distribution rows: nothing is read from it
      expect([kept.holdings.asOfDate, kept.holdings.source, kept.source.holdingsSource, kept.holdings.totalRows]).toEqual(['2026-09-17', nport, nport, first.holdings.totalRows]);
      expect([kept.history.asOf, kept.history.source, kept.source.historySource]).toEqual([first.history.asOf, 'previous run', first.source.historySource]);
      expect(kept.history.asOf).not.toBe('—');
      expect([kept.aum.asOfDate, kept.aum.source]).toEqual([first.aum.asOfDate, 'previous run']);
      expect(kept.distributions.rows).toEqual(first.distributions.rows);
    });
  });
});

// ---------------------------------------------------------------------------
// network: timeout, bounded retries, real concurrency, HISTORY_RANGE request URL
// ---------------------------------------------------------------------------

describe('pipeline 4', () => {
  test('a HISTORY_RANGE run after a full run keeps the older history and writes nothing (Q25)', async () => {
    const DAYS = 30;
    const yahoo = (count: number) => {
      const timestamp = Array.from({ length: DAYS }, (_, i) => 1780000000 + i * 86_400).slice(-count);
      const close = Array.from({ length: DAYS }, (_, i) => 50 + i / 10).slice(-count);
      return { chart: { result: [{ meta: { exchangeName: 'PCX', regularMarketPrice: 53 }, timestamp, indicators: { quote: [{ close, volume: timestamp.map(() => 5) }], adjclose: [{ adjclose: close.map((value) => Math.round(value * 98) / 100) }] } }] } };
    };
    const withYahoo = (count: number): void => {
      installMockFetch({ emptyHistory: ['AAA'] });
      const good = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        /query1\.finance\.yahoo\.com/.test(String(input)) ? new Response(JSON.stringify(yahoo(count)), { status: 200 }) : good(input, init)) as unknown as typeof fetch;
    };
    await withTempFeed(async (root, dir) => {
      withYahoo(DAYS);
      await runUpdater(controlsFor({ SKIP_YAHOO: 'false', TICKERS: 'AAA' }));
      const first = contentsOf(dir);
      expect((await readJson(root, 'funds/AAA/meta.json')).history.totalRows).toBe(DAYS);
      withYahoo(10);
      await runUpdater(controlsFor({ SKIP_YAHOO: 'false', TICKERS: 'AAA', HISTORY_RANGE: '1y' }));
      expect(contentsOf(dir)).toEqual(first);
    });
  });

  test('a relaxed guard still keeps numeric published weights from an all-dash sheet (Q24)', async () => {
    installMockFetch();
    await withTempFeed(async (_root, dir) => {
      await runUpdater(controlsFor());
      const first = contentsOf(dir);
      rewriteWeights(MOCK_FUNDS[1].cusip, (row) => ({ ...row, netAssetValuePercent: '-', marketValuePercent: '-' }));
      HOLDINGS_GUARD_RELAX.BBB = ['numeric', 'sum'];
      try {
        await expect(runUpdater(controlsFor({ TICKERS: 'BBB' }))).rejects.toThrow(/every examined fund failed/);
      } finally {
        delete HOLDINGS_GUARD_RELAX.BBB;
      }
      expect(contentsOf(dir)).toEqual(first);
      expect(holdingsWeightCount(['Name', 'Weight'], [['A', '-'], ['B', '2']])).toBe(1);
    });
  });

  test('TICKERS outside the live catalog stops the run before any fund request; a stale catalog-only row is dropped (Q27)', async () => {
    installMockFetch();
    await withTempFeed(async (root, dir) => {
      await runUpdater(controlsFor());
      const index = await readIndex(root);
      writeFileSync(new URL('index.json', root), JSON.stringify({ ...index, funds: [...index.funds, { ...index.funds[0], ticker: 'NOPE', name: 'NOPE', dataFile: null }] }));
      const before = contentsOf(dir);
      const mock = installMockFetch();
      await expect(runUpdater(controlsFor({ TICKERS: 'NOPE' }))).rejects.toThrow('TICKERS: NOPE not in the JPMorgan catalog or published feed; nothing was fetched or written');
      expect(mock.requests.filter((url) => !/fund-explorer/.test(url))).toEqual([]);
      expect(contentsOf(dir)).toEqual(before);
      await runUpdater(controlsFor());
      expect((await readIndex(root)).funds.map((row) => row.ticker)).toEqual(TICKERS);
    });
  });

  test('NEW FUNDS announces a fund on its first successful publish, a failed new fund as not published yet (Q28)', async () => {
    const realSummary = process.env.GITHUB_STEP_SUMMARY;
    const summaryDir = mkdtempSync(join(tmpdir(), 'jpm-summary-'));
    const lines: string[] = [];
    try {
      await withTempFeed(async () => {
        installMockFetch({ funds: MOCK_FUNDS.slice(0, 1) });
        await runUpdater(controlsFor());
        process.env.GITHUB_STEP_SUMMARY = join(summaryDir, 'summary.md');
        console.log = (line: unknown) => { if (/^NEW FUNDS/.test(String(line))) lines.push(String(line)); };
        // BBB is published on its first read, CCC's holdings fail the guard (renamed weight fields)
        installMockFetch();
        rewriteWeights(MOCK_FUNDS[2].cusip, ({ netAssetValuePercent, marketValuePercent, ...rest }) => ({ ...rest, weightPct: netAssetValuePercent }));
        await runUpdater(controlsFor());
        expect(lines).toEqual(['NEW FUNDS: BBB', 'NEW FUNDS (not published yet): CCC']);
        expect(readFileSync(join(summaryDir, 'summary.md'), 'utf8')).toContain('### NEW FUNDS\n\nNEW FUNDS: BBB\nNEW FUNDS (not published yet): CCC\n');
        lines.length = 0;
        await runUpdater(controlsFor());
        expect(lines).toEqual([]);
        installMockFetch();
        await runUpdater(controlsFor());
        expect(lines).toEqual(['NEW FUNDS: CCC']);
      });
    } finally {
      if (realSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = realSummary;
      rmSync(summaryDir, { recursive: true, force: true });
    }
  });
});

describe('network', () => {
  test('every fetch has a timeout and a hanging request is retried a bounded number of times, then fails', async () => {
    configureFetchForTests({ timeoutMs: 30, sleepMs: 0, lanes: 1 });
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls += 1;
      const signal = init?.signal;
      if (!signal) { await new Promise((resolve) => setTimeout(resolve, 150)); return new Response('late', { status: 200 }); }
      return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as unknown as typeof fetch;
    await expect(fetchWithRetry('https://example.test/x', 't', {}, 1)).rejects.toThrow(/network error/);
    expect(calls).toBe(2);
  });

  test('pacing reserves lane slots synchronously: 6 simultaneous requests on 2 lanes start in waves of 2', async () => {
    configureFetchForTests({ sleepMs: 200, lanes: 2 });
    const t0 = Date.now();
    const starts: number[] = [];
    await Promise.all([0, 1, 2, 3, 4, 5].map(async () => { await paceRequests(); starts.push(Date.now() - t0); }));
    starts.sort((a, b) => a - b);
    // lower bounds only: a slow machine delays a wave, it never makes one start early
    expect(starts[2]).toBeGreaterThanOrEqual(150);
    expect(starts[3]).toBeGreaterThanOrEqual(150);
    expect(starts[4]).toBeGreaterThanOrEqual(350);
    expect(starts[5]).toBeGreaterThanOrEqual(350);
    expect(starts[1]).toBeLessThan(starts[2]);
  });

  test('CONCURRENCY really runs funds in parallel: peak in-flight 1 at c=1, N at c=N', async () => {
    for (const [concurrency, expected] of [[1, 1], [3, 3]] as const) {
      const mock = installMockFetch({ delayMs: 15 });
      await withTempFeed(async () => {
        await runUpdater(controlsFor({ CONCURRENCY: String(concurrency) }));
      });
      expect(mock.peak()).toBe(expected);
    }
  });

  test('HISTORY_RANGE really shrinks the Yahoo request: explicit period1/period2, never range=', () => {
    const now = Date.UTC(2026, 8, 25);
    const max = new URL(chartUrl('JEPI', { historyRange: 'max' }, now));
    const five = new URL(chartUrl('JEPI', { historyRange: '5y' }, now));
    expect(max.searchParams.get('period1')).toBe('0');
    expect(Number(five.searchParams.get('period1'))).toBe(Math.floor(now / 1000 - 5 * 365.25 * 86_400));
    expect(five.searchParams.get('period2')).toBe(String(Math.floor(now / 1000)));
    expect(five.searchParams.has('range')).toBe(false);
  });
});

describe('runOrder', () => {
  const universe = ['AAA', 'BBB', 'CCC', 'DDD'].map((ticker) => ({ ticker }));
  test('TICKERS narrows the run before the worker pool', () => {
    expect(runOrder(universe, ['DDD', 'BBB'], null).map((fund) => fund.ticker)).toEqual(['BBB', 'DDD']);
  });
  test('an empty TICKERS walks the whole catalog and the cursor rotates it', () => {
    expect(runOrder(universe, [], null).map((fund) => fund.ticker)).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(runOrder(universe, [], 'BBB').map((fund) => fund.ticker)).toEqual(['CCC', 'DDD', 'AAA', 'BBB']);
  });
});
