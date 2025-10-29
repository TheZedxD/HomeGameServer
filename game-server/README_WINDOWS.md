# Windows Installation Guide

## Quick Start (One-Click Install & Run)

### Option 1: Automatic Installation (Recommended)

Double-click `install_windows.bat` - this will:
- Check if Node.js and npm are installed
- Auto-install Node.js using winget or chocolatey if available
- Guide you through manual installation if needed
- Install all project dependencies
- Fix security vulnerabilities
- Set up your environment
- Optionally start the server

### Option 2: Manual Installation

If you already have Node.js installed:

1. Double-click `run_windows.bat` to install dependencies and start the server
2. Or run `setup.ps1` from PowerShell for a similar experience

## System Requirements

- **Windows 10 (1809+)** or **Windows 11** (for automatic installation)
- **Node.js 18 or higher** (will be installed automatically if missing)
- **npm** (comes with Node.js)

## Installation Methods

### Automatic Installation (Recommended)

The install script will attempt to install Node.js automatically using:

1. **winget** (Windows Package Manager) - Available on Windows 10 1809+ and Windows 11
2. **Chocolatey** - If you have it installed

If neither is available, the script will:
- Open your browser to https://nodejs.org/
- Guide you through manual installation
- Wait for you to complete the installation before continuing

### Manual Node.js Installation

If automatic installation isn't available:

1. Visit https://nodejs.org/
2. Download the **LTS version** (recommended)
3. Run the installer with default options
4. Restart your terminal/command prompt
5. Run `install_windows.bat` again

## Troubleshooting

### "PowerShell execution policy" error

If you see an error about script execution policy when running `.ps1` files:

1. Use `install_windows.bat` or `run_windows.bat` instead (they handle this automatically)
2. Or run PowerShell as Administrator and execute:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

### "Node.js not found" after installation

1. Close and reopen your terminal/command prompt
2. Verify installation by running: `node --version`
3. If still not found, add Node.js to your PATH manually:
   - Search for "Environment Variables" in Windows
   - Edit the "Path" variable
   - Add: `C:\Program Files\nodejs\`
   - Click OK and restart your terminal

### Security vulnerabilities warning

The message `2 moderate severity vulnerabilities` is normal and will be automatically fixed by running:
```
npm audit fix
```

The install script and run script both do this automatically.

### Port already in use

If you see "Port 8081 already in use":

1. Stop any running server instances
2. Or set a different port: `set PORT=3000` before running the server
3. Run the script again

## Files Included

- **install_windows.bat** - Main installation launcher (double-click this!)
- **install_windows.ps1** - PowerShell installation script (called by .bat)
- **run_windows.bat** - Run server after installation
- **setup.ps1** - Alternative PowerShell setup script
- **uninstall.bat** - Uninstall dependencies

## What Gets Installed

- Node.js (if not present)
- npm (comes with Node.js)
- Project dependencies from package.json
- Security updates via npm audit fix

## Configuration

The server uses a `.env` file for configuration. The install script will automatically create one from `.env.example` if it doesn't exist.

## Starting the Server

After installation, the server will start automatically on:
- http://localhost:8081
- http://YOUR-LOCAL-IP:8081 (shown in console)

Press `Ctrl+C` to stop the server.

## Getting Help

If you encounter issues:

1. Check this troubleshooting guide
2. Ensure Node.js 18+ is installed: `node --version`
3. Try deleting `node_modules` and running the install script again
4. Check the project's main README.md for more information

## Advanced Usage

### Custom Port

```batch
set PORT=3000
run_windows.bat
```

### Run Tests

```batch
set RUN_TESTS=true
run_windows.bat
```

### Development Mode (with auto-reload)

```batch
npm run dev
```
