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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

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

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[!] $1 required" >&2
    exit 1
  fi
}

require_command pacman

if (( EUID != 0 )) && ! command -v sudo >/dev/null 2>&1; then
  echo "[!] sudo required" >&2
  exit 1
fi

run_as_invoking_user() {
  if (( EUID == 0 )); then
    if [[ -n "${SUDO_USER:-}" ]] && command -v sudo >/dev/null 2>&1; then
      sudo -H -u "$SUDO_USER" -- "$@"
    else
      echo "[!] Running npm commands as root. Resulting files will be owned by root." >&2
      "$@"
    fi
  else
    "$@"
  fi
}

if [ "$FULL_UPGRADE" = true ]; then
  echo "[*] Performing full system upgrade (sudo pacman -Syu)..."
  if (( EUID == 0 )); then
    pacman -Syu
  else
    sudo pacman -Syu
  fi
else
  echo "[*] Skipping full system upgrade. Pass --full-upgrade to run sudo pacman -Syu."
fi

echo "[*] Installing Node.js and npm dependencies via pacman..."
if (( EUID == 0 )); then
  pacman -S --noconfirm --needed nodejs npm
else
  sudo pacman -S --noconfirm --needed nodejs npm
fi

if [ -d node_modules ]; then
  if (( EUID == 0 )) && [[ -n "${SUDO_USER:-}" ]] && command -v sudo >/dev/null 2>&1; then
    if ! sudo -H -u "$SUDO_USER" -- test -w node_modules; then
      echo "[!] node_modules exists but is not writable by $SUDO_USER. Please fix permissions (e.g., using chown) before running this script." >&2
      exit 1
    fi
  elif [ ! -w node_modules ]; then
    echo "[!] node_modules exists but is not writable. Please fix permissions before running this script." >&2
    exit 1
  fi
fi

if [ -f package-lock.json ]; then
  echo "[*] Installing Node.js dependencies with npm ci..."
  if ! run_as_invoking_user npm ci; then
    echo "[!] npm ci failed. The lockfile may be outdated. Falling back to npm install..."
    run_as_invoking_user npm install
  fi
else
  echo "[*] Installing Node.js dependencies with npm install..."
  run_as_invoking_user npm install
fi

echo "[*] Done."
