#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[!] npm is required but was not found in PATH." >&2
  exit 1
fi

echo "[*] Installing dependencies with npm ci..."
if [ -d node_modules ] && [ ! -w node_modules ]; then
  echo "[!] node_modules exists but is not writable by $(whoami). Please fix permissions (e.g., chown) before continuing." >&2
  exit 1
fi

if ! npm ci; then
  status=$?
  echo "[!] npm ci failed (exit code $status). Retrying with npm install to refresh lockfile..." >&2
  npm install
fi

echo "[*] Ensuring environment file exists..."
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "[*] Created .env from template."
  else
    echo "[!] .env.example not found; skipping environment bootstrap." >&2
  fi
else
  echo "[*] .env already present; leaving it untouched."
fi

echo "[*] Starting server with npm start..."
exec npm start
