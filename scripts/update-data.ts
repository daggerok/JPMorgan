#!/usr/bin/env bun
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
  };
  const range = (v: any): string => v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  console.log(`[ config ] ${brand} updater:\n${outputConfigEntries(config).map(([key, value]) => `            ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  const detail = [
    `port=${outputClean(data.portId ?? data.portfolioId)}`,
    `history=${outputClean(outputCount(data.history ?? data.historyCount))}`,
    `(official=${outputClean(data.officialHistoryCount)} yahoo=${outputClean(data.yahooHistoryCount)})`,
    `holdings=${outputClean(outputCount(data.holdings ?? data.holdingsCount))}`,
    `divs=${outputClean(outputCount(data.worksheets?.Distributions ?? data.distributions))}`,
    `netAssets=${outputMoney(data.netAssets ?? data.aum)}`,
    `total=${outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)}`,
    `div=${outputClean(outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield))}`,
    `sec=${outputClean(outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield))}`,
    `wp=${outputClean(data.workplaceRaw)}`,
  ].join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)} ${detail}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
}


// J.P. Morgan Asset Management (US ETFs) static data updater.
//
// Fetches the public JPMorgan US ETF catalog (the fund explorer JSON behind
// am.jpmorgan.com), the per-fund product-data JSON (fund facts, expenses,
// yields, official returns, latest distribution and the complete daily
// holdings list) and the per-fund historicalData JSON (daily NAV / market
// price / premium-discount since inception, the dividend schedule and the
// quarter-end returns), then writes a deterministic, paginated static JSON
// API under ./api/jpmorgan — the same design as the daggerok/Invesco,
// daggerok/SPDR, daggerok/Fidelity and daggerok/WisdomTree updaters (zero
// dependencies, Bun only: node:fs/promises + fetch).
//
// Data sources
//   - catalog + fund metrics  : FundsMarketingHandler/fund-explorer JSON
//     (every listed US JPMorgan ETF: ticker, name, CUSIP, asset class, fund
//     inception, NAV, market price, premium/discount, net assets, 30-day SEC
//     yield, official month-end and quarter-end NAV / market-price returns)
//   - per-fund facts + holdings: FundsMarketingHandler/product-data JSON
//     (gross/net expense ratio, exchange, 12-month rolling dividend yield,
//     daily 30-day SEC yield, dividend frequency, latest distribution,
//     cumulative returns and the full "dailyHoldingsAll" list with CUSIP /
//     SEDOL identifiers — the same rows as the "Download holdings" workbook)
//   - history + distributions : FundsMarketingHandler/historicalData JSON
//     (NAV + market price for every business day since inception, the
//     published dividend schedule, quarter-end returns)
//   - catalog fallback        : the public early-NAV report CSV
//     (jpm-early-nav-etf.csv) and the previously published index
//   - holdings fallback       : SEC EDGAR Form N-PORT-P filings of the
//     J.P. Morgan Exchange-Traded Fund Trust (used only when product-data has
//     no positions for a fund)
//   - history fallback        : Yahoo Finance public chart API (used only when
//     the official history is unavailable; Yahoo throttles data-center IPs)
//
// Usage: bun ./scripts/update-data.ts   (or ./scripts/update-data.ts --help)

// Bun provides Node-compatible fs/promises and process globals for this script.
/// <reference types="bun" />
import { mkdir, readFile, writeFile, readdir, rm, appendFile } from 'node:fs/promises';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

// ---------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, any>;

const JPMORGAN_SITE = 'https://am.jpmorgan.com';
const PRODUCTS_BASE = `${JPMORGAN_SITE}/us/en/asset-management/adv/products`;
const FUNDS_MARKETING_HANDLER = `${JPMORGAN_SITE}/FundsMarketingHandler`;
// The JSON endpoint base; API_BASE re-points it at a mirror (tests, outages).
let apiBase = FUNDS_MARKETING_HANDLER;
const JPMORGAN_CATALOG_PAGE = `${PRODUCTS_BASE}/fund-explorer/etf`;
const EARLY_NAV_CSV_URL = `${JPMORGAN_SITE}/content/dam/jpm-am-aem/americas/us/en/supplemental/early-nav-report/jpm-early-nav-etf.csv`;
const JPMORGAN_COUNTRY = 'us';
const JPMORGAN_LANGUAGE = 'en';
const JPMORGAN_LOCALE = 'en-US';

// "JPMorgan Equity Premium Income ETF" -> "jpmorgan-equity-premium-income-etf"
// (the fund page slug: lower case, punctuation folded into single dashes).
export function fundNameSlug(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// am.jpmorgan.com keys its fund pages by CUSIP: "<slug>-etf-shares-<cusip>"
// (the slug is cosmetic — the server resolves the page from the CUSIP suffix).
export function jpmorganFundPageUrl(name: string, cusip: string): string {
  const slug = fundNameSlug(name) || 'jpmorgan-etf';
  return `${PRODUCTS_BASE}/${slug}-etf-shares-${String(cusip ?? '').toLowerCase()}`;
}

export function jpmorganFundExplorerUrl(role = 'adv', fundType = 'etf'): string {
  return `${apiBase}/fund-explorer?country=${JPMORGAN_COUNTRY}&role=${encodeURIComponent(role)}&userLoggedIn=false&language=${JPMORGAN_LANGUAGE}&fundType=${encodeURIComponent(fundType)}`;
}

export function jpmorganProductDataUrl(cusip: string, role = 'adv'): string {
  return `${apiBase}/product-data?cusip=${encodeURIComponent(cusip)}&country=${JPMORGAN_COUNTRY}&role=${encodeURIComponent(role)}&language=${JPMORGAN_LANGUAGE}&userLoggedIn=false`;
}

export function jpmorganHistoricalDataUrl(cusip: string, role = 'adv'): string {
  return `${apiBase}/historicalData?cusip=${encodeURIComponent(cusip)}&country=${JPMORGAN_COUNTRY}&role=${encodeURIComponent(role)}&language=${JPMORGAN_LANGUAGE}&userLoggedIn=false`;
}

// The human-facing "Download holdings" workbook (same rows as product-data's
// dailyHoldingsAll, minus the identifiers) — recorded as provenance.
export function jpmorganHoldingsDownloadUrl(cusip: string, role = 'adv'): string {
  return `${FUNDS_MARKETING_HANDLER}/excel?type=dailyETFHoldings&cusip=${encodeURIComponent(cusip)}&country=${JPMORGAN_COUNTRY}&role=${encodeURIComponent(role)}&locale=${JPMORGAN_LOCALE}`;
}

// The "ETF NAV and Market Price" workbook behind the fund page's history chart.
export function jpmorganPricesDownloadUrl(cusip: string, role = 'adv', fromDate = '', toDate = ''): string {
  const range = fromDate && toDate ? `&fromDate=${fromDate}&toDate=${toDate}` : '';
  return `${FUNDS_MARKETING_HANDLER}/excel?type=historicalNav&cusip=${encodeURIComponent(cusip)}&country=${JPMORGAN_COUNTRY}&role=${encodeURIComponent(role)}&locale=${JPMORGAN_LOCALE}${range}`;
}

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const YAHOO_BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const SEC_DATA_HOST = 'https://data.sec.gov';
const SEC_EFTS_HOST = 'https://efts.sec.gov/LATEST';
const EDGAR_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const EDGAR_BROWSE_URL = 'https://www.sec.gov/cgi-bin/browse-edgar';
// Official SEC lookup tables (public, no key): ETF/mutual-fund ticker ->
// registrant CIK + series/class ids, and operating company name -> ticker.
const SEC_FUND_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_mf.json';
const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_UA_DEFAULT = 'DaggerOk JPMorgan Feed admin@daggerok.example.com';

const API_ROOT = new URL('../api/jpmorgan/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

const HOLDINGS_PAGE_SIZE_FALLBACK = 250;
const HISTORY_PAGE_SIZE_FALLBACK = 1000;
const CONCURRENCY_FALLBACK = 2;
const REQUEST_SLEEP_FALLBACK = 1;
const MAX_RETRIES_FALLBACK = 2;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTicker(raw: unknown): string {
  return String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function cleanText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\u00ae/g, '') // ®
    .replace(/\u2122/g, '') // ™
    .replace(/&#174;|&reg;/gi, '')
    .replace(/&#8482;|&trade;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// "2.97057744E8" -> "297057744"; keeps non-numeric text untouched (same as SPDR).
export function normalizeNumberText(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '-') return text;
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.replace(/,/g, ''))) return text;
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return text;
  return number.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 });
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text === '—' || text === '-' || text === '--' || /^n\/?a$/i.test(text)) return null;
  // Percent first, then plain numbers: "0.40%" -> 0.4, "$1,234.56" -> 1234.56.
  const parsed = Number(text.replace(/[$,\s]/g, '').replace(/%$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// am.jpmorgan.com publishes yields and returns as fractions (0.0536 = 5.36%);
// expense ratios and premium/discount figures arrive in percent already.
export function fractionToPercent(value: unknown): number | null {
  const number = numberOrNull(value);
  return number === null ? null : round(number * 100, 4);
}

// "2026-06-30" -> "Jun 30 2026" (the display style shared with the sibling apps).
export function formatEdgarDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return String(iso || '');
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1] ?? month} ${day} ${year}`;
}

export function epochToIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function formatEpochDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')} ${date.getUTCFullYear()}`;
}

export function formatUsDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

// "08/21/2026" / "2026-08-21T00:00:00Z" -> "2026-08-21"; anything else passes
// through untouched so an unexpected source format never silently corrupts a
// date column.
export function toIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return text;
}

// "2026-08-21" -> "08/21/2026" (how am.jpmorgan.com renders dates in its
// workbooks and CSV reports).
export function formatJpmorganDate(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIsoDate(raw));
  if (!match) return String(raw ?? '');
  return `${match[2]}/${match[3]}/${match[1]}`;
}

// ISO date -> epoch seconds (UTC midnight), NaN-safe.
export function isoToEpoch(iso: string): number | null {
  const value = Date.parse(`${toIsoDate(iso)}T00:00:00Z`);
  return Number.isFinite(value) ? Math.floor(value / 1000) : null;
}

export function formatAumDisplay(value: number): string {
  return `$${(value / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
}

// ---------------------------------------------------------------------------
// Updater configuration (environment variables, iShares/SPDR/Fidelity-style)
// ---------------------------------------------------------------------------

type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
const RETURN_PERIODS: readonly ReturnPeriod[] = ['YTD', '1Y', '3Y', '5Y', '10Y'];
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

type UpdaterConfig = {
  concurrency: number;
  requestSleep: number;
  maxFetches: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: string[];
  historyRange: string;
  role: string;
  apiBase: string;
  fundExplorerUrl: string;
  earlyNavUrl: string;
  secUa: string;
  skipYahoo: boolean;
  skipJpmorgan: boolean;
  edgarFallback: boolean;
  aumRange?: Range & { source?: string };
  terRange?: Range;
  dividendYieldRange?: Range;
  secYieldRange?: Range;
  performanceRanges: RangeMap;
  totalReturnRanges: RangeMap;
};

const AUM_PRESET_BOUNDS = {
  nano: { min: 0, max: 10_000_000 },
  micro: { min: 10_000_000, max: 300_000_000 },
  small: { min: 300_000_000, max: 2_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: undefined },
} as const;
type AumPreset = keyof typeof AUM_PRESET_BOUNDS;

const AMOUNT_SUFFIXES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

function envValue(env: Record<string, string | undefined>, name: string, aliases: string[] = []): string {
  for (const key of [`JPMORGAN_${name}`, name, ...aliases]) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

function parsePositiveInt(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseNonNegativeFloat(raw: string, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseBoolean(raw: string, fallback = false): boolean {
  const text = String(raw ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

// Strict "min:max" ranges (same parser and errors as the sibling repos).
export function parseRange(raw: string, label: string): Range | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  if (!text.includes(':')) {
    throw new Error(`${label}: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  const [rawMin, rawMax] = text.split(':', 2);
  const parseBound = (bound: string): number | undefined => {
    const cleaned = bound.trim().replace(/%$/, '').replace(/[$,]/g, '');
    if (cleaned === '') return undefined;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) throw new Error(`${label}: "${bound.trim()}" is not a number`);
    return value;
  };
  const min = parseBound(rawMin);
  const max = parseBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`${label}: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseAumBound(bound: string): number | undefined {
  const cleaned = bound.trim().replace(/[$,]/g, '');
  if (cleaned === '') return undefined;
  const suffixMatch = /^([\d.]+)([KMBT])$/i.exec(cleaned);
  if (suffixMatch) return Number(suffixMatch[1]) * (AMOUNT_SUFFIXES[suffixMatch[2].toUpperCase()] ?? 1);
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

export function parseAumRange(raw: string): (Range & { source?: string }) | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  const lower = text.toLowerCase();
  for (const preset of Object.keys(AUM_PRESET_BOUNDS) as AumPreset[]) {
    if (lower === preset) return { ...AUM_PRESET_BOUNDS[preset] } as Range & { source?: string };
  }
  if (!text.includes(':')) {
    throw new Error(`AUM: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  const [rawMin, rawMax] = text.split(':', 2);
  const min = parseAumBound(rawMin);
  const max = parseAumBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`AUM: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const ranges: RangeMap = {};
  for (const period of RETURN_PERIODS) {
    const parsed = parseRange(envValue(env, `${prefix}_${period}`), `${prefix}_${period}`);
    if (parsed) ranges[period] = parsed;
  }
  return ranges;
}

function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  const role = envValue(env, 'ROLE') || 'adv';
  apiBase = (envValue(env, 'API_BASE') || FUNDS_MARKETING_HANDLER).replace(/\/+$/, '');
  return {
    concurrency: parsePositiveInt(envValue(env, 'CONCURRENCY'), CONCURRENCY_FALLBACK),
    requestSleep: parseNonNegativeFloat(envValue(env, 'REQUEST_SLEEP'), REQUEST_SLEEP_FALLBACK),
    maxFetches: parsePositiveInt(envValue(env, 'MAX_FETCHES', ['JPMORGAN_LIMIT']), 0),
    holdingsPageSize: parsePositiveInt(envValue(env, 'HOLDINGS_PAGE_SIZE'), HOLDINGS_PAGE_SIZE_FALLBACK),
    historyPageSize: parsePositiveInt(envValue(env, 'HISTORY_PAGE_SIZE', ['HISTORICAL_PAGE_SIZE']), HISTORY_PAGE_SIZE_FALLBACK),
    storeRawDownloads: parseBoolean(envValue(env, 'STORE_RAW_DOWNLOADS', ['JPMORGAN_STORE_RAW_DOWNLOADS']), false),
    maxRetries: parsePositiveInt(envValue(env, 'MAX_RETRIES'), MAX_RETRIES_FALLBACK),
    tickers: envValue(env, 'TICKERS')
      .split(/[\s,;]+/)
      .map(sanitizeTicker)
      .filter(Boolean),
    historyRange: envValue(env, 'HISTORY_RANGE') || 'max',
    role,
    apiBase,
    fundExplorerUrl: envValue(env, 'FUND_EXPLORER_URL') || jpmorganFundExplorerUrl(role),
    earlyNavUrl: envValue(env, 'EARLY_NAV_URL') || EARLY_NAV_CSV_URL,
    secUa: envValue(env, 'SEC_UA') || SEC_UA_DEFAULT,
    skipYahoo: parseBoolean(envValue(env, 'SKIP_YAHOO'), false),
    skipJpmorgan: parseBoolean(envValue(env, 'SKIP_JPMORGAN'), false),
    edgarFallback: parseBoolean(envValue(env, 'EDGAR_FALLBACK'), true),
    aumRange: parseAumRange(envValue(env, 'AUM')),
    terRange: parseRange(envValue(env, 'TER'), 'TER'),
    dividendYieldRange: parseRange(envValue(env, 'DIVIDEND_YIELD'), 'DIVIDEND_YIELD'),
    secYieldRange: parseRange(envValue(env, 'SEC_YIELD'), 'SEC_YIELD'),
    performanceRanges: parseRanges(env, 'PERFORMANCE'),
    totalReturnRanges: parseRanges(env, 'TOTAL_RETURN'),
  };
}

function rangeLabel(range?: Range): string {
  if (!range) return 'any';
  const min = range.min === undefined ? '' : String(range.min);
  const max = range.max === undefined ? '' : String(range.max);
  return `${min}:${max}`;
}

function configLines(config: UpdaterConfig): string[] {
  return [
    `CONCURRENCY         ${config.concurrency}`,
    `REQUEST_SLEEP       ${config.requestSleep} s between outgoing request starts`,
    `MAX_FETCHES         ${config.maxFetches === 0 ? 'all eligible funds (full pass, cursor ignored)' : `${config.maxFetches} per run (resumes after the saved cursor)`}`,
    `HOLDINGS_PAGE_SIZE  ${config.holdingsPageSize}`,
    `HISTORY_PAGE_SIZE   ${config.historyPageSize}`,
    `STORE_RAW_DOWNLOADS ${config.storeRawDownloads ? 'on' : 'off'}`,
    `MAX_RETRIES         ${config.maxRetries}`,
    `TICKERS             ${config.tickers.length ? config.tickers.join(' ') : 'all JPMorgan ETFs in the catalog'}`,
    `HISTORY_RANGE       ${config.historyRange} (Yahoo chart range, fallback history only)`,
    `ROLE                ${config.role} (am.jpmorgan.com role parameter)`,
    `API_BASE            ${config.apiBase}`,
    `AUM                 ${rangeLabel(config.aumRange)}`,
    `TER                 ${rangeLabel(config.terRange)}`,
    `DIVIDEND_YIELD      ${rangeLabel(config.dividendYieldRange)}`,
    `SEC_YIELD           ${rangeLabel(config.secYieldRange)}`,
    `PERFORMANCE_*       ${RETURN_PERIODS.filter((p) => config.performanceRanges[p]).map((p) => `${p}=${rangeLabel(config.performanceRanges[p])}`).join(' ') || 'any'}`,
    `TOTAL_RETURN_*      ${RETURN_PERIODS.filter((p) => config.totalReturnRanges[p]).map((p) => `${p}=${rangeLabel(config.totalReturnRanges[p])}`).join(' ') || 'any'}`,
    `SEC_UA              ${config.secUa}`,
    `SKIP_YAHOO          ${config.skipYahoo}`,
    `SKIP_JPMORGAN       ${config.skipJpmorgan}`,
    `EDGAR_FALLBACK      ${config.edgarFallback}`,
  ];
}

const USAGE = `
JPMorgan ETF static data updater (Bun, no dependencies).

  bun ./scripts/update-data.ts            update ./api/jpmorgan from am.jpmorgan.com (+ SEC / Yahoo fallbacks)
  ./scripts/update-data.ts -h | --help    print this help

