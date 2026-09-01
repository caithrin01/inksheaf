#!/usr/bin/env bash
# Deploy the private proof store (services/proof_store.py): stop, deploy, then run the
# contract test so a broken store never sits silently under the pipeline's validate step.
# Modal warm containers cache secrets across `modal deploy`; the stop forces a cold start.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.secrets/inksheaf-proof-token" ] || { echo "missing ~/.secrets/inksheaf-proof-token"; exit 1; }
python3 -m modal app stop inksheaf-proof-store || true
python3 -m modal deploy services/proof_store.py
sleep 3
node scripts/test-proof-store.mjs
