Param()

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

function Assert-Command {
    param (
        [string]$Command,
        [string]$Message
    )

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        Write-Host "[!] $Message"
        exit 1
    }
}

Assert-Command 'node' 'Node.js is required but was not found in PATH.'
Assert-Command 'npm' 'npm is required but was not found in PATH.'

Write-Host '[*] Installing dependencies with npm ci...'
npm ci
if ($LASTEXITCODE -ne 0) {
    Write-Host '[!] npm ci failed.'
    exit $LASTEXITCODE
}

if (-not (Test-Path '.env')) {
    if (Test-Path '.env.example') {
        Copy-Item '.env.example' '.env'
        Write-Host '[*] Created .env from .env.example.'
    }
    else {
        Write-Host '[!] .env.example not found; skipping environment bootstrap.'
    }
}
else {
    Write-Host '[*] .env already exists; leaving it untouched.'
}

Write-Host '[*] Starting server with npm start...'
npm start
exit $LASTEXITCODE
