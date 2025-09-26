#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

printf '=== HomeGameServer CachyOS Installer ===\n'

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js is not installed. Installing via pacman (requires sudo)...\n'
  sudo pacman -Sy --needed nodejs npm
else
  printf 'Node.js already installed.\n'
fi

printf 'Installing npm dependencies...\n'
npm install
printf 'Dependencies installed successfully.\n'
printf 'You can now run ./run_cachyos.sh to start the server.\n'
