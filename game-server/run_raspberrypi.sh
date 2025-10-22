#!/bin/bash
# Raspberry Pi setup and run script for HomeGameServer
# Supports Raspberry Pi OS (Debian-based) on ARM architecture

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

# Check if running on Raspberry Pi
is_raspberry_pi() {
    if [ -f /proc/device-tree/model ]; then
        grep -qi "raspberry pi" /proc/device-tree/model && return 0
    fi
    return 1
}

if ! is_raspberry_pi; then
    log "[!] Warning: This script is designed for Raspberry Pi. Detected system may not be compatible."
    log "[*] Proceeding anyway..."
fi

# Check for Debian-based system
if ! command -v apt-get >/dev/null 2>&1 && ! command -v apt >/dev/null 2>&1; then
    abort "This script requires an APT-based distribution (Raspberry Pi OS, Debian, etc.)."
fi

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        abort "Root privileges or sudo are required to install packages."
    fi
else
    SUDO=""
fi

if command -v apt-get >/dev/null 2>&1; then
    APT_CMD=apt-get
else
    APT_CMD=apt
fi

run_privileged() {
    if [ -n "$SUDO" ]; then
        $SUDO "$@"
    else
        "$@"
    fi
}

log "[*] Updating package index..."
run_privileged "$APT_CMD" update >/dev/null

install_packages() {
    if [ "$#" -eq 0 ]; then
        return 0
    fi
    log "[*] Installing packages: $*"
    run_privileged "$APT_CMD" install -y "$@"
}

if ! command -v curl >/dev/null 2>&1; then
    install_packages curl ca-certificates
fi

ensure_node() {
    if command -v node >/dev/null 2>&1; then
        local node_version=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$node_version" -ge 18 ]; then
            log "[*] Node.js $node_version.x is already installed"
            return 0
        else
            log "[*] Node.js $node_version.x is installed but version 18+ is recommended"
        fi
    fi

    log "[*] Installing Node.js 18.x for Raspberry Pi..."

    # Use NodeSource for ARM architecture
    if curl -fsSL https://deb.nodesource.com/setup_18.x | run_privileged bash -; then
        install_packages nodejs
    else
        log "[!] NodeSource setup failed. Trying distribution nodejs package..."
        install_packages nodejs
    fi
}

ensure_node

if ! command -v node >/dev/null 2>&1; then
    abort "Node.js installation failed."
fi

if ! command -v npm >/dev/null 2>&1; then
    abort "npm is required but was not installed correctly."
fi

# Install build tools and image processing libraries
# libvips is lighter weight than ImageMagick for Raspberry Pi
log "[*] Installing build tools and dependencies..."
install_packages build-essential python3 libvips libvips-dev

log "[*] Using node: $(command -v node)"
log "[*] Node version: $(node -v)"
log "[*] NPM version:  $(npm -v)"
log "[*] Architecture: $(uname -m)"

# Raspberry Pi specific optimizations
log "[*] Setting up npm configuration for Raspberry Pi..."
npm config set prefer-offline true 2>/dev/null || true
npm config set audit false 2>/dev/null || true

if [ -f package-lock.json ]; then
    log "[*] Installing dependencies with npm ci..."
    log "[*] This may take several minutes on Raspberry Pi..."
    if ! npm ci; then
        status=$?
        log "[!] npm ci failed (exit code $status). Attempting recovery with npm install..."
        npm install
    fi
else
    log "[*] Installing dependencies with npm install..."
    log "[*] This may take several minutes on Raspberry Pi..."
    npm install
fi

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        log "[*] Created .env from template. Please edit it with your configuration."
    fi
fi

start_script=$(npm pkg get scripts.start 2>/dev/null || printf 'undefined')
case "$start_script" in
    undefined|"undefined")
        has_start=false
        ;;
    *)
        has_start=true
        ;;
esac

if [ "$has_start" = true ]; then
    log "[*] Starting via npm start..."
    port_value=${PORT:-8081}

    # Get local IP
    server_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "$server_ip" ]; then
        server_ip="127.0.0.1"
    fi

    npm start &
    server_pid=$!

    trap 'kill "$server_pid" 2>/dev/null || true' INT TERM

    log ""
    log "========================================="
    log "  HomeGameServer is running!"
    log "========================================="
    log "Local:   http://localhost:$port_value"
    log "Network: http://$server_ip:$port_value"
    log ""
    log "Open the Network URL on other devices to connect"
    log "[*] Press Ctrl+C to stop the server."
    log ""

    wait "$server_pid"
    exit $?
fi

# Fallback: try to find entry file
entry=""
for candidate in server.js index.js app.js dist/server.js dist/index.js; do
    if [ -f "$candidate" ]; then
        entry=$candidate
        break
    fi
done

if [ -z "$entry" ]; then
    entry=$(node -e 'try{console.log(require("./package.json").main||"")}catch(e){process.exit(0)}') || entry=""
fi

if [ -n "$entry" ] && [ -f "$entry" ]; then
    log "[*] Starting via node $entry ..."
    exec node "$entry"
fi

abort "No start script and no entry file found. Add \"start\" to package.json or create server.js."
