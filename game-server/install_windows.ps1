# Windows Installation Script for Home Game Server
# This script checks for and installs Node.js/npm if needed, then sets up the project

$ErrorActionPreference = 'Continue'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Home Game Server - Windows Installation" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-CommandExists {
    param($command)
    $null -ne (Get-Command $command -ErrorAction SilentlyContinue)
}

# Function to get Node.js version
function Get-NodeVersion {
    try {
        $version = node --version 2>$null
        return $version -replace 'v', ''
    }
    catch {
        return $null
    }
}

# Check for Node.js and npm
Write-Host "[1/5] Checking for Node.js and npm..." -ForegroundColor Yellow

$nodeExists = Test-CommandExists "node"
$npmExists = Test-CommandExists "npm"

if (-not $nodeExists -or -not $npmExists) {
    Write-Host ""
    Write-Host "[!] Node.js and/or npm not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Attempting automatic installation..." -ForegroundColor Yellow

    # Try winget first (Windows 10 1809+ / Windows 11)
    if (Test-CommandExists "winget") {
        Write-Host "    Using winget to install Node.js LTS..." -ForegroundColor Cyan
        try {
            winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements

            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

            Start-Sleep -Seconds 3

            if (Test-CommandExists "node") {
                Write-Host "    Node.js installed successfully!" -ForegroundColor Green
            }
            else {
                throw "Installation completed but node not found in PATH"
            }
        }
        catch {
            Write-Host "    Winget installation failed: $_" -ForegroundColor Red
        }
    }
    # Try chocolatey if available
    elseif (Test-CommandExists "choco") {
        Write-Host "    Using Chocolatey to install Node.js..." -ForegroundColor Cyan
        try {
            choco install nodejs-lts -y

            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

            Start-Sleep -Seconds 3

            if (Test-CommandExists "node") {
                Write-Host "    Node.js installed successfully!" -ForegroundColor Green
            }
            else {
                throw "Installation completed but node not found in PATH"
            }
        }
        catch {
            Write-Host "    Chocolatey installation failed: $_" -ForegroundColor Red
        }
    }

    # Final check
    if (-not (Test-CommandExists "node") -or -not (Test-CommandExists "npm")) {
        Write-Host ""
        Write-Host "[!] Automatic installation failed or is not available." -ForegroundColor Red
        Write-Host ""
        Write-Host "Please install Node.js manually:" -ForegroundColor Yellow
        Write-Host "    1. Visit: https://nodejs.org/" -ForegroundColor White
        Write-Host "    2. Download the LTS version (recommended)" -ForegroundColor White
        Write-Host "    3. Run the installer" -ForegroundColor White
        Write-Host "    4. Restart this script after installation" -ForegroundColor White
        Write-Host ""

        # Try to open browser
        try {
            Start-Process "https://nodejs.org/"
            Write-Host "Opening Node.js website in your browser..." -ForegroundColor Cyan
        }
        catch {
            Write-Host "Could not open browser automatically." -ForegroundColor Yellow
        }

        Write-Host ""
        Read-Host "Press Enter to exit"
        exit 1
    }
}
else {
    $nodeVersion = Get-NodeVersion
    Write-Host "    Node.js version: $nodeVersion" -ForegroundColor Green
    $npmVersion = npm --version
    Write-Host "    npm version: $npmVersion" -ForegroundColor Green
}

Write-Host ""

# Check Node.js version requirement
Write-Host "[2/5] Checking Node.js version..." -ForegroundColor Yellow
$nodeVersion = Get-NodeVersion
$requiredVersion = "18.0.0"

if ($nodeVersion) {
    $versionParts = $nodeVersion -split '\.'
    $majorVersion = [int]$versionParts[0]

    if ($majorVersion -lt 18) {
        Write-Host "    [!] Warning: Node.js 18 or higher is recommended. You have version $nodeVersion" -ForegroundColor Yellow
        Write-Host "    The server may not work correctly with older versions." -ForegroundColor Yellow
        $continue = Read-Host "    Continue anyway? (y/n)"
        if ($continue -ne 'y') {
            exit 1
        }
    }
    else {
        Write-Host "    Node.js version $nodeVersion meets requirements" -ForegroundColor Green
    }
}

Write-Host ""

# Install dependencies
Write-Host "[3/5] Installing dependencies..." -ForegroundColor Yellow

if (Test-Path "package-lock.json") {
    Write-Host "    Using npm ci (clean install)..." -ForegroundColor Cyan
    npm ci
    $installExitCode = $LASTEXITCODE
}
else {
    Write-Host "    Using npm install..." -ForegroundColor Cyan
    npm install
    $installExitCode = $LASTEXITCODE
}

if ($installExitCode -ne 0) {
    Write-Host "    [!] Dependency installation failed!" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit $installExitCode
}

Write-Host "    Dependencies installed successfully" -ForegroundColor Green
Write-Host ""

# Fix security vulnerabilities
Write-Host "[4/5] Checking and fixing security vulnerabilities..." -ForegroundColor Yellow
Write-Host "    Running npm audit fix..." -ForegroundColor Cyan

npm audit fix 2>&1 | Out-Null
$auditExitCode = $LASTEXITCODE

if ($auditExitCode -eq 0) {
    Write-Host "    Security vulnerabilities fixed" -ForegroundColor Green
}
else {
    Write-Host "    [!] Some vulnerabilities may remain (this is often normal)" -ForegroundColor Yellow
    Write-Host "    Run 'npm audit' manually for details" -ForegroundColor Yellow
}

Write-Host ""

# Setup environment file
Write-Host "[5/5] Setting up environment..." -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "    Created .env from .env.example" -ForegroundColor Green
    }
    else {
        Write-Host "    [!] No .env.example found, skipping .env setup" -ForegroundColor Yellow
    }
}
else {
    Write-Host "    .env already exists, leaving it untouched" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Installation completed successfully!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start the server, run:" -ForegroundColor Cyan
Write-Host "    .\run_windows.bat" -ForegroundColor White
Write-Host "or" -ForegroundColor Cyan
Write-Host "    .\setup.ps1" -ForegroundColor White
Write-Host ""

# Ask if user wants to start the server now
$startNow = Read-Host "Start the server now? (y/n)"
if ($startNow -eq 'y') {
    Write-Host ""
    Write-Host "Starting server..." -ForegroundColor Cyan
    Write-Host ""
    & ".\run_windows.bat"
}
else {
    Write-Host ""
    Read-Host "Press Enter to exit"
}
