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
  curl -sS -L --max-time 120 -A "$UA" -D "probe-out/$name.headers" -o "probe-out/$name.bin" "$@" "$url"
  echo "exit=$? size=$(stat -c %s "probe-out/$name.bin" 2>/dev/null)"
  grep -i -E '^(HTTP/|content-type|content-disposition|location)' "probe-out/$name.headers" | head -12
  echo "head:"; head -c 400 "probe-out/$name.bin" | tr -c '[:print:]\n' '.' ; echo
}
probe loader "https://am.jpmorgan.com/FundsMarketingHandler/javascript/fundsmarketingloader-new.js?1"
probe intlshim "https://am.jpmorgan.com/FundsMarketingHandler/javascript/intlshim.js"
probe shell "https://cdn.jpmorganfunds.com/etc/designs/jpm-am-aem/clientlib-site/jpm-am-container-npe-shell-component.min.d70d379a2530c22fd926a8a635feff08.js"
probe slugtest "https://am.jpmorgan.com/us/en/asset-management/adv/products/x-46641q399" -o /dev/null -w '%{http_code} %{url_effective}\n'
probe slugtest2 "https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-betabuilders-u-s-equity-etf-etf-shares-46641q399" -o /dev/null -w '%{http_code} %{url_effective}\n'
probe holdings-params "https://am.jpmorgan.com/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=46641Q837&country=us&role=adv&fundType=N_ETF&locale=en-US&isUnderlyingHolding=false&isProxyHolding=false"
probe yahoo-ua "https://query2.finance.yahoo.com/v8/finance/chart/JEPI?period1=0&period2=1789900000&interval=1d&events=div%7Csplit" -H "Accept: application/json"
probe yahoo-chart-plain "https://query1.finance.yahoo.com/v8/finance/chart/JEPI?range=5d&interval=1d" -A "curl/8.5.0"
probe sec-series "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001485894&type=NPORT-P&dateb=&owner=include&count=10&output=atom" -A "DaggerOk JPMorgan Feed admin@daggerok.example.com"

echo "=================================================================="
echo "### loader endpoints"
for f in loader intlshim shell; do
  echo "## $f"
  grep -o -E '(https?:)?//[a-zA-Z0-9./_-]*|/FundsMarketingHandler/[a-zA-Z0-9./_?=&-]*|"/[a-zA-Z0-9_-]+/[a-zA-Z0-9/_.-]*"' probe-out/$f.bin | sort -u | head -80
  echo "-- literal keywords --"
  grep -o -E '.{60}(productData|fundData|getFund|/api/|graphql|fundExplorer|fund-explorer|explorer|performance|dividend|distribution|productDetail|pdp)[A-Za-z]*.{60}' probe-out/$f.bin | head -40 | cut -c1-200
done
echo "--- loader script tags it injects ---"
grep -o -E '(src|href)[=:] *["'"'"'][^"'"'"']+' probe-out/loader.bin | sort -u | head -30
echo "--- holdings-params sheet header ---"
(cd probe-out && rm -rf hp && mkdir hp && unzip -o -q holdings-params.bin -d hp 2>/dev/null && head -c 1200 hp/xl/sharedStrings.xml; echo; rm -rf hp)
echo done
