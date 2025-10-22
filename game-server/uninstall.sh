#!/bin/bash
# Universal uninstall script for HomeGameServer on Linux/Unix systems

set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
cd "$script_dir"

log() {
    printf '%s\n' "$*"
}

abort() {
    log "[!] $*"
    exit 1
}

confirm() {
    local prompt="$1"
    local response
    printf '%s [y/N]: ' "$prompt"
    read -r response
    case "$response" in
        [yY][eE][sS]|[yY])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

log "========================================="
log "  HomeGameServer Uninstall Script"
log "========================================="
log ""
log "This script will remove:"
log "  - node_modules directory"
log "  - .sessions directory"
log "  - data directory (if exists)"
log "  - package-lock.json"
log ""
log "This script will NOT remove:"
log "  - Node.js or npm"
log "  - Source code files"
log "  - .env configuration"
log ""

if ! confirm "Do you want to continue?"; then
    log "Uninstall cancelled."
    exit 0
fi

log "[*] Stopping any running server processes..."
pkill -f "node.*server.js" || true
pkill -f "npm.*start" || true
sleep 2

if [ -d node_modules ]; then
    log "[*] Removing node_modules directory..."
    rm -rf node_modules
    log "[✓] node_modules removed"
else
    log "[*] node_modules not found, skipping..."
fi

if [ -d .sessions ]; then
    log "[*] Removing .sessions directory..."
    rm -rf .sessions
    log "[✓] .sessions removed"
else
    log "[*] .sessions not found, skipping..."
fi

if [ -d data ]; then
    if confirm "Remove data directory (contains user profiles and game data)?"; then
        log "[*] Removing data directory..."
        rm -rf data
        log "[✓] data removed"
    else
        log "[*] Keeping data directory"
    fi
else
    log "[*] data directory not found, skipping..."
fi

if [ -f package-lock.json ]; then
    log "[*] Removing package-lock.json..."
    rm -f package-lock.json
    log "[✓] package-lock.json removed"
fi

log ""
log "[✓] Uninstall complete!"
log ""
log "To reinstall, run:"
log "  ./run_ubuntu.sh     (on Ubuntu/Debian)"
log "  ./run_cachyos.sh    (on CachyOS/Arch)"
log "  ./run_raspberrypi.sh (on Raspberry Pi)"
log ""
