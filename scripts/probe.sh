#!/usr/bin/env bash
set -u
mkdir -p probe-out
rm -f probe-out/*.bin probe-out/*.headers
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
probe() {
  local name="$1"; local url="$2"; shift 2
  echo "=================================================================="
  echo "### $name"
  echo "URL: $url"
  curl -sS -L --max-time 120 -A "$UA" -H 'Accept: application/json, text/plain, */*' -D "probe-out/$name.headers" -o "probe-out/$name.bin" "$@" "$url"
  echo "exit=$? size=$(stat -c %s "probe-out/$name.bin" 2>/dev/null)"
  grep -i -E '^(HTTP/|content-type|content-disposition|location)' "probe-out/$name.headers" | head -12
  echo "head:"; head -c 600 "probe-out/$name.bin" | tr -c '[:print:]\n' '.' ; echo
  if [ "$(stat -c %s "probe-out/$name.bin")" -gt 1900000 ]; then head -c 1900000 "probe-out/$name.bin" > "probe-out/$name.tmp" && mv "probe-out/$name.tmp" "probe-out/$name.bin"; echo "(truncated to 1.9MB)"; fi
}
B="https://am.jpmorgan.com/FundsMarketingHandler"
probe div-xlsx "$B/excel?type=dividendHistory&cusip=46641Q332&country=us&role=adv&locale=en-US&fromDate=2020-01-01&toDate=2026-09-19"
probe hist-jepi-range "$B/historicalData?cusip=46641Q332&country=us&role=adv&language=en&userLoggedIn=false&fromDate=2020-01-01&toDate=2026-09-19"
probe hist-jpst "$B/historicalData?cusip=46641Q837&country=us&role=adv&language=en&userLoggedIn=false"
probe pd-jlvp "$B/product-data?cusip=$(python3 -c "import json;d=json.load(open('probe-out/../probe-out/fx.json')) if False else None" 2>/dev/null; echo 46654Q195)&country=us&role=adv&language=en&userLoggedIn=false"
probe fx-etf "$B/fund-explorer?country=us&role=adv&userLoggedIn=false&language=en&fundType=etf"
python3 - <<'PY'
import json
d=json.load(open('probe-out/fx-etf.bin'))
for t in ['JLVP','BBJP','JMUB','JIRE','BBUS','JPFP']:
    for x in d:
        if x['ticker']==t: print(t, x['identifier'], x['fundInceptionDate'])
PY
for t in JLVP BBJP JMUB JIRE; do
  cusip=$(python3 -c "
import json
d=json.load(open('probe-out/fx-etf.bin'))
print([x['identifier'] for x in d if x['ticker']=='$t'][0])")
  probe pd-$t "$B/product-data?cusip=$cusip&country=us&role=adv&language=en&userLoggedIn=false"
done
probe hist-JIRE "$B/historicalData?cusip=$(python3 -c "
import json
d=json.load(open('probe-out/fx-etf.bin'))
print([x['identifier'] for x in d if x['ticker']=='JIRE'][0])")&country=us&role=adv&language=en&userLoggedIn=false"
probe sec-mf "https://www.sec.gov/files/company_tickers_mf.json" -A 'DaggerOk JPMorgan Feed admin@daggerok.example.com'
python3 - <<'PY'
import json
try:
    d=json.load(open('probe-out/sec-mf.bin'))
    rows=[r for r in d['data'] if str(r[0]) in ('1485894',)]
    print('JPM ETF trust rows:', len(rows)); print(rows[:5])
    fx=json.load(open('probe-out/fx-etf.bin'))
    tick={x['ticker'] for x in fx}
    found={r[3] for r in d['data'] if r[3] in tick}
    print('catalog tickers found in SEC map:', len(found), 'missing:', sorted(tick-found))
    ciks={}
    for r in d['data']:
        if r[3] in tick: ciks.setdefault(str(r[0]),[]).append(r[3])
    print('ciks:', {k:len(v) for k,v in ciks.items()})
except Exception as e:
    print('sec parse failed', e)
PY
echo "=================================================================="
echo "### JSON summaries"
python3 - <<'PY'
import json
for name in ['hist-jepi-range','hist-jpst','hist-JIRE']:
    try:
        d=json.load(open(f'probe-out/{name}.bin'))
    except Exception as e:
        print(name,'not json',e); continue
    div=d.get('dividendsDistributionHistoryList') or []
    px=d.get('historicalETFClosingPriceList') or []
    print(name, 'dividends', len(div), div[0]['exDate'] if div else None, div[-1]['exDate'] if div else None, 'prices', len(px), px[0]['date'] if px else None, px[-1]['date'] if px else None)
    print(' quarterly', json.dumps((d.get('quarterlyPerformanceReturns') or [None])[0])[:300])
    print(' perfchart', len(d.get('performanceDataForChart') or []))
for name in ['pd-jlvp','pd-JLVP','pd-BBJP','pd-JMUB','pd-JIRE']:
    try:
        d=json.load(open(f'probe-out/{name}.bin'))['fundData']
    except Exception as e:
        print(name,'not json',e); continue
    sc=d['shareClass']
    rows=(d.get('dailyHoldingsAll') or {}).get('data') or []
    print(name, sc.get('ticker'), 'holdings', len(rows), 'freq', d.get('dividendsFrequency'), 'exch', (sc.get('tradingInfo') or {}).get('exchange'), 'fees', json.dumps(sc.get('fees',{}).get('expenseRatio')), json.dumps(sc.get('expenses')))
    print(' yields', json.dumps(sc.get('yieldMonthEnd')), json.dumps(sc.get('etfSecYield')), json.dumps((sc.get('secYield') or {}).get('dividendYield')))
    print(' perf', json.dumps([{k:r.get(k) for k in ['performanceFactor','ytd','oneYear','threeYears','fiveYears','tenYears','inception','effectiveDate']} for r in sc.get('performanceReturns') or []])[:600])
    print(' cum', json.dumps([{k:r.get(k) for k in ['performanceFactor','oneYear','threeYears','fiveYears','tenYears','inception','effectiveDate']} for r in sc.get('cumulativePerformanceReturns') or []])[:400])
    print(' div', json.dumps(sc.get('fundShareclassDividend')))
    print(' inception', d.get('fundInceptionDate'), sc.get('shareClassInceptionDate'), 'nav', json.dumps({k:sc['nav'].get(k) for k in ['price','date','marketValueNavPrice']}), 'mp', json.dumps(sc.get('marketPrice')))
    print(' isin', sc.get('isin'), 'cusip', sc.get('cusip'), 'assetClass', d.get('assetClass'), 'numberOfHoldings', d.get('numberOfHoldings'))
    for r in rows[:3]: print('   ', json.dumps({k:r.get(k) for k in ['securityDescription','securityId','securityTicker','securityIsin','securityCusip','securitySedol','securityType','shares','marketValue','netAssetValuePercent','marketValuePercent','couponRate','finalLegalMaturityDate','country','currencyCode','method']}))
    from collections import Counter
    print('  types', Counter(r.get('securityType') for r in rows).most_common(12))
    print('  ids', Counter(('id' if r.get('securityId') else 'noid', 'tk' if r.get('securityTicker') else 'notk', 'isin' if r.get('securityIsin') else 'noisin') for r in rows).most_common())
PY
echo done
