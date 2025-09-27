#!/usr/bin/env bash
set -Eeuo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

echo "[*] Using node: $(command -v node || true)"
echo "[*] Node version: $(node -v 2>/dev/null || echo 'missing')"
echo "[*] NPM version:  $(npm -v 2>/dev/null || echo 'missing')"

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "[!] Install Node.js and npm (prefer nvm). Aborting."
  exit 1
fi

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "[*] Installing Node deps via npm ci..."
  npm ci
fi

# If a sanity script exists, run it; otherwise do a lightweight check
if npm run | grep -qE '^\s*sanity'; then
  echo "[*] Running sanity..."
  npm run sanity
else
  echo "[*] Running basic sanity..."
  node -e "require('./package.json'); console.log('sanity ok')"
fi

# Start the app: prefer npm start; else guess a common entry file
if npm run | grep -qE '^\s*start'; then
  echo "[*] Starting via npm start..."
  npm start
else
  entry=""
  for f in server.js index.js app.js dist/server.js dist/index.js; do
    [ -f "$f" ] && entry="$f" && break
  done
  if [ -z "$entry" ]; then
    # Try package.json "main"
    entry="$(node -e "try{console.log(require('./package.json').main||'')}catch(e){process.exit(0)}")"
  fi
  if [ -n "$entry" ] && [ -f "$entry" ]; then
    echo "[*] Starting via node $entry ..."
    exec node "$entry"
  else
    echo "[!] No start script and no entry file found. Add \"start\" to package.json or create server.js."
    exit 1
  fi
fi
