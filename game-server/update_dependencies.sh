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

if ! command -v npm >/dev/null 2>&1; then
    abort "npm is required to audit dependencies."
fi

log "[*] Auditing dependencies..."
if npm audit; then
    log "[*] Audit completed. Attempting automated fixes..."
else
    log "[!] npm audit reported vulnerabilities. Attempting automated fixes..."
fi

if npm audit fix; then
    log "[*] npm audit fix completed."
else
    status=$?
    log "[!] npm audit fix exited with status $status. Some issues may require manual intervention."
    exit "$status"
fi

