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

run_as_invoking_user() {
    if (( EUID == 0 )); then
        if [[ -n "${SUDO_USER:-}" ]] && command -v sudo >/dev/null 2>&1; then
            sudo -H -u "$SUDO_USER" -- "$@"
        else
            "$@"
        fi
    else
        "$@"
    fi
}

if [ -d node_modules ] && [ ! -w node_modules ]; then
    abort "node_modules is not writable by $(whoami). Please fix ownership or permissions before running dependency updates."
fi

if ! command -v npm >/dev/null 2>&1; then
    abort "npm is required to audit dependencies."
fi

log "[*] Auditing dependencies..."
if run_as_invoking_user npm audit; then
    log "[*] Audit completed. Attempting automated fixes..."
else
    log "[!] npm audit reported vulnerabilities. Attempting automated fixes..."
fi

if run_as_invoking_user npm audit fix; then
    log "[*] npm audit fix completed."
else
    status=$?
    log "[!] npm audit fix exited with status $status. Some issues may require manual intervention."
    exit "$status"
fi

