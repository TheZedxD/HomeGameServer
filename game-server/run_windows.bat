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

set "RUN_TESTS_VALUE=%RUN_TESTS%"
if /I "!RUN_TESTS_VALUE!"=="true" (
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
) else (
  if defined RUN_TESTS (
    echo [*] RUN_TESTS is set to "!RUN_TESTS_VALUE!"; skipping tests.
  ) else (
    echo [*] RUN_TESTS not set; skipping tests.
  )
)

if not defined PORT set "PORT=8081"

for /f "usebackq tokens=* delims=" %%I in (`powershell -NoProfile -Command "($addresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' }) | Select-Object -First 1 -ExpandProperty IPAddress"`) do set "SERVER_IP=%%I"

if not defined SERVER_IP (
  for /f "tokens=2 delims=:" %%I in ('ipconfig ^| findstr /R /C:"IPv4 Address"') do (
    set "SERVER_IP=%%I"
    goto :trim_ip
  )
)
:trim_ip
if defined SERVER_IP (
  for /f "tokens=* delims= " %%I in ("!SERVER_IP!") do set "SERVER_IP=%%I"
)
if not defined SERVER_IP set "SERVER_IP=127.0.0.1"

echo [*] Starting server on :%PORT%
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = if ($env:PORT) { $env:PORT } else { '8081' }; ^
   $npm = Start-Process npm -ArgumentList 'start' -NoNewWindow -PassThru; ^
   $ip = if ($env:SERVER_IP) { $env:SERVER_IP } else { '127.0.0.1' }; ^
   Write-Host ('Server running at http://{0}:{1} and http://localhost:{1}' -f $ip, $port); ^
   Write-Host '[*] Press Ctrl+C to stop the server.'; ^
   $npm.WaitForExit(); ^
   exit $npm.ExitCode"

if errorlevel 1 (
  echo [!] Server exited with error.
  pause
  exit /b 1
)

endlocal