Environment variables (all optional; strict "min:max" ranges; AND logic):

  MAX_FETCHES          Batch size: continue after the ticker cursor saved in
                       api/jpmorgan/update-state.json. Empty or 0 (the default)
                       means a full pass: every JPMorgan ETF in the catalog is
                       refreshed in one run, starting from the first ticker,
                       and the cursor is reset when it finishes.
                       Legacy alias: JPMORGAN_LIMIT.
  REQUEST_SLEEP        Minimum seconds between outgoing request starts,
                       including retries (default 1). am.jpmorgan.com and the
                       SEC both throttle bursty clients; the SEC allows at most
                       10 requests per second, Yahoo throttles hard, keep >= 1.
  CONCURRENCY          Parallel fund workers (default 2). Starts are still
                       globally spaced by REQUEST_SLEEP.
  MAX_RETRIES          Retries after the initial request (default 2). Only
                       network errors and HTTP 403/408/425/429/5xx responses
                       are retried with bounded exponential backoff.
  TICKERS              Space-, comma- or semicolon-separated ticker allowlist,
                       for example "JEPI JEPQ JPST BBJP".
  AUM                  Net assets range in USD: "min:max". Bounds accept plain
                       amounts or K/M/B/T suffixes; a whole-value preset may be
                       one of nano, micro, small, mid, large.
  TER                  Gross expense ratio range in percent, e.g. "0.1:0.5".
  DIVIDEND_YIELD       Dividend-yield range in percent (the 12-month rolling
                       yield published by JPMorgan, indicated when derived here).
  SEC_YIELD            30-day SEC yield range in percent.
  PERFORMANCE_YTD      Annualized return ranges (also 1Y, 3Y, 5Y, 10Y).
  TOTAL_RETURN_YTD     Cumulative return ranges (also 1Y, 3Y, 5Y, 10Y).
  HOLDINGS_PAGE_SIZE   Rows per generated current-holdings JSON page (default 250).
  HISTORY_PAGE_SIZE    Rows per generated price-history JSON page (default 1000).
                       Legacy alias: HISTORICAL_PAGE_SIZE.
  STORE_RAW_DOWNLOADS  Store the source fund-explorer / product-data /
                       historicalData JSON payloads under api/jpmorgan/raw
                       (1/true/yes/on). Legacy alias: JPMORGAN_STORE_RAW_DOWNLOADS.
  HISTORY_RANGE        Yahoo chart range for the fallback history rows
                       (default "max"); the official JPMorgan history always
                       covers the whole life of the fund.
  ROLE                 am.jpmorgan.com role parameter: adv (default, the
                       financial-advisor site the public fund pages serve),
                       per or institutional.
  API_BASE             Override the FundsMarketingHandler JSON base URL
                       (default ${FUNDS_MARKETING_HANDLER}),
                       e.g. a local mirror for offline test runs.
  FUND_EXPLORER_URL    Override the catalog JSON URL (the ETF fund explorer
                       behind ${JPMORGAN_CATALOG_PAGE}).
  EARLY_NAV_URL        Override the early-NAV report CSV used as the catalog
                       fallback when the fund explorer is unreachable.
  EDGAR_FALLBACK       0/false to skip the SEC EDGAR Form N-PORT-P fallback for
                       funds whose product-data has no positions
                       (default on; needs the declared SEC_UA).
  SEC_UA               Override the declared SEC User-Agent (SEC policy
                       requires a declared contact for automated access).
  SKIP_YAHOO           1/true to never call the Yahoo chart API, even when the
                       official JPMorgan history is unavailable for a fund
                       (previously published history rows are kept instead).
  SKIP_JPMORGAN        1/true to keep the previously published catalog values,
                       holdings and official returns; only the fallbacks
                       (SEC N-PORT-P holdings, Yahoo history) run.

AUM, TER, yield and return filters are evaluated against the freshly
downloaded catalog values (or the previously published catalog) before the
heavier per-fund downloads. Funds that are filtered out (or that fail) keep
their previously published files, exactly like the sibling updaters.

Examples:

  MAX_FETCHES=10 ./scripts/update-data.ts
  TICKERS="JEPI JEPQ JPST" ./scripts/update-data.ts
  AUM="1B:" TER=":0.5" ./scripts/update-data.ts
  PERFORMANCE_1Y="15:" ./scripts/update-data.ts
  STORE_RAW_DOWNLOADS=1 ./scripts/update-data.ts
  SKIP_YAHOO=1 ./scripts/update-data.ts
`;

// ---------------------------------------------------------------------------
// Fetch layer with global pacing and bounded retries (SPDR/Fidelity-style)
// ---------------------------------------------------------------------------

let nextRequestAt = 0;
let requestSleepMs = REQUEST_SLEEP_FALLBACK * 1000;

async function paceRequests(): Promise<void> {
  const waitFor = nextRequestAt - Date.now();
  if (waitFor > 0) await sleep(waitFor);
  nextRequestAt = Date.now() + requestSleepMs;
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** `fetchWithRetry` already prefixes its messages with the fetch label, so a
    caller that prints its own tag must not repeat the label. */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\[[^\]]*\] ?/, '');
}

export async function fetchWithRetry(
  url: string,
  label: string,
  init: RequestInit = {},
  maxRetries = 2,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await paceRequests();
    try {
      const response = await fetch(url, { redirect: 'follow', ...init });
      if (response.ok) return response;
      const retryable = [403, 408, 425, 429].includes(response.status) || response.status >= 500;
      if (!retryable) throw new HttpError(`${label}: HTTP ${response.status} ${response.statusText}`, response.status, false);
      lastError = new HttpError(`${label}: HTTP ${response.status} (attempt ${attempt + 1} of ${maxRetries + 1})`, response.status, true);
    } catch (error) {
      if (error instanceof HttpError && !error.retryable) throw error;
      lastError = error instanceof HttpError ? error : new Error(`${label}: network error (${String(error)})`);
    }
    if (attempt < maxRetries) await sleep(Math.min(30_000, 1_000 * 2 ** attempt) + 250);
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}: failed`);
}

function yahooHeaders(): Record<string, string> {
  return { 'User-Agent': YAHOO_BROWSER_UA, Accept: 'application/json' };
}

function secHeaders(config: UpdaterConfig): Record<string, string> {
  return { 'User-Agent': config.secUa, Accept: 'application/json,*/*' };
}

// am.jpmorgan.com sits behind a marketing CDN that answers a plain browser UA
// and rejects the odd user agents bots usually ship with. The
// FundsMarketingHandler endpoints answer JSON (fund explorer, product-data,
// historicalData) or CSV (early-NAV report) to the same headers.
function jpmorganHeaders(): Record<string, string> {
  return { 'User-Agent': YAHOO_BROWSER_UA, Accept: 'application/json,text/csv,text/plain,*/*' };
}

