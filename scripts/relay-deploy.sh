#!/usr/bin/env bash
# Deploy the Modal archive relay the only way that actually takes: stop, deploy, verify.
# Modal warm containers cache code AND secrets across `modal deploy`; a stop forces cold start.
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN_FILE="$HOME/.secrets/inksheaf-relay-token"
[ -f "$TOKEN_FILE" ] || { echo "missing $TOKEN_FILE"; exit 1; }
python3 -m modal app stop inksheaf-archive-relay || true
python3 -m modal deploy services/archive_relay.py
sleep 3
TOK=$(cat "$TOKEN_FILE")
BUCKET=$(( $(date +%s) / 300 ))
SIG=$(printf 'www.caithrin.com:all:%s' "$BUCKET" | openssl dgst -sha256 -hmac "$TOK" -hex | awk '{print $NF}')
CODE=$(curl -s -o /tmp/relay-verify.json -w "%{http_code}" \
  "https://caithrin--inksheaf-archive-relay-archive.modal.run?host=www.caithrin.com&mode=all&sig=$SIG")
if [ "$CODE" != "200" ]; then echo "RELAY VERIFY FAILED: $CODE $(head -c 200 /tmp/relay-verify.json)"; exit 1; fi
POSTS=$(python3 -c "import json;print(len(json.load(open('/tmp/relay-verify.json'))))")
echo "RELAY VERIFIED: 200, $POSTS posts"
