@echo off
:: Windows uninstall script for HomeGameServer
setlocal enabledelayedexpansion

echo =========================================
echo   HomeGameServer Uninstall Script
echo =========================================
echo.
echo This script will remove:
echo   - node_modules directory
echo   - .sessions directory
echo   - data directory (if exists)
echo   - package-lock.json
echo.
echo This script will NOT remove:
echo   - Node.js or npm
echo   - Source code files
echo   - .env configuration
echo.

set /p CONFIRM="Do you want to continue? [y/N]: "
if /i not "!CONFIRM!"=="y" (
    echo Uninstall cancelled.
    exit /b 0
)

echo [*] Stopping any running server processes...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq npm*" >nul 2>&1
timeout /t 2 /nobreak >nul 2>&1

if exist node_modules (
    echo [*] Removing node_modules directory...
    rd /s /q node_modules 2>nul
    if exist node_modules (
        echo [!] Failed to remove node_modules. Please close any programs using these files and try again.
        pause
        exit /b 1
    )
    echo [*] node_modules removed
) else (
    echo [*] node_modules not found, skipping...
)

if exist .sessions (
    echo [*] Removing .sessions directory...
    rd /s /q .sessions 2>nul
    echo [*] .sessions removed
) else (
    echo [*] .sessions not found, skipping...
)

if exist data (
    set /p REMOVE_DATA="Remove data directory (contains user profiles and game data)? [y/N]: "
    if /i "!REMOVE_DATA!"=="y" (
        echo [*] Removing data directory...
        rd /s /q data 2>nul
        echo [*] data removed
    ) else (
        echo [*] Keeping data directory
    )
) else (
    echo [*] data directory not found, skipping...
)

if exist package-lock.json (
    echo [*] Removing package-lock.json...
    del /f /q package-lock.json 2>nul
    echo [*] package-lock.json removed
)

echo.
echo [*] Uninstall complete!
echo.
echo To reinstall, run:
echo   run_windows.bat
echo.
pause
endlocal
