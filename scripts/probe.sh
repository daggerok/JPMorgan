#!/usr/bin/env bash
set -u
mkdir -p probe-out
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
probe() {
  local name="$1"; local url="$2"; shift 2
  echo "=================================================================="
  echo "### $name"
  echo "URL: $url"
  curl -sS -L --max-time 120 -A "$UA" -D "probe-out/$name.headers" -o "probe-out/$name.bin" "$@" "$url"
  echo "exit=$? size=$(stat -c %s "probe-out/$name.bin" 2>/dev/null)"
  grep -i -E '^(HTTP/|content-type|content-disposition|location|server|cf-|x-)' "probe-out/$name.headers" | head -20
  echo "magic: $(head -c 8 "probe-out/$name.bin" | xxd -p)"
  echo "head:"; head -c 600 "probe-out/$name.bin" | tr -c '[:print:]\n' '.' ; echo
}
probe early-nav "https://am.jpmorgan.com/content/dam/jpm-am-aem/americas/us/en/supplemental/early-nav-report/jpm-early-nav-etf.csv"
probe holdings-xlsx "https://am.jpmorgan.com/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=46641Q332&country=us&role=adv&locale=en-US"
probe holdings-xlsx-noua "https://am.jpmorgan.com/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=46641Q332&country=us&role=adv&locale=en-US" -A "Bun/1.4"
probe holdings-csv "https://am.jpmorgan.com/FundsMarketingHandler/csv?type=dailyETFHoldings&cusip=46641Q332&country=us&role=adv&locale=en-US"
probe holdings-json "https://am.jpmorgan.com/FundsMarketingHandler/json?type=dailyETFHoldings&cusip=46641Q332&country=us&role=adv&locale=en-US"
probe holdings-bond-xlsx "https://am.jpmorgan.com/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=46641Q837&country=us&role=adv&locale=en-US"
probe holdings-mmf-xlsx "https://am.jpmorgan.com/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip=46654Q542&country=us&role=adv&locale=en-US"
probe histnav-xlsx "https://am.jpmorgan.com/FundsMarketingHandler/excel?type=historicalNav&cusip=46641Q332&country=us&role=adv&locale=en-US&fromDate=2020-05-20&toDate=2026-09-19"
probe perfchart-xlsx "https://am.jpmorgan.com/FundsMarketingHandler/excel?type=performanceChart&cusip=46641Q332&country=us&role=adv&locale=en-US"
probe fundpage "https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-etf-shares-46641q332"
probe explorer "https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf"
probe sec-tickers-mf "https://www.sec.gov/files/company_tickers_mf.json" -A "DaggerOk JPMorgan Feed admin@daggerok.example.com"
probe sec-submissions "https://data.sec.gov/submissions/CIK0001485894.json" -A "DaggerOk JPMorgan Feed admin@daggerok.example.com"
probe yahoo-chart "https://query1.finance.yahoo.com/v8/finance/chart/JEPI?range=1mo&interval=1d&events=div"
probe yahoo-chart2 "https://query2.finance.yahoo.com/v8/finance/chart/JEPI?range=5d&interval=1d&events=div"

echo "=================================================================="
echo "### fund page analysis"
f=probe-out/fundpage.bin
grep -o 'FundsMarketingHandler/[a-zA-Z]*?[^"'"'"' <]*' "$f" | sort -u | head -40
echo "--- key phrases ---"
for p in "Fund Inception Date" "Dividend Schedule" "Ex-Date" "dailyETFHoldings" "Performance - MONTHLY" "30 Day SEC Yield" "12-Month Rolling Dividend Yield" "Number of Holdings" "Exchange" "Benchmark" "portfolio" "holdings-table" "data-cusip" "fundType"; do
  echo "$p: $(grep -c -- "$p" "$f")"
done
echo "--- script srcs ---"
grep -o '<script[^>]*src="[^"]*"' "$f" | head -30
echo "--- explorer analysis ---"
e=probe-out/explorer.bin
grep -o 'FundsMarketingHandler/[a-zA-Z]*?[^"'"'"' <]*' "$e" | sort -u | head -20
grep -o 'products/jpmorgan-[a-z0-9-]*-etf-shares-[0-9a-z]*' "$e" | sort -u | wc -l
grep -o 'products/jpmorgan-[a-z0-9-]*-etf-shares-[0-9a-z]*' "$e" | sort -u | head -100
grep -o -i 'api/[a-z0-9/._-]*' "$e" | sort -u | head -20
echo "--- xlsx inner files ---"
for n in holdings-xlsx histnav-xlsx perfchart-xlsx holdings-bond-xlsx; do
  echo "## $n"; (cd probe-out && unzip -l "$n.bin" 2>&1 | head -20)
done
echo "--- xlsx sheet text (holdings) ---"
(cd probe-out && mkdir -p x && unzip -o -q holdings-xlsx.bin -d x 2>/dev/null && ls x x/xl && head -c 3000 x/xl/worksheets/sheet1.xml; echo; head -c 1500 x/xl/sharedStrings.xml 2>/dev/null; echo)
echo "--- xlsx sheet text (histnav) ---"
(cd probe-out && mkdir -p h && unzip -o -q histnav-xlsx.bin -d h 2>/dev/null && ls h/xl && head -c 3000 h/xl/worksheets/sheet1.xml; echo; head -c 1500 h/xl/sharedStrings.xml 2>/dev/null; echo)
echo "--- xlsx sheet text (perfchart) ---"
(cd probe-out && mkdir -p p && unzip -o -q perfchart-xlsx.bin -d p 2>/dev/null && ls p/xl && head -c 2000 p/xl/worksheets/sheet1.xml; echo; head -c 1000 p/xl/sharedStrings.xml 2>/dev/null; echo)
echo "--- sec submissions summary ---"
head -c 1500 probe-out/sec-submissions.bin; echo
echo "--- yahoo ---"
head -c 800 probe-out/yahoo-chart.bin; echo
echo done
