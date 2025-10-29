@echo off
REM Windows Installation Script Launcher
REM This batch file runs the PowerShell installation script with proper execution policy

echo ============================================
echo  Home Game Server - Windows Installation
echo ============================================
echo.

REM Check if PowerShell is available
where powershell >nul 2>nul
if errorlevel 1 (
    echo [!] PowerShell not found!
    echo [!] This script requires PowerShell to run.
    echo.
    pause
    exit /b 1
)

REM Run the PowerShell installation script
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1"

REM Exit with the same code as the PowerShell script
exit /b %ERRORLEVEL%
