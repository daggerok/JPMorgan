/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, readConfig, resolveControls, runtimeControls } from './update-data';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json'));

test('configuration precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'JEPI' }, { CONCURRENCY: 3, TICKERS: 'JEPQ' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('JEPQ');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '' }).CONCURRENCY).toBe('3');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ TICKERS: 'JEPI' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
});

test('legacy and JPMORGAN_ aliases still reach the resolver', () => {
  expect(resolveControls({}, {}, {}, { JPMORGAN_LIMIT: '7' }).MAX_FETCHES).toBe('7');
  expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('500');
  expect(resolveControls({}, {}, {}, { JPMORGAN_TICKERS: 'JEPI', TICKERS: 'JEPQ' }).TICKERS).toBe('JEPI');
  expect(resolveControls({ MAX_FETCHES: 3 }, {}, {}, { JPMORGAN_LIMIT: '7', MAX_FETCHES: '9' }).MAX_FETCHES).toBe('9');
});

test('scheduled path (empty inputs and advanced) equals the config defaults', async () => {
  const scheduled = resolveControls(file, JSON.parse('{}'), {}, {});
  expect(scheduled).toEqual(Object.fromEntries(Object.entries(file).map(([k, v]) => [k, String(v)])));
  expect(await runtimeControls({})).toEqual(scheduled);
});

test('resolver rejects invalid JSON shapes, unknown keys, non-scalars and newlines', () => {
  for (const value of [{ UNKNOWN: 1 }, { OUTPUT_DIR: 'x' }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { SKIP_YAHOO: 'maybe' }, { AUM: '9:1' }, { TER: '5' }, { PERFORMANCE_1Y: '9:1' }, { TICKERS: ['JEPI'] }, { TICKERS: { a: 1 } }, null, [], 'x']) {
    expect(() => resolveControls(value)).toThrow();
  }
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'a\nb' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => resolveControls({}, null)).toThrow();
  expect(() => resolveControls({}, [])).toThrow();
});

test('provider-specific defaults', () => {
  const config = readConfig(resolveControls(file));
  expect(config.tickers).toEqual([]);
  expect(config.maxFetches).toBe(0);
  expect(config.requestSleep).toBe(1);
  expect(config.concurrency).toBe(2);
  expect(config.holdingsPageSize).toBe(250);
  expect(config.historyPageSize).toBe(1000);
  expect(config.maxRetries).toBe(2);
  expect(config.historyRange).toBe('max');
  expect(config.role).toBe('adv');
  expect(config.edgarFallback).toBe(true);
  expect(config.skipYahoo).toBe(false);
  expect(config.skipJpmorgan).toBe(false);
  expect(config.storeRawDownloads).toBe(false);
  expect(config.aumRange).toBeUndefined();
  expect(config.fundExplorerUrl).toContain('/FundsMarketingHandler/fund-explorer?country=us&role=adv');
  expect(readConfig(resolveControls(file, { MAX_RETRIES: 0 })).maxRetries).toBe(0);
  expect(readConfig(resolveControls(file, { AUM: '1B:' })).aumRange).toEqual({ min: 1e9, max: undefined });
  expect(readConfig(resolveControls(file, { API_BASE: 'http://127.0.0.1:1/x/' })).fundExplorerUrl).toStartWith('http://127.0.0.1:1/x/fund-explorer');
  expect(file.SEC_UA).toBe('');
  expect(JSON.stringify(file)).not.toContain('@');
});

test('config keys == CONTROL_NAMES == README rows == --help', () => {
  expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
  for (const value of Object.values(file)) expect(typeof value).toBe('string');
  const doc = read('README.md');
  const usage = Bun.spawnSync(['bun', 'scripts/update-data.ts', '--help'], { cwd: new URL('..', import.meta.url).pathname }).stdout.toString();
  // README lists the tenors of PERFORMANCE_* / TOTAL_RETURN_* on one row: `PREFIX_YTD` with `_1Y` ... `_10Y`
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);
    expect(doc).toContain(tenor ? '`_' + tenor[2] + '`' : '`' + name + '`');
    if (tenor) expect(doc).toContain('`' + tenor[1] + '_YTD`');
    expect(usage).toContain(tenor ? tenor[1] + '_YTD' : name);
  }
  expect(doc).toContain('scripts/update-data.config.json');
});

test('workflow: inputs, mapping, schedule, fixed output dir, no direct interpolation', () => {
  const wf = read('.github/workflows/update-data.yml');
  const block = wf.slice(wf.indexOf('    inputs:'), wf.indexOf('\npermissions:'));
  const names = [...block.matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(names).toContain('advanced');
  expect(block).toMatch(/advanced:[\s\S]*default: '\{\}'/);
  for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as never);
  expect(names).not.toContain('output_dir');
  expect(wf).toContain("cron: '0 0 * * 0'");
  expect(wf).not.toMatch(/^  push:/m);
  expect(wf).toContain('toJSON(inputs)');
  expect(wf).not.toMatch(/\$\{\{\s*(github\.event\.)?inputs\./);
  expect(wf).toContain('git add api/jpmorgan\n          if git diff --cached --quiet -- api/jpmorgan');
  expect(wf.match(/git add /g)?.length).toBe(1);
  expect(wf).not.toMatch(/OUTPUT_DIR/);
  expect(wf).toContain('if: ${{ !cancelled() }}');
  expect(wf).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
});
