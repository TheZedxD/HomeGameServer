@echo off
setlocal enabledelayedexpansion

where node >nul 2>nul || (echo Node.js not found in PATH & pause & exit /b 1)
where npm  >nul 2>nul || (echo npm not found in PATH & pause & exit /b 1)
where python >nul 2>nul || (echo Python not found in PATH & pause & exit /b 1)

if not exist node_modules (
  echo [*] Installing deps with npm ci...
  npm ci || (echo npm ci failed & pause & exit /b 1)
)

echo [*] Running sanity...
npm run sanity
if errorlevel 1 (echo Sanity failed & pause & exit /b 1)

echo [*] Starting server on :%PORT%
npm start
if errorlevel 1 (echo Server exited with error & pause & exit /b 1)

endlocal
