@echo off
cd /d "%~dp0"
echo === HomeGameServer Setup ===
echo Checking for Node.js and npm...
npm -v >NUL 2>NUL
IF %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org and try again.
    pause
    exit /B 1
)
echo Installing dependencies...
npm install
IF %ERRORLEVEL% NEQ 0 (
    echo Failed to install npm packages. Please check for errors.
    pause
    exit /B 1
)
echo Starting the game server...
npm start