async function fetchText(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<string> {
  const response = await fetchWithRetry(url, label, { headers }, config.maxRetries);
  return await response.text();
}

async function fetchJson(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<JsonRecord> {
  const text = await fetchText(url, label, headers, config);
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response is not valid JSON`);
  }
}

// ---------------------------------------------------------------------------
// CSV layer (RFC-4180 subset) — the JPMorgan early-NAV catalog report is a
// real CSV (served as application/xlxs), unlike SPDR's XLSX
// ---------------------------------------------------------------------------

export type CsvTable = string[][];

export function parseCsv(text: string): CsvTable {
  const rows: CsvTable = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

// Header lookups ignore case, spaces and punctuation: am.jpmorgan.com pads
// its CSV headers with spaces (", Fund Name, Ticker, CUSIP, NAV") and renames
// columns far more often than it changes their meaning.
function headerKey(name: unknown): string {
  return String(name ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * am.jpmorgan.com appends legal/footer lines (disclaimers after a blank line)
 * to its downloads and may prefix them with a title, so the header row is
 * located by content instead of by a fixed row index.
 */
export function findHeaderRowIndex(rows: CsvTable, requiredColumns: string[]): number {
  const required = requiredColumns.map(headerKey);
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] || []).map(headerKey);
    if (cells.length < 3) continue;
    if (required.every((name) => cells.includes(name))) return i;
  }
  return -1;
}

/** Rows keyed by header name (original spelling preserved, first wins). */
export function csvRecords(rows: CsvTable, headerIndex: number): JsonRecord[] {
  const headers = (rows[headerIndex] || []).map((cell) => cleanText(cell));
  const records: JsonRecord[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some((cell) => String(cell ?? '').trim() !== '')) continue;
    const record: JsonRecord = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (!header || Object.prototype.hasOwnProperty.call(record, header)) continue;
      record[header] = String(row[c] ?? '').trim();
    }
    records.push(record);
  }
  return records;
}

/** First non-empty value among the candidate column names. */
export function pickColumn(record: JsonRecord, candidates: string[]): string {
  const wanted = candidates.map(headerKey);
  const keys = Object.keys(record);
  for (const name of wanted) {
    for (const key of keys) {
      if (headerKey(key) !== name) continue;
      const value = record[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
  }
  return '';
}

function pickNumber(record: JsonRecord, candidates: string[]): number | null {
  return numberOrNull(pickColumn(record, candidates));
}

function pickDate(record: JsonRecord, candidates: string[]): string {
  const raw = pickColumn(record, candidates);
  return raw ? toIsoDate(raw) : '';
}

// ---------------------------------------------------------------------------
// Catalog layer: the am.jpmorgan.com ETF fund explorer JSON
// ---------------------------------------------------------------------------

export type CatalogReturns = {
  ytd: number | null;
  yr1: number | null;
  yr3: number | null;
  yr5: number | null;
  yr10: number | null;
  sinceInception: number | null;
};

// Cumulative multi-year figures as published (the exact inverse of the
// annualized ones is only an approximation once rounding gets involved).
export type CumulativeReturns = { yr1: number | null; yr3: number | null; yr5: number | null; yr10: number | null; sinceInception: number | null };

export type OfficialReturns = CatalogReturns & {
  asOfDate: string | null;
  mo1: number | null;
  mo3: number | null;
};

export type CatalogFund = {
  ticker: string;
  name: string;
  category: string;
  categoryPath: string;
  inception: string | null;
  exchange: string;
  cusip: string;
  isin: string;
  benchmark: string;
  ter: number | null;
  nav: number | null;
  close: number | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  dividendYield: number | null;
  secYield: number | null;
  distributionRate: number | null;
  asOfDate: string | null;
  returns: CatalogReturns;
  returnsAsOfDate: string | null;
  mo1: number | null;
  marketReturns: CatalogReturns;
  quarterEnd: CatalogReturns;
  quarterEndAsOfDate: string | null;
  fundPage: string;
  trustCik: string | null;
  source: 'jpmorgan' | 'early-nav' | 'previous index' | 'seed';
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_CUMULATIVE: CumulativeReturns = { yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };

// J.P. Morgan Exchange-Traded Fund Trust — the registrant of every listed
// JPMorgan ETF (the SEC ticker table confirms it per fund at run time).
const JPMORGAN_ETF_TRUST_CIK = '0001485894';

// am.jpmorgan.com groups its line-up by asset class ("U.S. Equity", "Fixed
// Income Taxable", ...). The catalog tabs use the asset class verbatim; the
// full path (asset class + benchmark) is kept in meta.json for provenance.
export function normalizeJpmorganCategory(raw: unknown): string {
  const text = cleanText(raw).replace(/\bU\.S\b\.?/g, 'U.S.').replace(/\s+/g, ' ');
  return text || 'ETF';
}

function fractionReturns(block: unknown): CatalogReturns {
  const source = (block && typeof block === 'object' ? block : {}) as JsonRecord;
  return {
    ytd: fractionToPercent(source.ytd),
    yr1: fractionToPercent(source.yr1 ?? source.oneYear),
    yr3: fractionToPercent(source.yr3 ?? source.threeYears),
    yr5: fractionToPercent(source.yr5 ?? source.fiveYears),
    yr10: fractionToPercent(source.yr10 ?? source.tenYears),
    sinceInception: fractionToPercent(source.inception ?? source.sinceInception),
  };
}

function isoOrNull(raw: unknown): string | null {
  const iso = toIsoDate(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/**
 * The fund explorer answers one JSON array with every listed share class of
 * the ETF range: ticker, CUSIP ("identifier"), names, asset class, fund
 * inception, NAV / market price / premium-discount as of the last close, net
 * assets, month-end 30-day SEC yield and the official month-end + quarter-end
 * NAV and market-price returns (fractions, annualized beyond one year).
 */
export function parseFundExplorer(payload: unknown): CatalogFund[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as JsonRecord)?.funds)
      ? (payload as JsonRecord).funds
      : Array.isArray((payload as JsonRecord)?.data)
        ? (payload as JsonRecord).data
        : null;
  if (!list) throw new Error('fund explorer: response is not a fund list');
  const funds = new Map<string, CatalogFund>();
  for (const raw of list as JsonRecord[]) {
    if (!raw || typeof raw !== 'object') continue;
    const ticker = sanitizeTicker(raw.ticker ?? raw.tickerSymbol);
    if (!ticker) continue;
    const fundTypeCode = String(raw.fundTypeCode ?? '').toUpperCase();
    if (fundTypeCode && !/ETF/.test(fundTypeCode)) continue;
    const cusip = cleanText(raw.identifier ?? raw.cusip).toUpperCase();
    const name = cleanText(raw.name ?? raw.displayName ?? raw.fundName);
    if (!name) continue;
    const category = normalizeJpmorganCategory(raw.assetClass ?? raw.assetClassName);
    const benchmark = cleanText(raw.benchmark ?? raw.benchmarkName ?? raw.primaryBenchmark);
    const secYield = fractionToPercent(raw.secYield);
    funds.set(ticker, {
      ticker,
      name,
      category,
      categoryPath: benchmark ? `${category} / ${benchmark}` : category,
      inception: isoOrNull(raw.fundInceptionDate ?? raw.inceptionDate),
      exchange: cleanText(raw.exchange ?? raw.listingExchange),
      cusip,
      isin: cleanText(raw.isin).toUpperCase(),
      benchmark,
      ter: numberOrNull(raw.ongoingCharge) ?? numberOrNull(raw.grossExpenseRatio) ?? null,
      nav: numberOrNull(raw.nav),
      close: numberOrNull(raw.marketPrice),
      premiumDiscount: numberOrNull(raw.premiumDiscountPercentage),
      netAssets: numberOrNull(raw.assetsUnderManagement),
      dividendYield: null,
      secYield,
      distributionRate: null,
      asOfDate: isoOrNull(raw.navDate ?? raw.navEffectiveDate),
      returns: fractionReturns(raw.atNavPerformanceReturn),
      returnsAsOfDate: isoOrNull(raw.performanceReturnEffectiveDate),
      mo1: fractionToPercent((raw.atNavPerformanceReturn ?? {}).mt1 ?? (raw.atNavPerformanceReturn ?? {}).oneMonth),
      marketReturns: fractionReturns(raw.marketPriceReturns),
      quarterEnd: fractionReturns(raw.atNavPerformanceReturnForQuarterEnd),
      quarterEndAsOfDate: isoOrNull(raw.performanceReturnEffectiveDateForQuarterEnd ?? raw.quarterEndPerformanceReturnEffectiveDate),
      fundPage: cusip ? jpmorganFundPageUrl(name, cusip) : `${JPMORGAN_CATALOG_PAGE}?search=${encodeURIComponent(ticker)}`,
      trustCik: JPMORGAN_ETF_TRUST_CIK,
      source: 'jpmorgan',
    });
  }
  return [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * Fallback catalog: the public early-NAV report CSV lists every JPMorgan ETF
 * with its name, ticker, CUSIP, NAV and net assets (no returns, yields or
 * categories — those come from product-data / the previous index).
 */
export function parseEarlyNavCsv(text: string): CatalogFund[] {
  const rows = parseCsv(text);
  const headerIndex = findHeaderRowIndex(rows, ['Ticker', 'CUSIP', 'NAV']);
  if (headerIndex < 0) throw new Error('early-NAV report: header row not found');
  const funds = new Map<string, CatalogFund>();
  for (const record of csvRecords(rows, headerIndex)) {
    const ticker = sanitizeTicker(pickColumn(record, ['Ticker']));
    const name = cleanText(pickColumn(record, ['Fund Name', 'Name']));
    if (!ticker || !name) continue;
    const cusip = cleanText(pickColumn(record, ['CUSIP'])).toUpperCase();
    funds.set(ticker, {
      ticker,
      name,
      category: 'ETF',
      categoryPath: 'ETF',
      inception: null,
      exchange: '',
      cusip,
      isin: '',
      benchmark: '',
      ter: null,
      nav: numberOrNull(pickColumn(record, ['NAV'])),
      close: null,
      premiumDiscount: null,
      netAssets: numberOrNull(pickColumn(record, ['Net Assets', 'Total Net Assets'])),
      dividendYield: null,
      secYield: null,
      distributionRate: null,
      asOfDate: isoOrNull(pickColumn(record, ['Date', 'As Of Date'])),
      returns: { ...EMPTY_RETURNS },
      returnsAsOfDate: null,
      mo1: null,
      marketReturns: { ...EMPTY_RETURNS },
      quarterEnd: { ...EMPTY_RETURNS },
      quarterEndAsOfDate: null,
      fundPage: cusip ? jpmorganFundPageUrl(name, cusip) : `${JPMORGAN_CATALOG_PAGE}?search=${encodeURIComponent(ticker)}`,
      trustCik: JPMORGAN_ETF_TRUST_CIK,
      source: 'early-nav',
    });
  }
  if (!funds.size) throw new Error('early-NAV report: no ETF rows');
  return [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ---------------------------------------------------------------------------
// Product-data layer: fund facts, expenses, yields, returns, latest dividend
// and the complete daily holdings list of one fund
// ---------------------------------------------------------------------------

export const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
export const BOND_SHEET_HEADERS = [...HOLDINGS_HEADERS, 'Coupon', 'Maturity'];

export type ParsedHoldings = {
  asOfDate: string | null;
  container?: string;
  headers: string[];
  rows: JsonRecord[];
};

// JPMorgan's dividend-frequency codes ("MDEC" = monthly, December fiscal
// year-end). The first letter is the cadence; the suffix is the fiscal year
// end month and does not matter here.
export const DIVIDEND_FREQUENCY_CODES: Record<string, { frequency: string; paymentsPerYear: number | null }> = {
  M: { frequency: 'Monthly', paymentsPerYear: 12 },
  Q: { frequency: 'Quarterly', paymentsPerYear: 4 },
  S: { frequency: 'Semi-annually', paymentsPerYear: 2 },
  H: { frequency: 'Semi-annually', paymentsPerYear: 2 },
  Y: { frequency: 'Annually', paymentsPerYear: 1 },
  A: { frequency: 'Annually', paymentsPerYear: 1 },
  W: { frequency: 'Weekly', paymentsPerYear: 52 },
  D: { frequency: 'Daily', paymentsPerYear: null },
};

export function decodeDividendFrequency(code: unknown): { frequency: string; paymentsPerYear: number | null } | null {
  const text = String(code ?? '').trim().toUpperCase();
  if (!text) return null;
  return DIVIDEND_FREQUENCY_CODES[text[0]] ?? null;
}

// Security types whose "securityTicker" is an exchange symbol. Bonds, outputMoney
// market paper, repos, currencies and derivatives carry issuer codes instead
// ("T", "COF", "SPX"), which would collide across funds in the Watchlist.
const EQUITY_LIKE_SECURITY_TYPE = /(COMMON|PREFERRED|STOCK|REIT|ADR|GDR|EQUITY|SHARE|UNIT|FUND|ETF|TRUST|MONEY MARKET|WARRANT|RIGHT|MLP|PARTNERSHIP)/i;
const NON_EQUITY_SECURITY_TYPE = /(FUTURE|OPTION|SWAP|FORWARD|NOTE|BOND|BILL|PAPER|REPURCHASE|REPO|CURRENC|SPOT|LINKED|DEBT|LOAN|MORTGAGE|ASSET BACKED|CERTIFICATE OF DEPOSIT|TIME DEPOSIT|CASH|TREASUR|MUNICIPAL|SOVEREIGN|AGENCY|\bCMO\b|\bABS\b|\bMBS\b|\bTBA\b|\bCDO\b|\bCLO\b|WHEN ISSUED)/i;

export function holdingTickerFor(securityType: unknown, rawTicker: unknown): string {
  const ticker = cleanHoldingTicker(rawTicker);
  if (!ticker) return '';
  const type = cleanText(securityType);
  if (!type) return ticker;
  if (NON_EQUITY_SECURITY_TYPE.test(type)) return '';
  return EQUITY_LIKE_SECURITY_TYPE.test(type) ? ticker : '';
}

export type ProductData = {
  ticker: string;
  name: string;
  cusip: string;
  isin: string;
  exchange: string;
  assetClass: string;
  benchmark: string;
  inception: string | null;
  listingDate: string | null;
  grossExpense: number | null;
  netExpense: number | null;
  nav: number | null;
  navDate: string | null;
  marketPrice: number | null;
  marketPriceDate: string | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  netAssetsDate: string | null;
  sharesOutstanding: number | null;
  numberOfHoldings: number | null;
  dividendYield: number | null;
  dividendYieldDate: string | null;
  dividendYieldKind: string;
  secYield: number | null;
  secYieldDate: string | null;
  secYieldKind: string;
  unsubsidizedSecYield: number | null;
  frequencyCode: string;
  latestDividend: { exDate: string; amount: number; payDate: string; recordDate: string } | null;
  monthEnd: OfficialReturns;
  monthEndMarket: OfficialReturns;
  cumulative: CumulativeReturns;
  cumulativeAsOfDate: string | null;
  holdings: ParsedHoldings | null;
};

function performanceRow(rows: unknown, factor: RegExp): JsonRecord | null {
  if (!Array.isArray(rows)) return null;
  for (const row of rows as JsonRecord[]) {
    if (row && factor.test(String(row.performanceFactor ?? ''))) return row;
  }
  return null;
}

function officialReturnsFrom(row: JsonRecord | null): OfficialReturns {
  return {
    ...fractionReturns(row),
    asOfDate: isoOrNull(row?.effectiveDate),
    mo1: fractionToPercent(row?.oneMonth ?? row?.mt1),
    mo3: fractionToPercent(row?.threeMonths ?? row?.mt3),
  };
}

/**
 * Maps one "dailyHoldingsAll" row to the shared sheet layout. The identifier
 * is the CUSIP for US securities and the SEDOL for foreign ones (both arrive
 * in "securityId"); the weight is the published "% of net assets".
 */
// Full-list holdings containers of product-data, most complete first. The
// ten-row "dailyHoldings" teaser is deliberately not a candidate: a partial
// list is worse than the SEC N-PORT-P fallback.
const HOLDINGS_CONTAINERS = ['dailyHoldingsAll', 'dailyHoldingsWeekly', 'portfolioHoldings', 'fundHoldings', 'emeaFundHoldings', 'holdings.monthlyHoldings'];

function holdingsContainer(fundData: JsonRecord): { name: string; block: JsonRecord | JsonRecord[] } | null {
  for (const name of HOLDINGS_CONTAINERS) {
    let block: unknown = fundData;
    for (const part of name.split('.')) block = block && typeof block === 'object' ? (block as JsonRecord)[part] : undefined;
    const rows = Array.isArray((block as JsonRecord)?.data) ? ((block as JsonRecord).data as unknown[]) : Array.isArray(block) ? (block as unknown[]) : [];
    if (rows.length) return { name, block: block as JsonRecord | JsonRecord[] };
  }
  return null;
}

/** Published order: weight desc, then market value desc, then name / identifier / ticker (code-unit order, locale independent). */
export function compareHoldingRows(a: JsonRecord, b: JsonRecord): number {
  const numeric = (value: unknown): number => numberOrNull(value) ?? Number.NEGATIVE_INFINITY;
  const text = (x: unknown, y: unknown): number => (String(x ?? '') < String(y ?? '') ? -1 : String(x ?? '') > String(y ?? '') ? 1 : 0);
  const byWeight = numeric(b.Weight) - numeric(a.Weight);
  if (byWeight) return byWeight;
  const byValue = numeric(b['Market Value']) - numeric(a['Market Value']);
  if (byValue) return byValue;
  return text(a.Name, b.Name) || text(a.Identifier, b.Identifier) || text(a.Ticker, b.Ticker);
}

export function parseProductHoldings(fundData: JsonRecord, ticker: string): ParsedHoldings | null {
  const container = fundData && typeof fundData === 'object' ? holdingsContainer(fundData) : null;
  if (!container) return null;
  const block = (Array.isArray(container.block) ? null : container.block) as JsonRecord | null;
  const data = (Array.isArray(container.block) ? container.block : (container.block.data as JsonRecord[])) as JsonRecord[];
  const holdings: JsonRecord[] = [];
  let hasBondColumns = false;
  for (const record of data) {
    if (!record || typeof record !== 'object') continue;
    const name = cleanText(record.securityDescription ?? record.securityName ?? record.description);
    if (!name) continue;
    const identifier = cleanText(record.securityId ?? record.securityCusip ?? record.securityIsin ?? record.securitySedol).toUpperCase();
    const securityType = cleanText(record.securityType);
    const weight = numberOrNull(record.netAssetValuePercent) ?? numberOrNull(record.marketValuePercent);
    const marketValue = numberOrNull(record.marketValue);
    const shares = numberOrNull(record.shares ?? record.sharesPar ?? record.quantity);
    const coupon = numberOrNull(record.couponRate);
    const maturity = isoOrNull(record.finalLegalMaturityDate ?? record.maturityDate);
    if (coupon !== null || maturity) hasBondColumns = true;
    const row: JsonRecord = {
      Name: name,
      Ticker: holdingTickerFor(securityType, record.securityTicker ?? record.ticker) || '-',
      Identifier: identifier || '-',
      Weight: weight === null ? '' : String(round(weight, 6)),
      'Market Value': marketValue === null ? '' : normalizeNumberText(String(round(marketValue, 2))),
      'Shares Held': shares === null ? '-' : normalizeNumberText(String(shares)),
      'Asset Category': securityType || cleanText(record.sector) || '-',
    };
    row['Coupon'] = coupon === null ? '' : String(round(coupon, 4));
    row['Maturity'] = maturity ? formatEdgarDate(maturity) : '';
    holdings.push(row);
  }
  if (!holdings.length) return null;
  // am.jpmorgan.com returns the list in descending weight order but breaks
  // ties (zero-weight currency contracts, equal-sized lots) differently from
  // one request to the next; a canonical tie-break keeps reruns byte-identical.
  holdings.sort(compareHoldingRows);
  const headers = hasBondColumns ? BOND_SHEET_HEADERS : HOLDINGS_HEADERS;
  return {
    asOfDate: isoOrNull(block?.effectiveDate ?? block?.asOfDate ?? fundData?.numberOfHoldingsEffectiveDate),
    container: container.name,
    headers,
    rows: holdings.map((row) => {
      const next: JsonRecord = {};
      for (const header of headers) next[header] = row[header] ?? '';
      return next;
    }),
  };
}

// Summed weight (percent) — used as a sanity check before a sheet is kept: a
// holdings file whose weights do not remotely add up to ~100 is almost
// certainly a different column layout than the one we can read.
export function weightsSum(rows: JsonRecord[]): number {
  return round(rows.reduce((sum, row) => sum + (numberOrNull(row.Weight) || 0), 0), 4);
}

export function parseProductData(payload: JsonRecord, ticker: string): ProductData {
  const fundData = (payload?.fundData ?? payload) as JsonRecord | null;
  if (!fundData || typeof fundData !== 'object' || !fundData.shareClass) {
    throw new Error(`product-data has no fundData (${cleanText(payload?.error) || 'unknown CUSIP or delisted fund'})`);
  }
  const sc = fundData.shareClass as JsonRecord;
  const expenses = (sc.expenses ?? {}) as JsonRecord;
  const fees = (sc.fees ?? {}) as JsonRecord;
  const nav = (sc.nav ?? {}) as JsonRecord;
  const marketPrice = (sc.marketPrice ?? {}) as JsonRecord;
  const monthEndYield = (sc.yieldMonthEnd ?? {}) as JsonRecord;
  const dailySecYield = (sc.etfSecYield ?? {}) as JsonRecord;
  const rollingYield = (sc.secYield ?? sc.dailyYield ?? {}) as JsonRecord;
  const dividend = (sc.fundShareclassDividend ?? null) as JsonRecord | null;
  const benchmark = cleanText(((fundData.benchmarks ?? [])[0] ?? {})?.benchmark?.name ?? fundData.primaryBenchmark);

  // Yields: the daily 30-day SEC yield (etfSecYield) is the freshest; month-end
  // and the outputMoney-market 7-day figure are the fallbacks. Dividend yield is the
  // "12-month rolling dividend yield" the fund page shows, month-end otherwise.
  let secYield = fractionToPercent(dailySecYield.thirtyDaySecYield);
  let secYieldDate = isoOrNull(dailySecYield.effectiveDate);
  let secYieldKind = '30-day SEC yield (daily, official JPMorgan product-data)';
  let unsubsidizedSecYield = fractionToPercent(dailySecYield.thirtyDayUnsubSecYield);
  if (secYield === null) {
    secYield = fractionToPercent(monthEndYield.thirtyDaySecYield);
    secYieldDate = isoOrNull(monthEndYield.effectiveDate);
    secYieldKind = '30-day SEC yield (month-end, official JPMorgan product-data)';
    unsubsidizedSecYield = fractionToPercent(monthEndYield.thirtyDayUnsubSecYield);
  }
  if (secYield === null) {
    secYield = fractionToPercent(monthEndYield.sevenDaySecYield ?? sc.sevenDaySecYield);
    secYieldDate = isoOrNull(monthEndYield.effectiveDate);
    secYieldKind = '7-day SEC yield (outputMoney market fund, official JPMorgan product-data)';
    unsubsidizedSecYield = fractionToPercent(monthEndYield.sevenDayUnsubSecYield);
  }
  let dividendYield = fractionToPercent(rollingYield.dividendYield);
  let dividendYieldDate = isoOrNull(rollingYield.effectiveDate ?? rollingYield.dividendYieldEffectiveDate);
  let dividendYieldKind = '12-month rolling dividend yield (daily, official JPMorgan product-data)';
  if (dividendYield === null) {
    dividendYield = fractionToPercent(monthEndYield.dividendYield ?? monthEndYield.twlvMthSimpleYield);
    dividendYieldDate = isoOrNull(monthEndYield.effectiveDate);
    dividendYieldKind = '12-month rolling dividend yield (month-end, official JPMorgan product-data)';
  }
  if (dividendYield === null) {
    dividendYieldDate = null;
    dividendYieldKind = '';
  }

  const latestAmount = numberOrNull(dividend?.dividendAmount);
  const latestExDate = isoOrNull(dividend?.exDate);
  return {
    ticker: sanitizeTicker(sc.ticker) || ticker,
    name: cleanText(fundData.name ?? sc.name ?? fundData.displayName),
    cusip: cleanText(sc.cusip).toUpperCase(),
    isin: cleanText(sc.isin).toUpperCase(),
    exchange: cleanText((sc.tradingInfo ?? {}).exchange ?? sc.exchange),
    assetClass: normalizeJpmorganCategory(fundData.assetClass),
    benchmark,
    inception: isoOrNull(fundData.fundInceptionDate ?? sc.shareClassInceptionDate),
    listingDate: isoOrNull(sc.shareClassInceptionDate),
    grossExpense: numberOrNull(expenses.grossExpense) ?? numberOrNull(fees.grossExpenseRatio),
    netExpense: numberOrNull(expenses.netExpense) ?? numberOrNull(fees.expenseRatio),
    nav: numberOrNull(nav.price),
    navDate: isoOrNull(nav.date),
    marketPrice: numberOrNull(marketPrice.amount) ?? numberOrNull(nav.marketValueNavPrice),
    marketPriceDate: isoOrNull(marketPrice.date ?? nav.date),
    premiumDiscount: numberOrNull(marketPrice.premiumDiscountPercentage),
    netAssets: numberOrNull(sc.netGrossAssetClass ?? sc.netAssets ?? fundData.netAssets),
    netAssetsDate: isoOrNull(sc.grossAssetClassEffectiveDate ?? sc.netAssetsEffectiveDate),
    sharesOutstanding: numberOrNull(sc.sharesOutstanding),
    numberOfHoldings: numberOrNull(fundData.numberOfHoldings),
    dividendYield,
    dividendYieldDate,
    dividendYieldKind,
    secYield,
    secYieldDate,
    secYieldKind: secYield === null ? '' : secYieldKind,
    unsubsidizedSecYield,
    frequencyCode: cleanText(fundData.dividendsFrequency ?? sc.dividendsFrequency).toUpperCase(),
    latestDividend:
      latestAmount !== null && latestExDate
        ? {
            exDate: latestExDate,
            amount: latestAmount,
            payDate: isoOrNull(dividend?.payDate) ?? '',
            recordDate: isoOrNull(dividend?.recordDate) ?? '',
          }
        : null,
    monthEnd: officialReturnsFrom(performanceRow(sc.performanceReturns, /^at nav$/i)),
    monthEndMarket: officialReturnsFrom(performanceRow(sc.performanceReturns, /market price/i)),
    cumulative: (() => {
      const row = performanceRow(sc.cumulativePerformanceReturns, /^at nav$/i);
      if (!row) return { ...EMPTY_CUMULATIVE };
      return {
        yr1: fractionToPercent(row.oneYear),
        yr3: fractionToPercent(row.threeYears),
        yr5: fractionToPercent(row.fiveYears),
        yr10: fractionToPercent(row.tenYears),
        sinceInception: fractionToPercent(row.inception),
      };
    })(),
    cumulativeAsOfDate: isoOrNull(performanceRow(sc.cumulativePerformanceReturns, /^at nav$/i)?.effectiveDate),
    holdings: parseProductHoldings(fundData, ticker),
  };
}

// ---------------------------------------------------------------------------
// Historical-data layer: daily NAV / market price history, the dividend
// schedule and the quarter-end returns of one fund
// ---------------------------------------------------------------------------

export const HISTORY_HEADERS = ['Date', 'NAV', 'Market Price', 'Premium/Discount'];
export const YAHOO_HISTORY_HEADERS = ['Date', 'Close', 'Adj Close', 'Volume'];

export type HistoryPoint = { date: string; nav: number | null; marketPrice: number | null; premiumDiscount: number | null };

export type OfficialDividend = { epoch: number; amount: number; exDate: string; payDate: string; recordDate: string; reinvestNav: number | null; type: string };

export type ParsedHistoricalData = {
  points: HistoryPoint[]; // ascending by date
  dividends: OfficialDividend[]; // ascending by ex-date
  quarterEnd: OfficialReturns;
  quarterEndMarket: OfficialReturns;
  monthlyReturns: Array<{ date: string; value: number }>;
};

export function parseHistoricalData(payload: JsonRecord, ticker: string): ParsedHistoricalData {
  if (!payload || typeof payload !== 'object') throw new Error(`${ticker}: historicalData is not an object`);
  const byDate = new Map<string, HistoryPoint>();
  const lists = [payload.historicalETFClosingPriceList, payload.historicalETFNAVMarketPriceList, payload.historicalNavList];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list as JsonRecord[]) {
      const date = isoOrNull(raw?.date ?? raw?.navDate ?? raw?.effectiveDate);
      if (!date) continue;
      const nav = numberOrNull(raw.navPrice ?? raw.nav ?? raw.price);
      const marketPrice = numberOrNull(raw.marketValueNavPrice ?? raw.marketPrice ?? raw.closingPrice);
      const premiumDiscount = numberOrNull(raw.premiumDiscountPercentage ?? raw.premiumDiscount);
      const previous = byDate.get(date);
      byDate.set(date, {
        date,
        nav: previous?.nav ?? nav,
        marketPrice: previous?.marketPrice ?? marketPrice,
        premiumDiscount: previous?.premiumDiscount ?? premiumDiscount,
      });
    }
  }
  const points = [...byDate.values()].filter((point) => point.nav !== null || point.marketPrice !== null).sort((a, b) => a.date.localeCompare(b.date));
  const dividends: OfficialDividend[] = [];
  for (const raw of (Array.isArray(payload.dividendsDistributionHistoryList) ? payload.dividendsDistributionHistoryList : []) as JsonRecord[]) {
    const exDate = isoOrNull(raw?.exDate ?? raw?.exDividendDate);
    const amount = numberOrNull(raw?.dividendAmount ?? raw?.amount);
    const epoch = exDate ? isoToEpoch(exDate) : null;
    if (!exDate || epoch === null || amount === null || amount <= 0) continue;
    dividends.push({
      epoch,
      amount,
      exDate,
      payDate: isoOrNull(raw.payDate) ?? '',
      recordDate: isoOrNull(raw.recordDate) ?? '',
      reinvestNav: numberOrNull(raw.reinvestNavPr ?? raw.reinvestNav),
      type: cleanText(raw.distributionTypeCode ?? raw.distributionType),
    });
  }
  dividends.sort((a, b) => a.epoch - b.epoch || a.amount - b.amount);
  const monthlyReturns: Array<{ date: string; value: number }> = [];
  for (const raw of (Array.isArray(payload.performanceDataForChart) ? payload.performanceDataForChart : []) as JsonRecord[]) {
    const date = isoOrNull(raw?.date);
    const value = fractionToPercent(raw?.cumulativeNoLoadPercentage ?? raw?.value);
    if (date && value !== null) monthlyReturns.push({ date, value });
  }
  return {
    points,
    dividends,
    quarterEnd: officialReturnsFrom(performanceRow(payload.quarterlyPerformanceReturns, /^at nav$/i)),
    quarterEndMarket: officialReturnsFrom(performanceRow(payload.quarterlyPerformanceReturns, /market price/i)),
    monthlyReturns,
  };
}

/**
 * Turns the official NAV history into the adjusted daily series the derived
 * metrics consume: `close` is the NAV, `adjClose` is the NAV with every
 * published distribution reinvested at its reinvestment NAV (ex-date NAV when
 * JPMorgan omits it) — a NAV total-return index. Only the published dividend
 * window is adjusted (the fund page lists the last 12 payments), so windows
 * that start before `reinvestmentCoverageStart` are never derived from it.
 */
export function navTotalReturnDays(points: HistoryPoint[], dividends: OfficialDividend[]): ChartDay[] {
  const navPoints = points.filter((point) => point.nav !== null && point.nav > 0);
  if (!navPoints.length) return [];
  const sortedDividends = [...dividends].sort((a, b) => a.epoch - b.epoch);
  let factor = 1;
  let next = 0;
  const days: ChartDay[] = [];
  for (let i = 0; i < navPoints.length; i++) {
    const point = navPoints[i];
    while (next < sortedDividends.length && sortedDividends[next].exDate <= point.date) {
      const dividend = sortedDividends[next];
      const reinvestNav = dividend.reinvestNav && dividend.reinvestNav > 0 ? dividend.reinvestNav : point.nav;
      if (reinvestNav && reinvestNav > 0 && dividend.exDate >= navPoints[0].date) factor *= 1 + dividend.amount / reinvestNav;
      next += 1;
    }
    days.push({
      date: point.date,
      close: round(point.nav as number, 6),
      adjClose: round((point.nav as number) * factor, 6),
      volume: 0,
    });
  }
  return days;
}

/** The fund page's dividend schedule publishes at most this many payments. */
export const DIVIDEND_SCHEDULE_CAP = 12;

/**
 * First date from which the reinvestment index above is complete. A schedule
 * shorter than the cap is the fund's whole payout history, so the index is
 * complete from the first NAV. A capped schedule may hide older payments: the
 * index is then trusted only from one payment interval (the median gap between
 * the listed ex-dates) before the earliest listed ex-date — a window starting
 * earlier would miss reinvestments and understate a frequent payer's return.
 */
export function reinvestmentCoverageStart(points: HistoryPoint[], dividends: OfficialDividend[]): string | null {
  const navPoints = points.filter((point) => point.nav !== null && point.nav > 0);
  if (!navPoints.length) return null;
  if (dividends.length < DIVIDEND_SCHEDULE_CAP) return navPoints[0].date;
  const epochs = dividends.map((dividend) => dividend.epoch).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < epochs.length; i++) gaps.push(epochs[i] - epochs[i - 1]);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const covered = epochToIsoDate(epochs[0] - medianGap);
  return covered > navPoints[0].date ? covered : navPoints[0].date;
}

// ---------------------------------------------------------------------------
// Holding ticker resolution
//
// am.jpmorgan.com labels every exchange-listed holding with a ticker, but its
// bond, futures and cash rows either come back blank or carry a Bloomberg
// issuer code ("T" for Treasuries, "COF" for a Capital One bond) that is not
// an exchange ticker. Those rows keep "-" and are keyed by their CUSIP/SEDOL
// Identifier in the Watchlist — the exact convention daggerok/SPDR and
// daggerok/Fidelity use. N-PORT positions (EDGAR fallback) are resolved from
// the SEC company-ticker table; the Yahoo symbol search stays available with a
// STRICT name match so a fuzzy hit can never pin the wrong security.
// ---------------------------------------------------------------------------

const HOLDING_NAME_SUFFIXES = new Set([
  'STOCK', 'COMMON', 'PREFERRED', 'PFD', 'SHARES', 'ORDINARY', 'DEPOSITARY', 'ADS', 'ADR',
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC',
  'PUBLIC', 'SA', 'SAS', 'SARL', 'SRL', 'SL', 'KG', 'AG', 'BA', 'BV', 'NV', 'OY', 'SE',
  'AS', 'AB', 'AD', 'KK', 'KABUSHIKI', 'KAISHA', 'PTY', 'PT', 'SFC', 'ANONIMA', 'GMBH',
  'HOLDINGS', 'HLDGS', 'DEL', 'NEW', 'DELISTED', 'REPR', 'GROUP', 'TR', 'TRUST', 'NOTE',
  'NL', 'SPA', 'LP', 'LC', 'LLC', 'CAP', 'STK', 'SHS',
  'NOTES', 'BOND', 'BONDS', 'SER', 'SERIES',
]);
const HOLDING_NAME_PHRASES = new Set([
  'COMMON STOCK', 'PREFERRED STOCK', 'DEPOSITARY SHARES', 'AMERICAN DEPOSITARY SHARES',
  'ORDINARY SHARES', 'LIABILITY CO', 'S A', 'N V', 'B V', 'PRIVATE LTD', 'PUBLIC LTD',
]);
// Words that carry no identity at all: dropped wherever they sit at the edge
// of a filed name, so "The Coca-Cola Co" and "Coca CO" meet.
const HOLDING_NAME_FILLERS = new Set([
  'THE', 'OF', 'AND', 'FOR', 'DE', 'LA', 'LE', 'VAN', 'VON', 'DER', 'DEN', 'DI', 'Y',
  'E', 'DU', 'DA', 'LOS', 'LAS', 'EL', 'AL', 'DEL', 'NPV', 'PAR', 'VAL', 'USD', 'EUR',
  'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'HKD', 'CNY', 'SEK', 'NOK', 'NZD', 'MXN', 'INR',
]);

// Trailing share-class / security-type designations. The class letter is kept
// and canonicalized ("... Class C Capital Stock" -> "... Cl C") rather than
// dropped, so GOOG vs GOOGL — like BF/A vs BF/B — never collide.
const SHARE_CLASS_RE = /(?:\s+(?:CLASS|CL))\s+([A-Z])\b\s*$/;
// Words that only describe the security, never the issuer; safe to peel off the
// end of a filed name (and, once a share class is known, from behind it).
const SECURITY_TYPE_WORDS = new Set([
  'STOCK', 'STK', 'SHARES', 'SHS', 'SH', 'SHARE', 'CAPITAL', 'CAP', 'COMMON', 'ORDINARY',
  'GENERAL', 'VOTING', 'NON', 'NONVOTING', 'NVOTING', 'CONVERTIBLE', 'DEPOSITARY', 'PAID',
  'SUBORDINATED', 'NOTES', 'NOTE', 'SER', 'SERIES', 'LIABILITY', 'NEW', 'REP', 'REPR',
]);

export function normalizeHoldingName(raw: unknown): string {
  const text = String(raw ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  let tokens = text.split(' ').filter(Boolean);
  let classLetter = '';
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    const withClass = tokens.join(' ').match(SHARE_CLASS_RE);
    if (withClass) {
      classLetter = withClass[1];
      tokens = tokens.slice(0, tokens.length - 2); // drop "Class C" (or "Cl C")
      changed = true;
    }
    const last = tokens[tokens.length - 1];
    if (SECURITY_TYPE_WORDS.has(last) && tokens.length > 1) {
      tokens.pop(); // "... Capital Stock" -> "... Capital"
      changed = true;
      continue;
    }
    if (tokens.length >= 2 && HOLDING_NAME_PHRASES.has(`${tokens[tokens.length - 2]} ${last}`)) {
      tokens = tokens.slice(0, -2);
      changed = true;
      continue;
    }
    if (HOLDING_NAME_SUFFIXES.has(last)) {
      tokens.pop();
      changed = true;
      continue;
    }
    while (tokens.length > 2 && HOLDING_NAME_FILLERS.has(tokens[tokens.length - 1])) {
      tokens.pop(); // keep peeling: a filler may hide the next legal-form suffix
      changed = true;
    }
  }
  while (tokens.length > 1 && HOLDING_NAME_FILLERS.has(tokens[0])) tokens.shift();
  const body = tokens.join(' ').trim();
  return classLetter ? `${body} CL ${classLetter}`.replace(/\s+/g, ' ').trim() : body;
}

export function normalizeHoldingNameCore(raw: unknown): string {
  return normalizeHoldingName(raw).replace(/ /g, '');
}

// Holding tickers keep their class-share markers (SCE^L, BF/A, BRK-B): they
// are the real exchange symbols, unlike fund tickers which sanitizeTicker
// upper-cases and strips everything but letters/digits.
const HOLDING_TICKER_PLACEHOLDERS = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', 'NULL', '-', '--', '---', 'SEE FILE', 'VARIES']);

export function cleanHoldingTicker(raw: unknown): string {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (HOLDING_TICKER_PLACEHOLDERS.has(symbol)) return '';
  return /^[A-Z0-9][A-Z0-9.^/-]*$/.test(symbol) ? symbol : '';
}

export function yahooSearchUrl(name: string): string {
  return `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(name)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`;
}

// Strict matcher for Yahoo search payloads: the quote's long name must
// normalize to the same name (or token-core) as the filed holding name. Only
// EQUITY/ETF quotes are accepted, and single/two-word holdings may additionally
// match by token containment (e.g. "BULLISH" -> "Bullish BLCM Inc").
export function pickSearchTicker(name: string, payload: JsonRecord): string | null {
  const matches: unknown[] = Array.isArray(payload?.quoteMatches) ? payload.quoteMatches : [];
  const norm = normalizeHoldingName(name);
  if (!norm) return null;
  const core = norm.replace(/ /g, '');
  const tokens = norm.split(' ');
  for (const match of matches) {
    if (!match || typeof match !== 'object') continue;
    const record = match as JsonRecord;
    const quoteType = String(record.quoteType || '').toUpperCase();
    if (quoteType !== 'EQUITY' && quoteType !== 'ETF') continue;
    const symbol = cleanHoldingTicker(record.symbol);
    if (!symbol) continue;
    const longName = String(record.longname || record.shortname || '');
    const candidate = normalizeHoldingName(longName);
    if (!candidate) continue;
    if (candidate === norm || candidate.replace(/ /g, '') === core) return symbol;
    if (tokens.length <= 2 && tokens.every((token) => candidate.includes(token))) return symbol;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SEC EDGAR fallback layer: N-PORT-P positions for funds am.jpmorgan.com does
// not publish holdings for, resolved through the EDGAR full-text search API.
// ---------------------------------------------------------------------------

export type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

export function nportUrlFor(cik: string, accession: string): string {
  return `${EDGAR_ARCHIVES}/${Number(String(cik).replace(/^0+/, '') || 0)}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

export function parseNportAccessions(submissions: JsonRecord): NportAccession[] {
  const recent = submissions?.filings?.recent;
  const result: NportAccession[] = [];
  if (!recent || !Array.isArray(recent.form)) return result;
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== 'NPORT-P') continue;
    const accession: string = String(recent.accessionNumber?.[i] || '');
    if (!accession) continue;
    result.push({
      accession,
      filed: String(recent.filingDate?.[i] || ''),
      reportDate: String(recent.reportDate?.[i] || ''),
      url: nportUrlFor(String(submissions.cik || '0'), accession),
    });
  }
  return result;
}

// EDGAR publishes the authoritative "ticker -> registrant CIK + series id"
// table for every ETF and mutual fund class; it is the reliable way to reach a
// fund's own N-PORT-P filing (the full-text search is only a last resort).
export type SecSeriesRef = { cik: string; seriesId: string; classId: string };

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const map = new Map<string, SecSeriesRef>();
  const fields: string[] = Array.isArray(payload?.fields) ? payload.fields.map((field: unknown) => String(field)) : [];
  const rows: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
  const at = (row: unknown[], field: string): string => {
    const index = fields.indexOf(field);
    return index >= 0 ? String(row[index] ?? '') : '';
  };
  for (const raw of rows) {
    if (!Array.isArray(raw)) continue;
    const ticker = sanitizeTicker(at(raw, 'symbol'));
    if (!ticker || map.has(ticker)) continue;
    const cik = at(raw, 'cik').replace(/\D/g, '');
    if (!cik || Number(cik) === 0) continue;
    map.set(ticker, {
      cik: cik.padStart(10, '0'),
      seriesId: at(raw, 'seriesId').toUpperCase(),
      classId: at(raw, 'classId').toUpperCase(),
    });
  }
  return map;
}

