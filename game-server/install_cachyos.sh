#!/usr/bin/env bash
set -euo pipefail

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo required"; exit 1
fi

if ! command -v pacman >/dev/null 2>&1; then
  echo "pacman not found (Arch/CachyOS expected)"; exit 1
fi

echo "[*] Refreshing package databases..."
sudo pacman -Syu --noconfirm --needed

need_pkg() {
  local pkg="$1"
  if ! pacman -Qi "$pkg" >/dev/null 2>&1; then
    sudo pacman -S --noconfirm --needed "$pkg"
  fi
}

need_pkg nodejs
need_pkg npm
need_pkg python

echo "[*] Installing Node deps via npm ci..."
if [ ! -d node_modules ]; then
  npm ci
else
  echo "[*] node_modules exists; skipping npm ci"
fi

echo "[*] Done."
