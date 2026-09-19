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
  echo "head:"; head -c 300 "probe-out/$name.bin" | tr -c '[:print:]\n' '.' ; echo
}
probe pdp "https://am.jpmorgan.com/FundsMarketingHandler/javascript/chunks/pdp-7ac633d5a7558721f040.js"
probe pdpv3 "https://am.jpmorgan.com/FundsMarketingHandler/javascript/chunks/pdp-v3-606d8b1e464d4dda9df9.js"
probe fxv3 "https://am.jpmorgan.com/FundsMarketingHandler/javascript/chunks/fx-v3-8030f81274a0d1818bd8.js"
probe fxv2 "https://am.jpmorgan.com/FundsMarketingHandler/javascript/chunks/fx-v2-bef1f7b4dd25ae76d9f7.js"
probe card "https://am.jpmorgan.com/FundsMarketingHandler/javascript/chunks/card-25b68944a13737010ace.js"
echo "=================================================================="
echo "### endpoints in chunks"
for f in pdp pdpv3 fxv3 fxv2 card; do
  echo "## $f"
  grep -o -E '"[^"]{0,80}(FundsMarketingHandler|/api/|graphql|/rest/|/services/|\.json|handler|Handler)[^"]{0,120}"' probe-out/$f.bin | sort -u | head -60 | cut -c1-260
  echo "-- fetch/axios calls --"
  grep -o -E '(fetch|axios\.(get|post)|\.get|\.post)\(("|`)[^"`]{3,160}' probe-out/$f.bin | sort -u | head -60 | cut -c1-260
  echo "-- template urls --"
  grep -o -E '`[^`]{0,60}(cusip|type=|country=)[^`]{0,160}`' probe-out/$f.bin | sort -u | head -60 | cut -c1-260
  echo "-- concat urls --"
  grep -o -E '"[^"]{0,60}\?(type|cusip|country|role|locale|fundType)=[^"]{0,120}"' probe-out/$f.bin | sort -u | head -60 | cut -c1-260
done
echo done
