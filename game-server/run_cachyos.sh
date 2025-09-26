#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

printf '=== HomeGameServer Runner ===\n'

if ! command -v node >/dev/null 2>&1; then
  printf 'ERROR: Node.js is not installed or not in PATH.\n'
  printf 'Please run ./install_cachyos.sh first.\n'
  exit 1
fi

if [ ! -d node_modules ]; then
  printf 'Dependencies not installed. Running npm install...\n'
  npm install
fi

printf 'Starting the game server...\n'
npm start
