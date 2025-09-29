#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./install_cachyos.sh [--full-upgrade]

Options:
  --full-upgrade  Run "sudo pacman -Syu" before installing Node.js and npm.
  -h, --help      Show this help message and exit.
USAGE
}

FULL_UPGRADE=false

while (($#)); do
  case "$1" in
    --full-upgrade)
      FULL_UPGRADE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo required"; exit 1
fi

if ! command -v pacman >/dev/null 2>&1; then
  echo "pacman not found (Arch/CachyOS expected)"; exit 1
fi

if [ "$FULL_UPGRADE" = true ]; then
  echo "[*] Performing full system upgrade (sudo pacman -Syu)..."
  sudo pacman -Syu
else
  echo "[*] Skipping full system upgrade. Pass --full-upgrade to run sudo pacman -Syu."
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
