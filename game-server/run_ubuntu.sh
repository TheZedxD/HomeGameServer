#!/bin/bash
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

if ! command -v apt-get >/dev/null 2>&1 && ! command -v apt >/dev/null 2>&1; then
    abort "This helper requires an APT-based distribution (Debian, Ubuntu, etc.)."
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
        return 0
    fi

    log "[*] Node.js not found. Installing Node.js 18.x..."

    if command -v curl >/dev/null 2>&1; then
        if curl -fsSL https://deb.nodesource.com/setup_18.x | run_privileged bash -; then
            install_packages nodejs
        else
            log "[!] NodeSource setup failed. Falling back to the distribution nodejs package."
            install_packages nodejs
        fi
    else
        log "[!] curl is unavailable; attempting to install distribution-provided nodejs package."
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

install_packages build-essential libvips libvips-dev

log "[*] Using node: $(command -v node)"
log "[*] Node version: $(node -v)"
log "[*] NPM version:  $(npm -v)"

if [ -f package-lock.json ]; then
    log "[*] Installing dependencies with npm ci..."
    if ! npm ci; then
        status=$?
        log "[!] npm ci failed (exit code $status). Attempting recovery with npm install..."
        npm install
    fi
else
    log "[*] Installing dependencies with npm install..."
    npm install
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
    npm start
    exit $?
fi

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

