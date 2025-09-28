# Local Multiplayer Game Server

This project is a lightweight, self-hosted web server for playing classic multiplayer games over a local network or via P2P.

## Features

- 🎮 Two-player Checkers matches that play as a best-of-three series with automatic round resets.
- 🧑‍🤝‍🧑 Personalized player display names that sync to match lobbies and scoreboards on every client.
- 📊 Live score tracking that updates in real time after every round, including the final match banner.
- 🖥️ Responsive lobby UI that highlights player readiness and host controls for starting a game.

## Setup

1.  **Node.js:** Ensure you have Node.js installed on the machine that will act as the server.
2.  **Clone Repository:** Download or clone this repository to your machine.

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
2. Install the dependencies:
    ```
    npm ci
    ```
    - CachyOS users can run `./install_cachyos.sh` to automatically install Node.js (if needed) and run `npm ci`.

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
- CachyOS users can run `./run_cachyos.sh` to verify dependencies and launch the server automatically.

## Windows & Linux Shortcuts

- Windows users can double-click `run_windows.bat` to check for Node.js, install dependencies, and start the server automatically.
- For a full environment bootstrap, use the cross-platform setup scripts:
  - PowerShell: `./setup.ps1`
  - CachyOS/Linux: `./setup_cachyos.sh`

## Security Notes

- Use strong, unique secrets in your `.env` file.
- Behind HTTPS, ensure `NODE_ENV=production` so cookies are marked `secure`.
- Restrict `ALLOWED_ORIGINS` to the domains that should access the server APIs.
