@echo off
setlocal enabledelayedexpansion

where node >nul 2>nul || (echo Node.js not found in PATH & pause & exit /b 1)
where npm  >nul 2>nul || (echo npm not found in PATH & pause & exit /b 1)

if exist package-lock.json (
  set "INSTALL_CMD=npm ci"
  set "INSTALL_DESC=npm ci"
) else (
  set "INSTALL_CMD=npm install"
  set "INSTALL_DESC=npm install"
)

echo [*] Installing dependencies with !INSTALL_DESC!...
call !INSTALL_CMD!
if errorlevel 1 (
  echo [!] Dependency installation failed.
  pause
  exit /b 1
)

set "TEST_SCRIPT="
for /f "usebackq tokens=* delims=" %%I in (`npm pkg get scripts.test 2^>nul`) do set "TEST_SCRIPT=%%~I"

if defined TEST_SCRIPT (
  set "TEST_SCRIPT=!TEST_SCRIPT:"=!"
  if /I "!TEST_SCRIPT!"=="undefined" (
    echo [*] No npm test script found; skipping tests.
  ) else (
    if "!TEST_SCRIPT!"=="" (
      echo [*] No npm test script found; skipping tests.
    ) else (
      echo [*] Running npm test...
      call npm test
      if errorlevel 1 (
        echo [!] Tests failed.
        pause
        exit /b 1
      )
    )
  )
) else (
  echo [*] No npm test script found; skipping tests.
)

if not defined PORT set "PORT=8081"

echo [*] Starting server on :%PORT%
call npm start
if errorlevel 1 (
  echo [!] Server exited with error.
  pause
  exit /b 1
)

endlocal
