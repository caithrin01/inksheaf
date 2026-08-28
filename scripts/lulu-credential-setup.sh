#!/bin/bash
# Inksheaf: Lulu sandbox credential setup. Input is hidden; nothing is echoed or logged.
clear
echo "==============================================="
echo "  Lulu SANDBOX credentials -> ~/.secrets/lulu"
echo "  (from developers.sandbox.lulu.com/user-profile/api-keys)"
echo "==============================================="
echo
printf "1/2  Paste your CLIENT KEY here and press Enter\n     (typing is hidden): "
read -rs KEY
echo
printf "2/2  Paste your CLIENT SECRET here and press Enter\n     (typing is hidden): "
read -rs SECRET
echo; echo
if [ -z "$KEY" ] || [ -z "$SECRET" ]; then
  echo "Empty input; nothing written. Close this window and rerun."; exit 1
fi
mkdir -p "$HOME/.secrets"
umask 177
cat > "$HOME/.secrets/lulu" <<EOT
export LULU_CLIENT_KEY="$KEY"
export LULU_CLIENT_SECRET="$SECRET"
EOT
chmod 600 "$HOME/.secrets/lulu"
grep -q '.secrets/lulu' "$HOME/.zshrc" 2>/dev/null || \
  printf '\n[ -f ~/.secrets/lulu ] && source ~/.secrets/lulu\n' >> "$HOME/.zshrc"
echo "Saved: key ${#KEY} chars (${KEY:0:4}...), secret ${#SECRET} chars."
echo "File: ~/.secrets/lulu (600, outside iCloud). zshrc sources it."
echo
echo "Done. You can close this window and tell Claude 'done'."
