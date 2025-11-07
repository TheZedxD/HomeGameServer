#!/bin/sh
set -eu
# shellcheck disable=SC3040
if command -v set >/dev/null 2>&1; then
    set -o pipefail 2>/dev/null || true
fi

script_dir=$(cd "$(dirname "$0")" && pwd)
cd "$script_dir"

if ! command -v node >/dev/null 2>&1; then
    echo "[!] Node.js is required but was not found in PATH."
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "[!] npm is required but was not found in PATH."
    exit 1
fi

echo "[*] Using node: $(command -v node)"
echo "[*] Node version: $(node -v)"
echo "[*] NPM version:  $(npm -v)"

if [ -f package-lock.json ]; then
    echo "[*] Installing dependencies with npm ci..."
    if ! npm ci; then
        status=$?
        echo "[!] npm ci failed (exit code $status). Attempting recovery with npm install..." >&2
        npm install
    fi
else
    echo "[*] Installing dependencies with npm install..."
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
    echo "[*] Starting via npm start..."
    port_value=${PORT:-8081}

    # Get local IP
    server_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "$server_ip" ]; then
        server_ip="127.0.0.1"
    fi

    npm start &
    server_pid=$!

    trap 'kill "$server_pid" 2>/dev/null || true' INT TERM

    echo ""
    echo "========================================="
    echo "  HomeGameServer is running!"
    echo "========================================="
    echo "Local:   http://localhost:$port_value"
    echo "Network: http://$server_ip:$port_value"
    echo ""
    echo "Open the Network URL on other devices to connect"
    echo "[*] Press Ctrl+C to stop the server."
    echo ""

    wait "$server_pid"
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
    echo "[*] Starting via node $entry ..."
    exec node "$entry"
fi

echo "[!] No start script and no entry file found. Add \"start\" to package.json or create server.js."
exit 1
