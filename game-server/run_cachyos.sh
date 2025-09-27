#!/usr/bin/env bash
set -euo pipefail
export PORT="${PORT:-8081}"

if ! command -v node >/dev/null 2>&1; then echo "node not found"; exit 1; fi
if ! command -v npm  >/dev/null 2>&1; then echo "npm not found"; exit 1; fi
if ! command -v python3 >/dev/null 2>&1; then echo "python3 not found"; exit 1; fi

echo "[*] Running sanity..."
npm run sanity

echo "[*] Starting server on :$PORT"
exec npm start