// Operating-company name -> exchange ticker, so N-PORT positions (which carry
// CUSIP/ISIN but never a ticker) still land in the watchlist with a symbol.
export function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.values(payload as JsonRecord) : [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as JsonRecord;
    const ticker = cleanHoldingTicker(record.ticker);
    const title = String(record.title ?? '');
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) {
      if (key && !map.has(key)) map.set(key, ticker);
    }
  }
  return map;
}

export function edgarSeriesFilingsUrl(seriesId: string, count = 10): string {
  const params = new URLSearchParams({
    action: 'getcompany',
    CIK: String(seriesId || '').toUpperCase(),
    type: 'NPORT-P',
    dateb: '',
    owner: 'include',
    count: String(count),
    output: 'atom',
  });
  return `${EDGAR_BROWSE_URL}?${params.toString()}`;
}

// browse-edgar's Atom feed for one series: the newest N-PORT-P accessions of
// exactly that fund, newest first.
export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const entry of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = entry[1];
    const form = tagValue(body, 'filing-type') || tagValue(body, 'type');
    if (form && form.toUpperCase() !== 'NPORT-P') continue;
    const accession = tagValue(body, 'accession-number') || tagValue(body, 'accession-nunber');
    if (!accession) continue;
    const hrefMatch = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body);
    const cikMatch = hrefMatch ? /\/edgar\/data\/(\d+)\//.exec(cleanText(hrefMatch[1])) : null;
    result.push({
      accession,
      filed: tagValue(body, 'filing-date'),
      reportDate: tagValue(body, 'period') || '',
      url: nportUrlFor(cikMatch ? cikMatch[1] : accession.slice(0, 10), accession),
    });
  }
  return result;
}

function tagValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? cleanText(match[1]) : '';
}

export type NportHolding = JsonRecord;

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: NportHolding[];
  totalValue: number;
  netAssets: number | null;
};

// Minimal, forgiving N-PORT-P XML reader (machine-generated schemas only),
// in the same spirit as SPDR's hand-rolled ZIP/OOXML workbook reader.
export function parseNport(xml: string): ParsedNport {
  const genInfoMatch = /<genInfo>([\s\S]*?)<\/genInfo>/i.exec(xml);
  const genInfo = genInfoMatch ? genInfoMatch[1] : String(xml || '').slice(0, 4000);
  const fundInfoMatch = /<fundInfo>([\s\S]*?)<\/fundInfo>/i.exec(xml);
  const fundInfo = fundInfoMatch ? fundInfoMatch[1] : '';
  const holdings: NportHolding[] = [];
  const blockRe = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/g;
  let block: RegExpExecArray | null;
  let totalValue = 0;
  while ((block = blockRe.exec(xml)) !== null) {
    const body = block[1];
    const name = tagValue(body, 'name') || tagValue(body, 'title') || '-';
    const cusip = tagValue(body, 'cusip');
    let identifier = cusip && cusip.toUpperCase() !== 'N/A' ? cusip : '';
    if (!identifier) {
      // Real EDGAR schema: <identifiers><isin value="..."/><other value="..."/></identifiers>
      for (const tagMatch of body.matchAll(/<(isin|sedol|other|cusip)[^>]*value="([^"]+)"/gi)) {
        identifier = cleanText(tagMatch[2]);
        if (identifier) break;
      }
    }
    const weight = normalizeNumberText(tagValue(body, 'pctVal'));
    const valueMatch = /<valUSD[^>]*>([\s\S]*?)<\/valUSD>/i.exec(body);
    const value = Number(valueMatch ? valueMatch[1].replace(/[,\s]/g, '') : tagValue(body, 'curVal'));
    const balance = normalizeNumberText(tagValue(body, 'balance'));
    holdings.push({
      Name: name,
      Ticker: '-',
      Identifier: identifier || '-',
      Weight: weight === '' ? '0' : weight,
      'Market Value': Number.isFinite(value) ? String(value) : '0',
      'Shares Held': balance === '' ? '-' : balance,
      'Asset Category': tagValue(body, 'assetCat') || '-',
    });
    if (Number.isFinite(value)) totalValue += value;
  }
  return {
    regName: tagValue(genInfo, 'regName'),
    regCik: tagValue(genInfo, 'regCik'),
    seriesName: tagValue(genInfo, 'seriesName'),
    seriesId: tagValue(genInfo, 'seriesId'),
    repPdDate: toIsoDate(tagValue(genInfo, 'repPdDate')),
    holdings,
    totalValue,
    netAssets: numberOrNull(normalizeNumberText(tagValue(fundInfo, 'netAssets'))),
  };
}

// EDGAR full-text search maps a fund ticker to the registrant that filed its
// N-PORT-P, so the fallback works for every JPMorgan ETF without a hand-kept
// CIK table.
export function eftsSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: `"${query}"`,
    forms: 'NPORT-P',
    dateRange: 'custom',
    start: '0',
    end: String(25),
  });
  return `${SEC_EFTS_HOST}/search-index?${params.toString()}`;
}

export function pickEftsCik(payload: JsonRecord, fundName: string): string | null {
  // EDGAR returns { hits: { hits: [...] } }; older/simplified payloads (and the
  // unit-test fixtures) use a flat { hits: [...] } array.
  const hits: unknown[] = Array.isArray(payload?.hits)
    ? (payload.hits as unknown[])
    : Array.isArray((payload?.hits as JsonRecord)?.hits)
      ? ((payload.hits as JsonRecord).hits as unknown[])
      : [];
  const wanted = normalizeHoldingName(fundName);
  for (const raw of hits) {
    if (!raw || typeof raw !== 'object') continue;
    const hit = raw as JsonRecord;
    const source = (hit._source || {}) as JsonRecord;
    const display = source.display_names;
    // Real payload: display_names is ["NAME  (CIK 0001209466)", ...].
    const names: string[] = Array.isArray(display)
      ? display.map((entry: unknown) => String(entry))
      : Array.isArray((display as JsonRecord)?.names)
        ? ((display as JsonRecord).names as unknown[]).map((entry) => String(entry))
        : [];
    const fromDisplay = names.map((name) => /\(CIK\s*(\d{4,10})\)/i.exec(name)).find(Boolean);
    const ciks: string[] = Array.isArray(source.ciks) ? source.ciks.map((entry: unknown) => String(entry)) : [];
    const rawCik = String((display as JsonRecord)?.cik || fromDisplay?.[1] || ciks[0] || '');
    const cik = rawCik.replace(/\D/g, '').padStart(10, '0');
    if (!cik || cik === '0000000000') continue;
    if (wanted && names.length) {
      const matched = names.some((name) => {
        const normalized = normalizeHoldingName(name.replace(/\(CIK\s*\d+\)/i, ''));
        return normalized && (wanted.includes(normalized) || normalized.includes(wanted));
      });
      if (!matched) continue;
    }
    return cik;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Yahoo chart layer: daily history, distributions, quote meta
// ---------------------------------------------------------------------------

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };

export type ParsedChart = {
  exchangeName: string;
  longName: string;
  navPrice: number | null;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
};

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = (payload?.chart?.result || [])[0] as JsonRecord | undefined;
  if (!result) throw new Error('chart: empty result');
  const meta = (result.meta || {}) as JsonRecord;
  const timestamps: number[] = result.timestamp || [];
  const quote = ((result.indicators || {}).quote || [])[0] as JsonRecord | undefined;
  const adj = ((result.indicators || {}).adjclose || [])[0] as JsonRecord | undefined;
  const closes: unknown[] = (quote && quote.close) || [];
  const volumes: unknown[] = (quote && quote.volume) || [];
  const adjCloses: unknown[] = (adj && adj.adjclose) || closes;
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    const adjClose = typeof adjCloses[i] === 'number' && Number.isFinite(adjCloses[i] as number) ? (adjCloses[i] as number) : close;
    days.push({
      date: epochToIsoDate(timestamps[i]),
      close: round(close, 6),
      adjClose: round(adjClose, 6),
      volume: typeof volumes[i] === 'number' ? (volumes[i] as number) : 0,
    });
  }
  const events = ((result.events || {}) as JsonRecord).dividends as Record<string, JsonRecord> | undefined;
  const dividends = Object.values(events || {})
    .map((event) => ({ epoch: Number(event.date), amount: Number(event.amount) }))
    .filter((event) => Number.isFinite(event.epoch) && Number.isFinite(event.amount) && event.amount > 0)
    .sort((a, b) => a.epoch - b.epoch);
  return {
    exchangeName: String(meta.fullExchangeName || meta.exchangeName || ''),
    longName: String(meta.longName || meta.shortName || ''),
    navPrice: numberOrNull(meta.navPrice),
    regularMarketPrice: numberOrNull(meta.regularMarketPrice) ?? numberOrNull(meta.previousClose),
    regularMarketTime: numberOrNull(meta.regularMarketTime),
    firstTradeDate: numberOrNull(meta.firstTradeDate),
    days,
    dividends,
  };
}

