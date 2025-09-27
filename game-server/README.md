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

## Installation

1.  Open a terminal or command prompt and navigate to the `game-server` root directory.
2.  Run the following command to install the necessary dependencies:
    ```
    npm install
    ```
3.  **CachyOS users:** run `./install_cachyos.sh` to automatically install Node.js (if needed) and install the project dependencies.

## Running the Server

1.  Once the installation is complete, run the following command to start the server:
    ```
    npm start
    ```
    - CachyOS users can alternatively run `./run_cachyos.sh` to verify dependencies and launch the server automatically.
2.  The server will now be running. You can access the game hub by opening a web browser and going to `http://[SERVER-IP-ADDRESS]:8081`. You can find your server's local IP address in your network settings. If you are on the server machine itself, you can use `http://localhost:8081`.

## Windows Shortcut

- Windows users can double-click `run_windows.bat` to check for Node.js, install dependencies, and start the server automatically.
