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
  echo "head:"; head -c 1500 "probe-out/$name.bin" | tr -c '[:print:]\n' '.' ; echo
  # keep a 1.9MB cap so the workflow retains it
  if [ "$(stat -c %s "probe-out/$name.bin")" -gt 1900000 ]; then head -c 1900000 "probe-out/$name.bin" > "probe-out/$name.tmp" && mv "probe-out/$name.tmp" "probe-out/$name.bin"; echo "(truncated to 1.9MB)"; fi
}
B="https://am.jpmorgan.com/FundsMarketingHandler"
probe fx-etf "$B/fund-explorer?country=us&role=adv&userLoggedIn=false&language=en&fundType=etf&version=9.16_1789026120"
probe fx-etf-noversion "$B/fund-explorer?country=us&role=adv&language=en&fundType=etf"
probe pd-jepi "$B/product-data?cusip=46641Q332&country=us&role=adv&language=en&userLoggedIn=false"
probe pd-jpst "$B/product-data?cusip=46641Q837&country=us&role=adv&language=en&userLoggedIn=false"
probe hist-jepi "$B/historicalData?cusip=46641Q332&country=us&role=adv&language=en&userLoggedIn=false"
probe basic-jepi "$B/basic-info?cusip=46641Q332&country=us&role=adv&language=en&userLoggedIn=false"
probe py-etf "$B/performance-and-yields?country=us&role=adv&userLoggedIn=false&language=en&fundType=etf&version=9.16_1789026120"
probe fx-label "$B/fund-explorer-label?country=us&role=adv&language=en&version=9.16_1789026120"
probe fx-xlsx "$B/excel?type=fundExplorer&fundType=etf&country=us&role=adv"
probe div-xlsx "$B/excel?type=dividendHistory&cusip=46641Q332&country=us&role=adv&locale=en-US"
probe dist-xlsx "$B/excel?type=fundDistribution&cusip=46641Q332&country=us&role=adv&locale=en-US"
echo "=================================================================="
echo "### JSON key summaries"
for f in fx-etf pd-jepi pd-jpst hist-jepi basic-jepi py-etf; do
  echo "## $f"
  python3 - "$f" <<'PY'
import json,sys
name=sys.argv[1]
try:
    d=json.load(open(f'probe-out/{name}.bin'))
except Exception as e:
    print('not json:', e); sys.exit(0)
def walk(o, path, depth, out):
    if depth>4: return
    if isinstance(o, dict):
        for k,v in list(o.items())[:80]:
            p=f'{path}.{k}'
            if isinstance(v,(dict,list)): walk(v,p,depth+1,out)
            else: out.append(f'{p} = {repr(v)[:100]}')
    elif isinstance(o, list):
        out.append(f'{path} [list len={len(o)}]')
        if o: walk(o[0], path+'[0]', depth+1, out)
out=[]
walk(d,'',0,out)
print('\n'.join(out[:400]))
PY
done
echo done