function chartUrl(ticker: string, config: UpdaterConfig): string {
  // Explicit period1/period2: `range=max` silently downgrades to monthly bars.
  const period2 = Math.floor(Date.now() / 1000);
  let period1 = 0; // "max"
  const yearsMatch = /^(\d+)y$/i.exec(config.historyRange);
  if (yearsMatch) period1 = Math.floor(period2 - Number(yearsMatch[1]) * 365.25 * 86_400);
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%7Csplit`;
}

// ---------------------------------------------------------------------------
// Derived catalog metrics (unit-tested helpers, sibling parity)
// ---------------------------------------------------------------------------

// (1 + CAGR)^n - 1 — the exact inverse of annualizing (same helper as SPDR).
export function annualizedToTotal(annualizedPercent: number | null | undefined, years: number): number | null {
  if (typeof annualizedPercent !== 'number' || !Number.isFinite(annualizedPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + annualizedPercent / 100) ** years - 1) * 100, 2);
}

export function totalToAnnualized(totalPercent: number | null | undefined, years: number): number | null {
  if (typeof totalPercent !== 'number' || !Number.isFinite(totalPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + totalPercent / 100) ** (1 / years) - 1) * 100, 2);
}

// Indicated yield: latest distribution x payments per year / price — used only
// when the product list publishes no trailing-12-month yield for the fund.
export function indicatedYield(
  latestDistribution: number | null | undefined,
  paymentsPerYear: number | null | undefined,
  price: number | null | undefined,
): number | null {
  if (typeof latestDistribution !== 'number' || typeof paymentsPerYear !== 'number' || typeof price !== 'number') return null;
  if (!Number.isFinite(latestDistribution) || !Number.isFinite(paymentsPerYear) || !Number.isFinite(price) || price <= 0) return null;
  if (paymentsPerYear <= 0 || latestDistribution <= 0) return null;
  return round(((latestDistribution * paymentsPerYear) / price) * 100, 2);
}

export function inferDistributionFrequency(
  dividends: Array<{ epoch: number; amount: number }>,
): { frequency: string; paymentsPerYear: number | null } {
  if (!dividends.length) return { frequency: 'None', paymentsPerYear: null };
  const recent = dividends.slice(-9);
  if (recent.length < 2) return { frequency: 'Unknown', paymentsPerYear: null };
  const gapsDays: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const gap = (recent[i].epoch - recent[i - 1].epoch) / 86_400;
    if (gap > 14 && gap < 400) gapsDays.push(gap);
  }
  if (!gapsDays.length) return { frequency: 'Unknown', paymentsPerYear: null };
  gapsDays.sort((a, b) => a - b);
  const medianGap = gapsDays[Math.floor(gapsDays.length / 2)];
  if (medianGap >= 300) return { frequency: 'Annually', paymentsPerYear: 1 };
  if (medianGap >= 150) return { frequency: 'Semi-annually', paymentsPerYear: 2 };
  if (medianGap >= 75) return { frequency: 'Quarterly', paymentsPerYear: 4 };
  if (medianGap >= 25) return { frequency: 'Monthly', paymentsPerYear: 12 };
  return { frequency: 'Irregular', paymentsPerYear: null };
}

export type PriceReturns = {
  asOfDate: string;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
  mo1: number | null;
  qtd: number | null;
};

const EMPTY_PRICE_RETURNS: PriceReturns = {
  asOfDate: '', ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null,
};

function pctChange(start: number, end: number): number {
  return round(((end - start) / start) * 100, 2);
}

function annualized(start: number, end: number, years: number): number | null {
  if (start <= 0 || years <= 0) return null;
  return round(((end / start) ** (1 / years) - 1) * 100, 2);
}

// Total returns from an adjusted daily series anchored to the last trading day
// at or before `now`. The series is the official JPMorgan NAV with published
// distributions reinvested (or Yahoo adjusted closes in the fallback path).
// JPMorgan publishes official returns for every fund, so these only fill the
// gaps (young funds, quarter-to-date) and drive the History-derived blocks.
export function priceReturns(days: ChartDay[], now = new Date(), coveredFrom: string | null = null): PriceReturns {
  const empty: PriceReturns = { ...EMPTY_PRICE_RETURNS };
  if (!days.length) return empty;
  const last = days[days.length - 1];
  // A window is derivable only when its anchor day lies inside the span the
  // adjusted series covers (see reinvestmentCoverageStart).
  const anchored = (day: ChartDay | null): day is ChartDay => day !== null && day.date < last.date && (coveredFrom === null || day.date >= coveredFrom);
  const lastEpoch = Date.parse(`${last.date}T00:00:00Z`) / 1000;
  const atOrBefore = (iso: string): ChartDay | null => {
    const target = Date.parse(`${iso}T00:00:00Z`) / 1000;
    if (Number.isNaN(target)) return null;
    let found: ChartDay | null = null;
    for (const day of days) {
      if (Date.parse(`${day.date}T00:00:00Z`) / 1000 <= target) found = day;
      else break;
    }
    return found;
  };
  const yearsAgo = (years: number): ChartDay | null => {
    const date = new Date(now.getTime());
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return atOrBefore(date.toISOString().slice(0, 10));
  };
  const ytdStart = atOrBefore(`${now.getUTCFullYear()}-01-01`);
  const mo1Start = new Date(now.getTime() - 31 * 86_400_000).toISOString().slice(0, 10);
  const quarterStart = `${now.getUTCFullYear()}-${String(Math.floor(now.getUTCMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
  const year1 = yearsAgo(1);
  const year3 = yearsAgo(3);
  const year5 = yearsAgo(5);
  const year10 = yearsAgo(10);
  const first = days[0];
  const siYears = (lastEpoch - Date.parse(`${first.date}T00:00:00Z`) / 1000) / (365.25 * 86_400);
  const mo1StartDay = atOrBefore(mo1Start);
  const qtdStartDay = atOrBefore(quarterStart);
  return {
    asOfDate: last.date,
    ytd: anchored(ytdStart) && ytdStart.adjClose > 0 ? pctChange(ytdStart.adjClose, last.adjClose) : null,
    yr1: anchored(year1) ? pctChange(year1.adjClose, last.adjClose) : null,
    cagr3y: anchored(year3) ? annualized(year3.adjClose, last.adjClose, 3) : null,
    cagr5y: anchored(year5) ? annualized(year5.adjClose, last.adjClose, 5) : null,
    cagr10y: anchored(year10) ? annualized(year10.adjClose, last.adjClose, 10) : null,
    siAnn: siYears >= 0.75 && anchored(first) ? annualized(first.adjClose, last.adjClose, siYears) : null,
    mo1: anchored(mo1StartDay) ? pctChange(mo1StartDay.adjClose, last.adjClose) : null,
    qtd: anchored(qtdStartDay) ? pctChange(qtdStartDay.adjClose, last.adjClose) : null,
  };
}

export function lastCompletedQuarterEnd(now = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based
  if (month <= 2) return new Date(Date.UTC(year - 1, 11, 31)); // Jan-Mar -> Dec 31
  if (month <= 5) return new Date(Date.UTC(year, 2, 31)); // Apr-Jun -> Mar 31
  if (month <= 8) return new Date(Date.UTC(year, 5, 30)); // Jul-Sep -> Jun 30
  return new Date(Date.UTC(year, 8, 30)); // Oct-Dec -> Sep 30
}

/**
 * Merges the official JPMorgan returns with the ones derived from the adjusted
 * daily series. Official figures win wherever they exist (they are NAV total
 * returns — the same basis the sibling apps publish); derived figures fill
 * the gaps for young funds and for funds JPMorgan lists without returns.
 */
export function deriveCatalogMetrics(
  official: CatalogReturns,
  derived: PriceReturns,
  publishedDividendYield: number | null,
  publishedSecYield: number | null,
  latestDistribution: number | null,
  paymentsPerYear: number | null,
  price: number | null,
  officialCumulative: CumulativeReturns | null = null,
): JsonRecord {
  const coalesce = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const ytd = coalesce(official.ytd) ?? coalesce(derived.ytd);
  const tr1y = coalesce(official.yr1) ?? coalesce(derived.yr1);
  const cagr3y = coalesce(official.yr3) ?? coalesce(derived.cagr3y);
  const cagr5y = coalesce(official.yr5) ?? coalesce(derived.cagr5y);
  const cagr10y = coalesce(official.yr10) ?? coalesce(derived.cagr10y);
  const siAnn = coalesce(official.sinceInception) ?? coalesce(derived.siAnn);
  const dividendYield = coalesce(publishedDividendYield) ?? indicatedYield(latestDistribution, paymentsPerYear, price);
  const text = (value: number | null): string | null => (value === null ? null : `${value.toFixed(2)}%`);
  return {
    ytd,
    tr1y,
    tr3y: coalesce(officialCumulative?.yr3) ?? annualizedToTotal(cagr3y, 3),
    tr5y: coalesce(officialCumulative?.yr5) ?? annualizedToTotal(cagr5y, 5),
    tr10y: coalesce(officialCumulative?.yr10) ?? annualizedToTotal(cagr10y, 10),
    cagr3y,
    cagr5y,
    cagr10y,
    siAnn,
    dividendYield,
    dividendYieldText: text(dividendYield) ?? '—',
    secYield: coalesce(publishedSecYield),
    secYieldText: text(coalesce(publishedSecYield)) ?? '—',
    returnsBasis: Object.values(official).some((value) => value !== null)
      ? 'official JPMorgan NAV total returns (fund explorer / product-data JSON)'
      : 'derived from the daily NAV history with published distributions reinvested (or Yahoo adjusted closes), not official NAV returns',
  };
}

// ---------------------------------------------------------------------------
// Eligibility filters (AND logic, iShares semantics)
// ---------------------------------------------------------------------------

function inRange(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function annualizedValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  if (period === 'YTD') return numberOrNull(metrics.ytd);
  if (period === '1Y') return numberOrNull(metrics.tr1y);
  return numberOrNull(metrics[`cagr${period.toLowerCase()}`]);
}

function cumulativeValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  const key = period === 'YTD' ? 'ytd' : period === '1Y' ? 'tr1y' : `tr${period.toLowerCase()}`;
  return numberOrNull(metrics[key]);
}

function fundFilterReasons(
  candidate: { ticker: string; aumValue?: number | null; terValue?: number | null; metrics: JsonRecord },
  config: UpdaterConfig,
): string[] {
  const reasons: string[] = [];
  if (config.tickers.length && !config.tickers.includes(candidate.ticker)) reasons.push('TICKERS');
  if (config.aumRange && !inRange(candidate.aumValue ?? null, config.aumRange)) reasons.push('AUM');
  if (config.terRange && !inRange(candidate.terValue ?? null, config.terRange)) reasons.push('TER');
  if (config.dividendYieldRange && !inRange(numberOrNull(candidate.metrics.dividendYield), config.dividendYieldRange)) {
    reasons.push('DIVIDEND_YIELD');
  }
  for (const period of RETURN_PERIODS) {
    const performance = config.performanceRanges[period];
    if (performance && !inRange(annualizedValue(candidate.metrics, period), performance)) reasons.push(`PERFORMANCE_${period}`);
    const total = config.totalReturnRanges[period];
    if (total && !inRange(cumulativeValue(candidate.metrics, period), total)) reasons.push(`TOTAL_RETURN_${period}`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Deterministic writers (iShares/SPDR/Fidelity-style)
// ---------------------------------------------------------------------------

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const next = `${JSON.stringify(value, null, 1)}\n`;
  let previous: string | null = null;
  try {
    previous = await readFile(file, 'utf8');
  } catch {
    // First write.
  }
  if (previous === next) return false;
  await writeFile(file, next, 'utf8');
  return true;
}

async function writePages(
  dir: URL,
  ticker: string,
  kind: 'holdings' | 'history',
  headers: string[],
  rows: JsonRecord[],
  pageSize: number,
): Promise<{ pages: string[]; pageSize: number; totalRows: number }> {
  await mkdir(new URL(`${kind}/`, dir), { recursive: true });
  const pages: string[] = [];
  if (rows.length) {
    const pageCount = Math.ceil(rows.length / pageSize);
    for (let page = 1; page <= pageCount; page++) {
      const slice = rows.slice((page - 1) * pageSize, page * pageSize);
      const name = `${kind}/${pad3(page)}.json`;
      await writeIfChanged(new URL(name, dir), {
        ticker,
        page,
        pageSize,
        totalRows: rows.length,
        headers,
        rows: slice,
      });
      pages.push(name);
    }
  }
  await removeStalePages(dir, kind, new Set(pages));
  return { pages, pageSize, totalRows: rows.length };
}

async function removeStalePages(fundDir: URL, kind: 'holdings' | 'history', kept: Set<string>): Promise<void> {
  const kindDir = new URL(`${kind}/`, fundDir);
  let entries: string[] = [];
  try {
    entries = await readdir(kindDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith('.json') && !kept.has(`${kind}/${entry}`)) {
      await rm(new URL(entry, kindDir), { force: true });
    }
  }
}

type UpdateState = { cursor: string | null; savedAt: string };

async function readUpdateState(): Promise<UpdateState | null> {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as UpdateState;
  } catch {
    return null;
  }
}

async function writeUpdateState(lastProcessedTicker: string | null): Promise<void> {
  await writeIfChanged(STATE_FILE, {
    cursor: lastProcessedTicker,
    savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
}

async function readPreviousIndex(): Promise<Map<string, JsonRecord>> {
  const map = new Map<string, JsonRecord>();
  try {
    const payload = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    for (const fund of payload.funds || []) {
      if (fund && typeof fund.ticker === 'string') map.set(fund.ticker, fund);
    }
  } catch {
    // First run.
  }
  return map;
}

async function readPreviousSheet(ticker: string, kind: 'holdings' | 'history'): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let page = 1;
  for (;;) {
    let payload: JsonRecord;
    try {
      payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(page)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    } catch {
      return rows;
    }
    rows.push(...(payload.rows || []));
    const totalRows = numberOrNull(payload.totalRows);
    if (totalRows !== null && rows.length >= totalRows) return rows;
    if (!(payload.rows || []).length) return rows;
    page += 1;
  }
}

async function readPreviousSheetHeaders(ticker: string, kind: 'holdings' | 'history'): Promise<string[]> {
  try {
    const payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(1)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    return Array.isArray(payload.headers) ? (payload.headers as string[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fund assembly
// ---------------------------------------------------------------------------

// Official history rows (newest last, like the sibling Yahoo-based sheets):
// the NAV, the closing market price and the premium/discount JPMorgan
// publishes for every business day since inception.
function officialHistoryRows(points: HistoryPoint[]): JsonRecord[] {
  return points.map((point) => ({
    Date: formatEdgarDate(point.date),
    NAV: point.nav === null ? '' : String(point.nav),
    'Market Price': point.marketPrice === null ? '' : String(point.marketPrice),
    'Premium/Discount': point.premiumDiscount === null ? '' : String(point.premiumDiscount),
  }));
}

// Yahoo fallback rows, identical to the sibling feeds.
function historyRows(days: ChartDay[]): JsonRecord[] {
  return days.map((day) => ({
    Date: formatEdgarDate(day.date),
    Close: String(day.close),
    'Adj Close': String(day.adjClose),
    Volume: String(day.volume),
  }));
}

// Array rows (not objects): meta.distributions feeds renderDistributionsTable
// directly, same as the sibling worksheet shape.
function distributionRows(dividends: Array<{ epoch: number; amount: number }>): string[][] {
  return dividends.map((dividend) => [formatUsDate(dividend.epoch), String(round(dividend.amount, 6))]);
}

// JPMorgan annualizes returns beyond one year only; a since-inception figure
// of a fund younger than one year is cumulative and must not be published in
// the "SI Ann." column (the derived, >= 0.75-year annualization fills in).
export function annualizedSinceInception(value: number | null, inception: string | null, asOfDate: string | null): number | null {
  if (value === null) return null;
  const start = inception ? isoToEpoch(inception) : null;
  const end = asOfDate ? isoToEpoch(asOfDate) : null;
  if (start === null || end === null) return value;
  return (end - start) / 86_400 >= 365 ? value : null;
}

function mergeOfficial(primary: CatalogReturns | null, secondary: CatalogReturns | null): CatalogReturns {
  const pick = (key: keyof CatalogReturns): number | null => primary?.[key] ?? secondary?.[key] ?? null;
  return { ytd: pick('ytd'), yr1: pick('yr1'), yr3: pick('yr3'), yr5: pick('yr5'), yr10: pick('yr10'), sinceInception: pick('sinceInception') };
}

function returnsBlock(
  derived: PriceReturns,
  official: CatalogReturns,
  officialMo1: number | null,
  asOfDate: string | null,
  quarterEnd: CatalogReturns,
  quarterEndAsOfDate: string | null,
  previous: JsonRecord,
): JsonRecord | null {
  const hasOfficial = Object.values(official).some((value) => value !== null);
  const hasDerived = Boolean(derived.asOfDate);
  if (!hasOfficial && !hasDerived) return (previous.returns as JsonRecord) ?? null;
  const text = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : `${value.toFixed(2)}%`);
  const asOf = asOfDate || derived.asOfDate;
  const mo1 = officialMo1 ?? derived.mo1;
  const hasQuarterEnd = Object.values(quarterEnd).some((value) => value !== null);
  const quarterAnchor = quarterEndAsOfDate || lastCompletedQuarterEnd().toISOString().slice(0, 10);
  return {
    derivedFrom: hasOfficial
      ? `official JPMorgan NAV total returns (fund explorer / product-data JSON); ${officialMo1 === null ? 'mo1/qtd' : 'qtd'} derived from the daily NAV history with published distributions reinvested`
      : hasDerived && derived.asOfDate
        ? 'derived from the official daily NAV history with published distributions reinvested (NAV total return), not official published returns'
        : 'adjusted market-price closes (Yahoo chart API), not official NAV returns',
    monthEnd: {
      asOfDate: asOf ? formatEdgarDate(asOf) : '—',
      mo1,
      mo1Text: text(mo1),
      qtd: derived.qtd,
      qtdText: text(derived.qtd),
      ytd: official.ytd ?? derived.ytd,
      ytdText: text(official.ytd ?? derived.ytd),
      yr1: official.yr1 ?? derived.yr1,
      yr1Text: text(official.yr1 ?? derived.yr1),
      yr3: official.yr3 ?? derived.cagr3y,
      yr3Text: text(official.yr3 ?? derived.cagr3y),
      yr5: official.yr5 ?? derived.cagr5y,
      yr5Text: text(official.yr5 ?? derived.cagr5y),
      yr10: official.yr10 ?? derived.cagr10y,
      yr10Text: text(official.yr10 ?? derived.cagr10y),
      sinceInception: official.sinceInception ?? derived.siAnn,
      sinceInceptionText: text(official.sinceInception ?? derived.siAnn),
    },
    quarterEnd: hasQuarterEnd
      ? {
          asOfDate: formatEdgarDate(quarterAnchor),
          ytd: quarterEnd.ytd,
          yr1: quarterEnd.yr1,
          yr3: quarterEnd.yr3,
          yr5: quarterEnd.yr5,
          yr10: quarterEnd.yr10,
          sinceInception: quarterEnd.sinceInception,
        }
      : { asOfDate: formatEdgarDate(quarterAnchor), ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null },
  };
}

async function storeRaw(ticker: string, name: string, payload: unknown): Promise<void> {
  const rawDir = new URL(`raw/${ticker}/`, API_ROOT);
  await mkdir(rawDir, { recursive: true });
  await writeFile(new URL(name, rawDir), `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
}

async function processFund(
  fund: CatalogFund,
  config: UpdaterConfig,
  previous: JsonRecord,
): Promise<JsonRecord | null> {
  const ticker = fund.ticker;

  // Filters run against fresh catalog values (or the previous catalog when
  // am.jpmorgan.com is unavailable) before any per-fund download happens.
  const preMetrics = deriveCatalogMetrics(
    fund.returns,
    EMPTY_PRICE_RETURNS,
    fund.dividendYield ?? numberOrNull((previous.metrics as JsonRecord)?.dividendYield),
    fund.secYield,
    null,
    null,
    fund.close,
  );
  const reasons = fundFilterReasons(
    { ticker, aumValue: fund.netAssets ?? numberOrNull(previous.aumValue), terValue: fund.ter ?? numberOrNull(previous.terValue), metrics: preMetrics },
    config,
  );
  if (reasons.length) {
    return null;
  }

  const fundDir = new URL(`funds/${ticker}/`, API_ROOT);
  await mkdir(fundDir, { recursive: true });

  const cusip = fund.cusip || String((previous as JsonRecord).cusip ?? '');

  // 1) product-data JSON: fund facts + the complete daily holdings list;
  //    SEC Form N-PORT-P as the holdings fallback.
  let product: ProductData | null = null;
  if (!config.skipJpmorgan && cusip) {
    try {
      const payload = await fetchJson(jpmorganProductDataUrl(cusip, config.role), `[ product  ] ${ticker}`, jpmorganHeaders(), config);
      product = parseProductData(payload, ticker);
      if (config.storeRawDownloads) await storeRaw(ticker, `product-data-${(product.holdings?.asOfDate || product.navDate || 'latest').replace(/-/g, '')}.json`, payload);
    } catch (error) {
      console.warn(`[ product  ] ${ticker}: ${errorMessage(error)}${config.edgarFallback ? ' — holdings via SEC EDGAR N-PORT-P' : ''}`);
    }
  } else if (!config.skipJpmorgan) {
    console.warn(`[ product  ] ${ticker}: no CUSIP in the catalog — product-data skipped${config.edgarFallback ? ', holdings via SEC EDGAR N-PORT-P' : ''}`);
  }

  let holdings: ParsedHoldings | null = product?.holdings ?? null;
  let holdingsSource = `am.jpmorgan.com product-data ${product?.holdings?.container || 'dailyHoldingsAll'} (the "Download holdings" workbook rows with CUSIP/SEDOL identifiers)`;
  let holdingsEdgar: ParsedNport | null = null;
  if (holdings) {
    const sum = weightsSum(holdings.rows);
    if (sum > 0 && sum < 1) {
      // Weights arrived as fractions instead of percent: normalize once.
      holdings.rows = holdings.rows.map((row) => ({ ...row, Weight: String(round((numberOrNull(row.Weight) || 0) * 100, 6)) }));
    }
  } else if (product) {
    console.warn(`[ holdings ] ${ticker}: product-data lists no positions${config.edgarFallback ? ' — trying SEC EDGAR N-PORT-P' : ''}`);
  }

  if (!holdings && config.edgarFallback) {
    try {
      const filing = await resolveNportFiling(fund, config);
      if (filing) {
        const parsed = parseNport(await fetchText(filing.accession.url, `[ nport    ] ${ticker}`, secHeaders(config), config));
        // A registrant files one N-PORT-P per series: only accept the document
        // that really belongs to this fund, never the trust's newest filing.
        const filedSeries = normalizeHoldingName(parsed.seriesName);
        const wantedSeries = normalizeHoldingName(fund.name);
        const belongsToFund = filing.seriesId
          ? !parsed.seriesId || parsed.seriesId.toUpperCase() === filing.seriesId.toUpperCase()
          : Boolean(filedSeries && wantedSeries && (filedSeries === wantedSeries || filedSeries.includes(wantedSeries) || wantedSeries.includes(filedSeries)));
        if (!belongsToFund) {
          console.warn(`[ edgar    ] ${ticker}: ${filing.accession.accession} reports "${parsed.seriesName || 'unknown series'}" — skipped`);
        } else if (parsed.holdings.length) {
          holdingsEdgar = parsed;
          holdings = {
            asOfDate: parsed.repPdDate || null,
            headers: HOLDINGS_HEADERS,
            rows: fillNportTickers(parsed.holdings, await loadCompanyTickerMap(config)),
          };
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${filing.accession.accession}, report period ${parsed.repPdDate || 'n/a'})`;
        }
      }
    } catch (error) {
      console.warn(`[ edgar    ] ${ticker}: ${errorMessage(error)} — keeping previous holdings`);
    }
  }

  const holdingsRows: JsonRecord[] = holdings ? holdings.rows : await readPreviousSheet(ticker, 'holdings');
  const holdingsHeaders = holdings?.headers.length
    ? holdings.headers
    : (await readPreviousSheetHeaders(ticker, 'holdings')) || HOLDINGS_HEADERS;
  const holdingsManifest = await writePages(fundDir, ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize);
  const holdingsAsOf = holdings?.asOfDate || (((previous.holdings as JsonRecord)?.asOfDate as string) ?? null);

  // 2) historicalData JSON (official daily NAV / market price + dividend
  //    schedule + quarter-end returns); the Yahoo chart only as the fallback.
  let historical: ParsedHistoricalData | null = null;
  if (!config.skipJpmorgan && cusip) {
    try {
      const payload = await fetchJson(jpmorganHistoricalDataUrl(cusip, config.role), `[ history  ] ${ticker}`, jpmorganHeaders(), config);
      historical = parseHistoricalData(payload, ticker);
      if (!historical.points.length) {
        console.warn(`[ history  ] ${ticker}: historicalData has no daily rows${config.skipYahoo ? '' : ' — trying the Yahoo chart feed'}`);
        historical = historical.dividends.length || historical.quarterEnd.asOfDate ? historical : null;
      }
      if (config.storeRawDownloads) await storeRaw(ticker, `historical-data-${(historical?.points.at(-1)?.date || 'latest').replace(/-/g, '')}.json`, payload);
    } catch (error) {
      console.warn(`[ history  ] ${ticker}: ${errorMessage(error)}${config.skipYahoo ? ' — keeping previous history' : ' — trying the Yahoo chart feed'}`);
    }
  }

  let chartDays: ChartDay[] = [];
  let history: JsonRecord[] = [];
  let historyHeaders: string[] = HISTORY_HEADERS;
  let dividends: Array<{ epoch: number; amount: number }> = historical?.dividends ?? [];
  let exchangeName = '';
  let navFromChart: number | null = null;
  let priceFromChart: number | null = null;
  let marketTime: number | null = null;
  let firstTradeDate: number | null = null;
  let historySource = 'am.jpmorgan.com historicalData (daily NAV, market price and premium/discount since inception)';

  let coveredFrom: string | null = null;
  if (historical?.points.length) {
    chartDays = navTotalReturnDays(historical.points, historical.dividends);
    coveredFrom = reinvestmentCoverageStart(historical.points, historical.dividends);
    history = officialHistoryRows(historical.points);
  } else if (!config.skipYahoo) {
    try {
      const chart = parseChart(await fetchJson(chartUrl(ticker, config), `[ chart    ] ${ticker}`, yahooHeaders(), config));
      exchangeName = chart.exchangeName;
      navFromChart = chart.navPrice;
      priceFromChart = chart.regularMarketPrice;
      marketTime = chart.regularMarketTime;
      firstTradeDate = chart.firstTradeDate;
      if (!dividends.length) dividends = chart.dividends;
      chartDays = chart.days;
      history = historyRows(chart.days);
      historyHeaders = YAHOO_HISTORY_HEADERS;
      historySource = 'Yahoo Finance public chart API (adjusted close)';
    } catch (error) {
      console.warn(`[ chart    ] ${ticker}: ${errorMessage(error)} — keeping previous history`);
    }
  }

  const haveFreshHistory = history.length > 0;
  if (!haveFreshHistory) {
    history = await readPreviousSheet(ticker, 'history');
    const previousHeaders = await readPreviousSheetHeaders(ticker, 'history');
    historyHeaders = previousHeaders.length ? previousHeaders : HISTORY_HEADERS;
  }
  const derived = chartDays.length ? priceReturns(chartDays, new Date(), coveredFrom) : EMPTY_PRICE_RETURNS;

  // The dividend schedule lists the last payments; the product-data "latest
  // dividend" backs it up when the schedule is empty.
  if (!dividends.length && product?.latestDividend) {
    const epoch = isoToEpoch(product.latestDividend.exDate);
    if (epoch !== null) dividends = [{ epoch, amount: product.latestDividend.amount }];
  }
  const latestDividend = dividends.length ? dividends[dividends.length - 1] : null;
  const decodedFrequency = decodeDividendFrequency(product?.frequencyCode);
  const inferredFrequency = dividends.length >= 2 ? inferDistributionFrequency(dividends) : null;
  const frequency =
    decodedFrequency && decodedFrequency.paymentsPerYear !== null
      ? decodedFrequency
      : inferredFrequency && inferredFrequency.paymentsPerYear !== null
        ? inferredFrequency
        : decodedFrequency
          ? decodedFrequency
          : dividends.length
            ? inferDistributionFrequency(dividends)
            : { frequency: String((previous.distributions as JsonRecord)?.frequency || '—'), paymentsPerYear: null };

  // Official returns: product-data month-end "At NAV" (also carries 1-month)
  // backed by the fund explorer block; quarter-end from historicalData.
  const inception = product?.inception ?? fund.inception ?? null;
  const returnsAsOfDate = product?.monthEnd.asOfDate ?? fund.returnsAsOfDate ?? null;
  const official = mergeOfficial(product?.monthEnd ?? null, fund.returns);
  official.sinceInception = annualizedSinceInception(official.sinceInception, inception, returnsAsOfDate);
  const quarterEndSource = historical?.quarterEnd.asOfDate ? historical.quarterEnd : fund.quarterEnd;
  const quarterEndAsOfDate = historical?.quarterEnd.asOfDate ?? fund.quarterEndAsOfDate ?? null;
  const quarterEnd: CatalogReturns = { ...quarterEndSource };
  quarterEnd.sinceInception = annualizedSinceInception(quarterEnd.sinceInception, inception, quarterEndAsOfDate);

  const ter = product?.grossExpense ?? product?.netExpense ?? fund.ter ?? numberOrNull(previous.terValue);
  const nav = product?.nav ?? fund.nav ?? navFromChart ?? numberOrNull(previous.navValue);
  const price = product?.marketPrice ?? fund.close ?? priceFromChart ?? numberOrNull(previous.closePriceValue);
  const dividendYield = product?.dividendYield ?? fund.dividendYield;
  const secYield = product?.secYield ?? fund.secYield;

  const metrics = deriveCatalogMetrics(
    official,
    derived,
    dividendYield,
    secYield,
    latestDividend ? latestDividend.amount : null,
    frequency.paymentsPerYear,
    price,
    product?.cumulative ?? null,
  );

  const historyManifest = await writePages(fundDir, ticker, 'history', historyHeaders, history, config.historyPageSize);
  const distributions = dividends.length ? distributionRows(dividends) : (((previous.distributions?.rows as JsonRecord[]) || []) as string[][]);

  // Without a fresh am.jpmorgan.com catalog the filed N-PORT-P series name is
  // the most authoritative fund name available.
  const name =
    product?.name || (fund.source !== 'jpmorgan' && holdingsEdgar?.seriesName) || fund.name || String(previous.name ?? '') || ticker;
  const premiumDiscount =
    product?.premiumDiscount ?? fund.premiumDiscount ?? (nav && price ? round(((price - nav) / nav) * 100, 2) : null);
  // Fresh am.jpmorgan.com net assets win; when the catalog row only comes from
  // the previously published index (am.jpmorgan.com unavailable), the N-PORT-P
  // net assets of the filing we just parsed are the authoritative number.
  const nportNetAssets = holdingsEdgar
    ? holdingsEdgar.netAssets ?? (holdingsEdgar.totalValue ? round(holdingsEdgar.totalValue, 2) : null)
    : null;
  const catalogNetAssets = product?.netAssets ?? (fund.source === 'jpmorgan' || fund.source === 'early-nav' ? fund.netAssets : null);
  const netAssets = catalogNetAssets ?? nportNetAssets ?? fund.netAssets ?? numberOrNull(previous.aumValue);
  const navAsOfDate = product?.navDate ?? fund.asOfDate ?? null;
  const returnsData = returnsBlock(derived, official, product?.monthEnd.mo1 ?? fund.mo1 ?? null, returnsAsOfDate, quarterEnd, quarterEndAsOfDate, previous);
  const asOfLabel = navAsOfDate ? formatEdgarDate(navAsOfDate) : marketTime ? formatEpochDate(marketTime) : String(previous.asOfDate ?? '—');
  const category = product?.assetClass && product.assetClass !== 'ETF' ? product.assetClass : fund.category;
  const benchmark = product?.benchmark || fund.benchmark;
  const exchange = product?.exchange || fund.exchange || exchangeName || String(previous.exchange ?? '');
  const fundPage = cusip ? jpmorganFundPageUrl(name, cusip) : fund.fundPage;

  const meta: JsonRecord = {
    ticker,
    name,
    category,
    categoryPath: benchmark ? `${category} / ${benchmark}` : category,
    source: {
      fundPage,
      productData: cusip ? jpmorganProductDataUrl(cusip, config.role) : null,
      historicalData: cusip ? jpmorganHistoricalDataUrl(cusip, config.role) : null,
      holdingsDownload: cusip ? jpmorganHoldingsDownloadUrl(cusip, config.role) : null,
      pricesDownload: cusip ? jpmorganPricesDownloadUrl(cusip, config.role, inception ?? '', navAsOfDate ?? '') : null,
      yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}`,
      holdingsSource,
      historySource: haveFreshHistory ? historySource : (((previous.source as JsonRecord)?.historySource as string) ?? 'previous run'),
      provider: 'J.P. Morgan Asset Management public fund data (FundsMarketingHandler JSON) + SEC EDGAR Form N-PORT-P (fallback) + Yahoo Finance public chart API (fallback)',
    },
    identifiers: { cusip: cusip || null, isin: product?.isin || fund.isin || null, indexTicker: benchmark || null },
    inception: {
      fundInceptionDate: inception,
      shareClassInceptionDate: product?.listingDate ?? null,
      exchange: exchange || null,
    },
    expenseRatio: {
      display: ter === null ? '—' : `${ter}%`,
      value: ter,
      gross: product?.grossExpense ?? null,
      net: product?.netExpense ?? null,
    },
    nav: { display: nav === null ? '—' : `$${nav.toFixed(2)}`, value: nav, asOfDate: asOfLabel },
    marketPrice: {
      display: price === null ? '—' : `$${price.toFixed(2)}`,
      value: price,
      asOfDate: product?.marketPriceDate ? formatEdgarDate(product.marketPriceDate) : asOfLabel,
    },
    premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount },
    aum: {
      display: netAssets === null ? '—' : formatAumDisplay(netAssets),
      value: netAssets,
      asOfDate:
        catalogNetAssets !== null && (product?.netAssetsDate || navAsOfDate)
          ? formatEdgarDate((product?.netAssetsDate || navAsOfDate) as string)
          : nportNetAssets !== null && holdingsEdgar?.repPdDate
            ? formatEdgarDate(holdingsEdgar.repPdDate)
            : (((previous.aum as JsonRecord)?.asOfDate as string) ?? '—'),
      source:
        catalogNetAssets !== null
          ? product?.netAssets !== null && product?.netAssets !== undefined
            ? 'am.jpmorgan.com product-data net assets'
            : 'am.jpmorgan.com fund explorer "assetsUnderManagement"'
          : nportNetAssets !== null
            ? `SEC Form N-PORT-P net assets (report period ${holdingsEdgar?.repPdDate || 'n/a'})`
            : 'previous run',
    },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldKind:
        product?.dividendYield !== null && product?.dividendYield !== undefined
          ? `${product.dividendYieldKind}${product.dividendYieldDate ? `, as of ${formatEdgarDate(product.dividendYieldDate)}` : ''}`
          : metrics.dividendYield !== null
            ? 'indicated (latest distribution x payments per year / market price)'
            : 'not published: no distributions yet',
      distributionRate: fund.distributionRate,
      secYield: metrics.secYield,
      secYieldText: metrics.secYieldText,
      secYieldKind:
        product?.secYield !== null && product?.secYield !== undefined
          ? `${product.secYieldKind}${product.secYieldDate ? `, as of ${formatEdgarDate(product.secYieldDate)}` : ''}`
          : secYield !== null
            ? '30-day SEC yield (month-end, am.jpmorgan.com fund explorer)'
            : 'not published by JPMorgan for this fund',
      unsubsidizedSecYield: product?.unsubsidizedSecYield ?? null,
    },
    returns: returnsData,
    distributions: {
      frequency: frequency.frequency,
      paymentsPerYear: frequency.paymentsPerYear,
      frequencyCode: product?.frequencyCode || null,
      headers: ['Ex-Date', 'Amount'],
      rows: distributions,
    },
    holdings: {
      ...holdingsManifest,
      asOfDate: holdingsAsOf,
      asOf: holdingsAsOf ? formatEdgarDate(holdingsAsOf) : '—',
      source: holdingsSource,
    },
    history: {
      ...historyManifest,
      asOf: haveFreshHistory && derived.asOfDate ? formatEdgarDate(derived.asOfDate) : (((previous.history as JsonRecord)?.asOf as string) ?? '—'),
      source: haveFreshHistory ? historySource : 'previous run',
    },
  };
  await writeIfChanged(new URL('meta.json', fundDir), meta);

  const monthEnd = ((returnsData as JsonRecord)?.monthEnd as JsonRecord) || {};
  return {
    ticker,
    name,
    category,
    fundPage,
    dataFile: `./funds/${ticker}/meta.json`,
    cusip: cusip || null,
    isin: product?.isin || fund.isin || null,
    ter: ter === null ? '—' : `${ter}%`,
    terValue: ter,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: netAssets === null ? '—' : formatAumDisplay(netAssets),
    aumValue: netAssets,
    asOfDate: asOfLabel,
    inceptionDate: inception
      ? formatEdgarDate(inception)
      : firstTradeDate
        ? formatEpochDate(firstTradeDate)
        : (previous.inceptionDate || '—'),
    exchange,
    closePrice: price === null ? '—' : `$${price.toFixed(2)}`,
    closePriceValue: price,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    distributions: {
      frequency: frequency.frequency,
      exDate: latestDividend ? formatUsDate(latestDividend.epoch) : '—',
      dividend: latestDividend ? String(round(latestDividend.amount, 6)) : '—',
    },
    returns: { monthEnd, quarterEnd: ((returnsData as JsonRecord)?.quarterEnd as JsonRecord) || null },
    metrics,
    holdings: holdingsRows.length,
    history: history.length,
  };
}

// The JPMorgan ETF registrant CIK for a fund, needed only by the EDGAR
// fallback: the seed may pin it, otherwise it is read from the official SEC
// "ticker -> registrant CIK + series id" table and, as a last resort,
// discovered through the EDGAR full-text search API (cached per run).
const cikByTicker = new Map<string, string | null>();

// Lazily fetched, cached-per-run SEC lookup tables.
let fundTickerMap: Map<string, SecSeriesRef> | null = null;
let companyTickerMap: Map<string, string> | null = null;

async function loadFundTickerMap(config: UpdaterConfig): Promise<Map<string, SecSeriesRef>> {
  if (fundTickerMap) return fundTickerMap;
  try {
    const payload = await fetchJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', secHeaders(config), config);
    fundTickerMap = parseFundTickerMap(payload);
    console.log(`[ edgar    ] SEC fund ticker table: ${fundTickerMap.size} ETF / mutual-fund share classes`);
  } catch (error) {
    console.warn(`[ edgar    ] fund ticker table: ${errorMessage(error)} — falling back to full-text search`);
    fundTickerMap = new Map<string, SecSeriesRef>();
  }
  return fundTickerMap;
}

async function loadCompanyTickerMap(config: UpdaterConfig): Promise<Map<string, string>> {
  if (companyTickerMap) return companyTickerMap;
  try {
    const payload = await fetchJson(SEC_COMPANY_TICKERS_URL, '[ edgar    ] company ticker table', secHeaders(config), config);
    companyTickerMap = parseCompanyTickerMap(payload);
    console.log(`[ edgar    ] SEC company ticker table: ${companyTickerMap.size} issuer names`);
  } catch (error) {
    console.warn(`[ edgar    ] company ticker table: ${errorMessage(error)} — N-PORT tickers stay "-"`);
    companyTickerMap = new Map<string, string>();
  }
  return companyTickerMap;
}

// N-PORT positions carry CUSIP/ISIN but never a ticker; the SEC company table
// turns the filed issuer name back into an exchange symbol so the watchlist
// export stays usable, exactly like the sibling Fidelity updater.
function fillNportTickers(rows: NportHolding[], names: Map<string, string>): NportHolding[] {
  if (!names.size) return rows;
  return rows.map((row) => {
    if (cleanHoldingTicker(row.Ticker)) return row;
    const name = String(row.Name ?? '');
    const ticker = names.get(normalizeHoldingName(name)) || names.get(normalizeHoldingNameCore(name)) || '';
    return ticker ? { ...row, Ticker: ticker } : row;
  });
}

async function resolveRegistrantCik(fund: CatalogFund, config: UpdaterConfig): Promise<string | null> {
  if (cikByTicker.has(fund.ticker)) return cikByTicker.get(fund.ticker) as string | null;
  let cik: string | null = fund.trustCik || null;
  if (!cik) {
    const table = await loadFundTickerMap(config);
    cik = table.get(fund.ticker)?.cik || null;
  }
  if (!cik) {
    try {
      const payload = await fetchJson(eftsSearchUrl(fund.ticker), `[edgar   ] search ${fund.ticker}`, secHeaders(config), config);
      cik = pickEftsCik(payload, fund.name);
    } catch (error) {
      console.warn(`[ edgar    ] search ${fund.ticker}: ${errorMessage(error)}`);
    }
  }
  cikByTicker.set(fund.ticker, cik);
  return cik;
}

// The fund's own newest N-PORT-P filing. The SEC series id gives an exact,
// one-request answer (browse-edgar Atom, filtered to that series); scanning the
// whole registrant's submissions is the fallback when the series is unknown.
async function resolveNportFiling(
  fund: CatalogFund,
  config: UpdaterConfig,
): Promise<{ accession: NportAccession; cik: string; seriesId: string } | null> {
  const table = await loadFundTickerMap(config);
  const ref = table.get(fund.ticker) || null;
  if (ref?.seriesId) {
    try {
      const atom = await fetchText(edgarSeriesFilingsUrl(ref.seriesId), `[edgar   ] ${fund.ticker} series ${ref.seriesId}`, secHeaders(config), config);
      const [newest] = parseEdgarAtomFilings(atom);
      if (newest) return { accession: newest, cik: ref.cik, seriesId: ref.seriesId };
    } catch (error) {
      console.warn(`[ edgar    ] ${fund.ticker} series ${ref.seriesId}: ${errorMessage(error)} — scanning registrant submissions`);
    }
  }
  const cik = ref?.cik || (await resolveRegistrantCik(fund, config));
  if (!cik) return null;
  try {
    const submissions = await fetchJson(`${SEC_DATA_HOST}/submissions/CIK${cik}.json`, `[edgar   ] ${cik} submissions`, secHeaders(config), config);
    const [newest] = parseNportAccessions(submissions);
    if (newest) return { accession: newest, cik, seriesId: ref?.seriesId || '' };
  } catch (error) {
    console.warn(`[ edgar    ] ${fund.ticker}: ${errorMessage(error)}`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = readConfig();
  requestSleepMs = Math.max(0, config.requestSleep) * 1000;

  outputPrintConfig('JPMorgan', config);
  console.log('');

  // 1) Catalog discovery: fund explorer JSON, early-NAV CSV, previous index, seed.
  const catalog = new Map<string, CatalogFund>();
  let catalogSource = 'previous api/jpmorgan/index.json';
  const previousIndex = await readPreviousIndex();

  if (!config.skipJpmorgan) {
    try {
      const payload = await fetchJson(config.fundExplorerUrl, '[catalog ] fund explorer', jpmorganHeaders(), config);
      for (const fund of parseFundExplorer(payload)) catalog.set(fund.ticker, fund);
      if (config.storeRawDownloads) {
        const rawDir = new URL('raw/', API_ROOT);
        await mkdir(rawDir, { recursive: true });
        await writeFile(new URL(`fund-explorer-${new Date().toISOString().slice(0, 10)}.json`, rawDir), `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
      }
      catalogSource = 'am.jpmorgan.com ETF fund explorer JSON';
    } catch (error) {
      console.warn(`[ catalog  ] ${errorMessage(error)} — trying the early-NAV report CSV`);
    }
    if (!catalog.size) {
      try {
        const csv = await fetchText(config.earlyNavUrl, '[catalog ] early-NAV report', jpmorganHeaders(), config);
        for (const fund of parseEarlyNavCsv(csv)) catalog.set(fund.ticker, fund);
        if (config.storeRawDownloads) {
          const rawDir = new URL('raw/', API_ROOT);
          await mkdir(rawDir, { recursive: true });
          await writeFile(new URL(`early-nav-${new Date().toISOString().slice(0, 10)}.csv`, rawDir), csv, 'utf8');
        }
        catalogSource = 'am.jpmorgan.com early-NAV report CSV';
      } catch (error) {
        console.warn(`[ catalog  ] ${errorMessage(error)} — falling back to the published feed`);
      }
    }
  }

  if (!catalog.size) {
    for (const [ticker, row] of previousIndex) catalog.set(ticker, catalogFundFromIndex(ticker, row));
  } else {
    // Funds that disappeared from the download keep their published row (the
    // updater never deletes on a suspiciously small catalog).
    for (const [ticker, row] of previousIndex) {
      if (!catalog.has(ticker)) catalog.set(ticker, catalogFundFromIndex(ticker, row));
    }
  }

  // When am.jpmorgan.com is unreachable the SEC registrant tables still list
  // every share class of the J.P. Morgan Exchange-Traded Fund Trust, so a
  // no-argument full pass keeps covering the complete product line instead of
  // only the published feed.
  if (catalogSource !== 'am.jpmorgan.com ETF fund explorer JSON' && config.edgarFallback) {
    const table = await loadFundTickerMap(config);
    const registrantCiks = new Set<string>();
    for (const ticker of catalog.keys()) {
      const ref = table.get(ticker);
      if (ref) registrantCiks.add(ref.cik);
    }
    if (!registrantCiks.size) registrantCiks.add(JPMORGAN_ETF_TRUST_CIK.replace(/^0+/, ''));
    let discovered = 0;
    for (const [ticker, ref] of table) {
      if (!registrantCiks.has(ref.cik) || catalog.has(ticker)) continue;
      catalog.set(ticker, { ...catalogFundFromIndex(ticker, {}), source: 'seed' });
      discovered += 1;
    }
    if (discovered) {
      console.log(`[ catalog  ] +${discovered} funds discovered through the SEC registrant tables`);
      catalogSource = `${catalogSource} + SEC registrant tables`;
    }
  }

  const universe = [...catalog.values()].sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
  if (!universe.length) {
    console.log(
      '[done    ] nothing to do: am.jpmorgan.com is unreachable and the published ' +
        'api/jpmorgan/index.json is empty or missing — run this where am.jpmorgan.com resolves, e.g. ' +
        'the "Update JPMorgan ETF data" GitHub Actions workflow',
    );
    return;
  }
  console.log(`[ catalog  ] ${universe.length} JPMorgan ETFs (${catalogSource})`);

  // 2) Bounded, resumable batch run over the catalog (iShares/SPDR cursor).
  const state = await readUpdateState();
  // A plain `bun ./scripts/update-data.ts` (no MAX_FETCHES) always walks the
  // whole catalog from the top and clears the cursor afterwards; the saved
  // cursor only rotates the queue for explicitly bounded batch runs, exactly
  // like the sibling SPDR / iShares updaters.
  const cursor = config.maxFetches > 0 ? state?.cursor || null : null;
  const cursorIndex = cursor ? universe.findIndex((fund) => fund.ticker === cursor) : -1;
  const ordered =
    cursorIndex >= 0
      ? universe.slice(cursorIndex + 1).concat(universe.slice(0, cursorIndex + 1))
      : universe.slice();

  const queue = ordered.map((fund) => ({ fund }));
  const results: JsonRecord[] = [];
  let processed = 0;
  let lastProcessedTicker: string | null = cursor;
  let failures = 0;

  outputPrintFilter(universe.length, universe.length, outputHasOutputFilters(config));
  const output = outputCreateReporter(API_ROOT, config.maxFetches > 0 ? Math.min(config.maxFetches, ordered.length) : ordered.length);
  async function worker(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      if (config.maxFetches > 0 && processed >= config.maxFetches) return;
      processed += 1;
      const before = await output.before(item.fund.ticker);
      try {
        const row = await processFund(item.fund, config, previousIndex.get(item.fund.ticker) || {});
        if (row) {
          results.push(row);
          lastProcessedTicker = item.fund.ticker;
        }
        await output.result(item.fund.ticker, before, row ? undefined : 'skipped');
      } catch (error) {
        failures += 1;
        await output.result(item.fund.ticker, before, 'failed', String(error));
      }
      if (config.maxFetches > 0 && processed >= config.maxFetches) {
        console.log(`[ cursor   ] batch of ${config.maxFetches} reached — rerun to continue after ${lastProcessedTicker}`);
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, config.concurrency) }, () => worker()));

  // Funds not selected for a successful update keep their previously published rows.
  const keptFromPrevious = universe
    .filter((fund) => !results.some((row) => row.ticker === fund.ticker))
    .map((fund) => previousIndex.get(fund.ticker))
    .filter(Boolean) as JsonRecord[];
  const funds = [...results, ...keptFromPrevious].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));

  const counts = {
    funds: funds.length,
    holdings: funds.reduce((sum, fund) => sum + (numberOrNull(fund.holdings) || 0), 0),
    history: funds.reduce((sum, fund) => sum + (numberOrNull(fund.history) || 0), 0),
  };

  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'J.P. Morgan Asset Management (US ETFs)',
      market: 'us',
      site: JPMORGAN_SITE,
      catalog: JPMORGAN_CATALOG_PAGE,
      catalogDownload: config.fundExplorerUrl,
      catalogFallback: config.earlyNavUrl,
      productData: `${FUNDS_MARKETING_HANDLER}/product-data?cusip={CUSIP}&country=us&role=${config.role}&language=en&userLoggedIn=false`,
      holdings: `${FUNDS_MARKETING_HANDLER}/excel?type=dailyETFHoldings&cusip={CUSIP}&country=us&role=${config.role}&locale=en-US`,
      history: `${FUNDS_MARKETING_HANDLER}/historicalData?cusip={CUSIP}&country=us&role=${config.role}&language=en&userLoggedIn=false`,
      role: config.role,
    },
    counts,
    funds,
  });

  // Full passes reset the cursor: the next run starts from the top again.
  await writeUpdateState(config.maxFetches > 0 ? lastProcessedTicker : null);

  console.log('');
  console.log(`[ done     ] ${results.length} funds updated, ${keptFromPrevious.length} kept from previous runs, ${failures} failures`);
  console.log(`[ done     ] counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows`);
  console.log(
    `[ cursor   ] ${config.maxFetches > 0 && lastProcessedTicker ? `next run continues after ${lastProcessedTicker}` : 'full pass complete (cursor reset)'}`,
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### JPMorgan data update\n\n- updated: ${results.length}\n- kept from previous runs: ${keptFromPrevious.length}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`,
      'utf8',
    );
  }
}

