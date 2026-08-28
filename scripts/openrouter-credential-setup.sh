#!/bin/bash
# Inksheaf: OpenRouter API key setup. Input is hidden; nothing is echoed or logged.
clear
echo "==============================================="
echo "  OpenRouter API key -> ~/.secrets/openrouter"
echo "  (from openrouter.ai/settings/keys)"
echo "==============================================="
echo
printf "Paste your OPENROUTER API KEY here and press Enter\n(typing is hidden): "
read -rs KEY
echo; echo
if [ -z "$KEY" ]; then echo "Empty input; nothing written. Close this window and rerun."; exit 1; fi
mkdir -p "$HOME/.secrets"
umask 177
printf 'export OPENROUTER_API_KEY=%q\n' "$KEY" > "$HOME/.secrets/openrouter"
echo "Saved. You can close this window."
