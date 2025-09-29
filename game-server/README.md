# Local Multiplayer Game Server

This project is a lightweight, self-hosted web server for playing classic multiplayer games over a local network or via P2P.

## Features

- 🎮 Two-player Checkers matches that play as a best-of-three series with automatic round resets.
- 🧑‍🤝‍🧑 Personalized player display names that sync to match lobbies and scoreboards on every client.
- 📊 Live score tracking that updates in real time after every round, including the final match banner.
- 🖥️ Responsive lobby UI that highlights player readiness and host controls for starting a game.

## Setup

### Node.js requirements

This project targets modern Long-Term Support releases of Node.js. The `package.json` explicitly requires Node 18 or newer:

```json
{
  "engines": {
    "node": ">=18"
  }
}
```

- **Linux (recommended via NVM):**
  1. Install [NVM](https://github.com/nvm-sh/nvm) and load it into your shell:
     ```bash
     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
     export NVM_DIR="$HOME/.nvm"
     [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
     ```
  2. Install and activate the latest Node 18 LTS build:
     ```bash
     nvm install 18
     nvm use 18
     ```
- **Windows:**
  - Use [nvm-windows](https://github.com/coreybutler/nvm-windows) to install Node 18+ and switch between versions easily.
  - Alternatively, install the latest LTS release with Chocolatey:
    ```powershell
    choco install nodejs-lts
    ```

### Required build tools

Sharp (used for image processing) depends on native libraries. Install build tooling before running `npm ci`:

- **Debian/Ubuntu:** `sudo apt-get install build-essential libvips`
- **Arch/CachyOS:** Use the provided `setup_cachyos.sh` or ensure `base-devel` and `libvips` are available.
- **Windows:** Install the [Windows Build Tools](https://github.com/felixrieseberg/windows-build-tools) or the "Desktop development with C++" workload from the Visual Studio Build Tools installer.

### Clone the repository

1.  **Clone Repository:** Download or clone this repository to your machine.

## Configuration

1. Copy the example environment file and update the secrets before running the server:
    ```bash
    cp .env.example .env
    ```
2. Edit `.env` to provide strong, unique values for:
    - `SESSION_SECRET`
    - `JWT_SECRET`
    - `GUEST_SESSION_SECRET`
    - `ALLOWED_ORIGINS` (comma-separated list of allowed browser origins)
3. In production deployments behind HTTPS, set `NODE_ENV=production` so secure cookies are enforced.

## Installation

1. Open a terminal or command prompt and navigate to the `game-server` root directory.
2. Install the dependencies with the lockfile-aware workflow:
    ```bash
    npm ci
    ```
   - If `npm ci` fails because the packaged lock file is outdated, rerun the installation with:
     ```bash
     npm install
     ```
3. Create or update the `.env` file as described in the [Configuration](#configuration) section before starting the server.

- Debian/Ubuntu users can run `./run_ubuntu.sh` to install Node.js 18.x, the Sharp build dependencies, project packages, and then start the server automatically.
- CachyOS users can run `./install_cachyos.sh` to automatically install Node.js (if needed) and install project dependencies. The script falls back to `npm install` if `npm ci` detects an out-of-date lock file so installation succeeds on fresh systems.

## Running the Server

- **Development:**
  ```
  npm run dev
  ```
  This starts the server with live-reload via `nodemon` on the default port `8081`.
- **Production:**
  ```
  npm start
  ```
  The server will listen on `PORT` (defaults to `8081`). Access it at `http://[SERVER-IP-ADDRESS]:8081` or `http://localhost:8081` when running locally.
- CachyOS users can run `./run_cachyos.sh` to verify dependencies and launch the server automatically. The helper script first tries `npm ci` and automatically retries with `npm install` if the lock file needs to be refreshed.

## Windows & Linux Shortcuts

- Windows users can double-click `run_windows.bat` to check for Node.js, install dependencies, and start the server automatically.
- Debian/Ubuntu users can run `./run_ubuntu.sh` for an end-to-end setup that installs Node.js 18.x, system packages, JavaScript dependencies, and then launches the server.
- For a full environment bootstrap, use the cross-platform setup scripts:
  - PowerShell: `./setup.ps1`
  - CachyOS/Linux: `./setup_cachyos.sh`
    - Automatically retries with `npm install` if `npm ci` fails because the packaged lock file is stale.

## Maintenance

- Run the helper script to audit and patch dependencies automatically:
  ```bash
  ./update_dependencies.sh
  ```
  The script executes `npm audit` followed by `npm audit fix`, exiting with a non-zero status if fixes require manual follow-up.

## Security Notes

- Use strong, unique secrets in your `.env` file.
- Behind HTTPS, ensure `NODE_ENV=production` so cookies are marked `secure`.
- Restrict `ALLOWED_ORIGINS` to the domains that should access the server APIs.