async function yahooSearchForTicker(name: string, config: UpdaterConfig): Promise<string | null> {
  const payload = await fetchJson(yahooSearchUrl(name), `[ticker  ] ${name}`, yahooHeaders(), config);
  return pickSearchTicker(name, payload);
}

function catalogFundFromIndex(ticker: string, row: JsonRecord): CatalogFund {
  const metrics = (row.metrics as JsonRecord) || {};
  const monthEnd = ((row.returns as JsonRecord)?.monthEnd as JsonRecord) || {};
  const quarterEnd = ((row.returns as JsonRecord)?.quarterEnd as JsonRecord) || {};
  const cusip = String(row.cusip ?? '').toUpperCase();
  const name = String(row.name ?? ticker);
  return {
    ticker,
    name,
    category: String(row.category ?? 'ETF'),
    categoryPath: String(row.category ?? 'ETF'),
    inception: null,
    exchange: String(row.exchange ?? ''),
    cusip,
    isin: String(row.isin ?? '').toUpperCase(),
    benchmark: '',
    ter: numberOrNull(row.terValue),
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    dividendYield: numberOrNull(metrics.dividendYield),
    secYield: numberOrNull(metrics.secYield),
    distributionRate: null,
    asOfDate: null,
    returns: {
      ytd: numberOrNull(monthEnd.ytd),
      yr1: numberOrNull(monthEnd.yr1),
      yr3: numberOrNull(monthEnd.yr3),
      yr5: numberOrNull(monthEnd.yr5),
      yr10: numberOrNull(monthEnd.yr10),
      sinceInception: numberOrNull(monthEnd.sinceInception),
    },
    returnsAsOfDate: null,
    mo1: numberOrNull(monthEnd.mo1),
    marketReturns: { ...EMPTY_RETURNS },
    quarterEnd: {
      ytd: numberOrNull(quarterEnd.ytd),
      yr1: numberOrNull(quarterEnd.yr1),
      yr3: numberOrNull(quarterEnd.yr3),
      yr5: numberOrNull(quarterEnd.yr5),
      yr10: numberOrNull(quarterEnd.yr10),
      sinceInception: numberOrNull(quarterEnd.sinceInception),
    },
    quarterEndAsOfDate: null,
    fundPage: String(row.fundPage ?? (cusip ? jpmorganFundPageUrl(name, cusip) : `${JPMORGAN_CATALOG_PAGE}?search=${encodeURIComponent(ticker)}`)),
    trustCik: null,
    source: 'previous index',
  };
}

// ---------------------------------------------------------------------------
// Entry point (kept at the end: main() relies on the let bindings above)
// ---------------------------------------------------------------------------

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log(USAGE.trim());
  } else {
    await main().catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
  }
}
