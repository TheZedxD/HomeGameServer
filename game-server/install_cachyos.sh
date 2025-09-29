#!/usr/bin/env bash
set -euo pipefail

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo required"; exit 1
fi

if ! command -v pacman >/dev/null 2>&1; then
  echo "pacman not found (Arch/CachyOS expected)"; exit 1
fi

echo "[*] Installing Node.js and npm dependencies via pacman..."
sudo pacman -S --noconfirm --needed nodejs npm

echo "[*] Installing Node deps via npm ci..."
if [ ! -d node_modules ]; then
  if ! npm ci; then
    status=$?
    echo "[!] npm ci failed (exit code $status). Falling back to npm install..." >&2
    npm install
  fi
else
  echo "[*] node_modules exists; skipping npm ci"
fi

echo "[*] Done."
