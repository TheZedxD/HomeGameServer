# HomeGameServer - Secure, Server-Authoritative Game Server

A production-ready, self-hosted multiplayer game server with server-authoritative state management, real-time synchronization, and comprehensive observability.

## 🚀 New: Server-Authoritative Architecture

HomeGameServer now features a fully server-authoritative game engine designed for competitive, cheat-resistant gameplay:

- **⚡ High-Performance Tick Loop** - 20-30 Hz server tick rate with p95 latency < 10ms under 200 concurrent clients
- **🔒 Server Authority** - All game logic runs server-side; clients receive validated state updates only
- **🎯 Deterministic RNG** - Seeded random generation for reproducible game sessions and fair play
- **📊 State Machines** - Formal FSM for rooms and players with validated state transitions
- **✅ Schema Validation** - Zod-based message validation for all Socket.IO events with versioning support
- **🔄 Delta & Snapshot Sync** - Efficient delta updates every tick + periodic full snapshots for reconciliation
- **🛡️ Replay Protection** - Sequence number tracking prevents duplicate/out-of-order inputs
- **📡 Latency Measurement** - Built-in ping/pong for real-time latency monitoring
- **📈 Production Observability** - Prometheus metrics, structured logging with Pino, health checks
- **🐳 Docker Ready** - Multi-stage optimized builds with non-root user and health checks

## Features

### Core Gameplay
- 🎮 **Multiple Game Types** - Board games, card games, and casino games with betting
- 🧑‍🤝‍🧑 **Multiplayer Support** - 1-9 players depending on game type
- 📊 **Live Score Tracking** - Real-time updates after every round
- 🎰 **Casino System** - Full betting mechanics with balance tracking across games
- 🃏 **Card Game Engine** - Shared utilities for deck management and hand evaluation
- 🗳️ **Post-Game Voting** - Players vote to play again or return to lobby (majority rules)
- 🎨 **Themed UI** - Consistent visual style with card symbols (♥ ♦ ♣ ♠) and casino emojis
- 🖥️ **Responsive Lobby** - Player readiness indicators and host controls

### Security & Infrastructure
- 💾 **Profile System** - Persistent player accounts with avatar support
- 🔐 **Authentication** - Short-lived JWT access tokens + refresh tokens, session management
- 🛡️ **Rate Limiting** - Per-socket, per-IP, and per-endpoint rate limits with burst support
- 🔒 **Input Sanitization** - All user inputs validated and sanitized
- 🚨 **CSP & Security Headers** - Content Security Policy and comprehensive security headers
- 📝 **Structured Logging** - Pino-based JSON logs with contextual metadata (roomId, playerId, etc.)
- 📊 **Metrics & Monitoring** - Prometheus-compatible /metrics endpoint with histograms and counters

## Games

### Board Games
- **Checkers** (2 players) - Classic strategy game with best-of-three series
- **Tic-Tac-Toe** (2 players) - Quick 3×3 matches

### Card Games
- **War** (2 players) - Simple highest-card-wins game
- **Hearts** (4 players) - Trick-taking game, avoid hearts and the Queen of Spades

### Casino Games 🎰
All casino games feature:
- Betting system with configurable chip amounts (10-1000 chips)
- Balance tracking across games
- Professional casino UI with green felt theme
- Start/end animations with winner displays
- Post-game voting system

**Available Casino Games:**
- **Blackjack** (1-7 players) - Beat the dealer, get closest to 21
  - Hit, Stand, Double actions
  - 6-deck shoe with automatic dealer play
  - Natural blackjack pays 3:2

- **Texas Hold'em** (2-9 players) - Classic poker with community cards
  - Pre-flop, Flop, Turn, River betting rounds
  - Call, Raise, Check, Fold, All-in actions
  - Best 5-card hand from 7 cards wins

- **5 Card Stud** (2-8 players) - Classic stud poker with visible cards
  - 1 hole card + 4 face-up cards
  - 5 streets of betting (First, Third, Fourth, Fifth, Showdown)
  - Highest visible card acts first each round

- **Baccarat** (1-8 players) - Player vs Banker betting
  - Bet on Player (1:1), Banker (0.95:1), or Tie (8:1)
  - Automatic third-card rules
  - Hand values calculated modulo 10

## Setup

### Platform prerequisites

This project targets modern Long-Term Support releases of Node.js (18 or newer) and uses the Sharp image library, which requires native build tooling. Prepare your environment before installing dependencies:

- **Linux (Debian/Ubuntu):**
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
  3. Install Sharp prerequisites before running `npm ci`:
     ```bash
     sudo apt-get update
     sudo apt-get install -y build-essential libvips
     ```
- **Arch/CachyOS:**
  - Ensure base tooling and Sharp dependencies are installed:
    ```bash
    sudo pacman -S --needed base-devel libvips
    ```
  - Install Node.js 18+ with pacman or run `./install_cachyos.sh` / `./setup_cachyos.sh` for an automated setup.
- **Windows:**
  - Install Node 18+ using [nvm-windows](https://github.com/coreybutler/nvm-windows) or via Chocolatey:
    ```powershell
    choco install nodejs-lts
    ```
  - Install native build tools required by Sharp:
    - Use the [Windows Build Tools](https://github.com/felixrieseberg/windows-build-tools), or
    - Install the "Desktop development with C++" workload from the Visual Studio Build Tools installer.

### Environment configuration

1. Copy the example environment file before starting the server:
    ```bash
    cp .env.example .env
    ```
2. Open `.env` and replace every placeholder with strong, unique secrets for:
    - `SESSION_SECRET`
    - `JWT_SECRET`
    - `GUEST_SESSION_SECRET`
    - `ALLOWED_ORIGINS` (comma-separated list of allowed browser origins)
3. For production deployments behind HTTPS, set `NODE_ENV=production` to ensure secure cookies are enforced.

### Clone the repository

1.  **Clone Repository:** Download or clone this repository to your machine.

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
3. Create or update the `.env` file as described in the [Environment configuration](#environment-configuration) section before starting the server.

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

## Docker Deployment

### Quick Start with Docker Compose

The easiest way to deploy HomeGameServer in production:

```bash
# 1. Configure environment variables
cp .env.example .env
# Edit .env and add your secrets

# 2. Start the server
docker-compose up -d

# 3. Check health
curl http://localhost:8081/healthz

# 4. View logs
docker-compose logs -f game-server

# 5. Stop the server
docker-compose down
```

### Building the Docker Image

```bash
# Build the production image
docker build -t homegameserver:latest .

# Run with environment variables
docker run -d \
  --name homegameserver \
  -p 8081:8081 \
  --env-file .env \
  -v ./data:/app/data \
  -v ./logs:/app/logs \
  homegameserver:latest
```

### With Redis (Optional)

Enable Redis for caching and pub/sub:

```bash
# Start with Redis profile
docker-compose --profile with-redis up -d

# Set REDIS_URL in .env
REDIS_URL=redis://redis:6379
ENABLE_REDIS_CACHE=true
```

## Configuration

HomeGameServer uses a comprehensive configuration system with strict validation.

### Required Secrets

Generate strong secrets for production:

```bash
# Generate 32-byte base64 secrets
openssl rand -base64 32

# Required in .env:
SESSION_SECRET=<generated-secret>
JWT_SECRET=<generated-secret>
JWT_REFRESH_SECRET=<generated-secret>
GUEST_SESSION_SECRET=<generated-secret>
CSRF_SECRET=<generated-secret>
```

### Key Configuration Options

See `.env.example` for all available options. Key settings:

**Server:**
- `PORT` - Server port (default: 8081)
- `ORIGIN_WHITELIST` - Comma-separated CORS origins
- `NODE_ENV` - Environment: development, production, test

**Game Server:**
- `TICK_RATE` - Server tick rate in Hz (default: 30, range: 20-60)
- `SNAPSHOT_RATE` - Snapshot broadcast rate in Hz (default: 10)
- `DETERMINISTIC_RNG` - Enable reproducible randomness (default: true)

**Security:**
- `JWT_ACCESS_TOKEN_EXPIRY` - Access token lifetime (default: 15m)
- `JWT_REFRESH_TOKEN_EXPIRY` - Refresh token lifetime (default: 7d)
- `ENABLE_SEQUENCE_VALIDATION` - Enable replay protection (default: true)
- `MAX_SEQUENCE_DRIFT` - Allowed sequence number drift (default: 100)

**Rate Limiting:**
- `RATE_LIMIT_WRITE_MAX` - HTTP writes/min per IP (default: 300)
- `SOCKET_EVENT_RATE_LIMIT` - Socket events/sec (default: 80)
- `SOCKET_CONNECTION_RATE_LIMIT` - Connections/min per IP (default: 120)

**Rooms:**
- `MAX_PLAYERS_PER_ROOM` - Maximum players (default: 8)
- `ROOM_IDLE_TIMEOUT_MS` - Idle timeout in ms (default: 30 minutes)
- `MAX_ROOMS` - Maximum concurrent rooms (default: 100)

**Logging:**
- `LOG_LEVEL` - Logging level: trace, debug, info, warn, error, fatal
- `LOG_PRETTY` - Pretty print logs (default: true in dev)
- `LOG_DIR` - Log directory path (optional)

## Monitoring & Observability

### Health Checks

```bash
# Basic health check (fast, no auth)
curl http://localhost:8081/healthz

# Detailed health with component status
curl http://localhost:8081/health
```

### Metrics

Access Prometheus-compatible metrics (requires `METRICS_TOKEN` in production):

```bash
# Set token in .env
METRICS_TOKEN=your-secure-token-here

# Fetch metrics
curl -H "Authorization: Bearer your-secure-token-here" \
  http://localhost:8081/metrics
```

**Key Metrics:**
- `tick_duration_ms` - Tick loop performance (histogram)
- `rooms_active` - Current active rooms (gauge)
- `players_active` - Current active players (gauge)
- `game_moves_total` - Total game actions processed (counter)
- `socket_connections_total` - Total WebSocket connections (counter)
- `rate_limit_hits_total` - Rate limit violations (counter)
- `http_request_duration_ms` - HTTP request latency (histogram)

### Structured Logging

Logs are output in JSON format (production) or pretty-printed (development) using Pino:

```json
{
  "level": 30,
  "time": "2025-10-29T17:30:00.000Z",
  "pid": 1234,
  "hostname": "game-server",
  "module": "TickManager",
  "tick": 15234,
  "avgDuration": 3.42,
  "p95": 5.12,
  "msg": "Tick metrics"
}
```

Enable contextual logging with roomId/playerId for debugging.

## Testing

### Run All Tests

```bash
# Unit + Integration tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage report
npm run test:unit -- --coverage
```

### Load Testing

```bash
# Run Artillery load test (200 virtual clients)
npm run test:load

# Run fuzz tests
npm run test:fuzz
```

### CI/CD

GitHub Actions workflow automatically runs on push/PR:
- Linting and security audit
- Unit and integration tests
- Docker image build and security scan
- Load testing (main branch only)

## API Documentation

See [docs/API.md](../docs/API.md) for comprehensive API documentation including:
- Socket.IO event schemas
- REST endpoints
- Error codes
- Rate limits
- Examples

## Performance Targets

- **Tick Rate:** 20-30 Hz
- **Tick Duration p95:** < 10ms under 200 clients
- **Latency:** < 100ms within local network
- **Memory:** Stable under continuous load
- **CPU:** < 50% under 200 concurrent players

## Troubleshooting

### Server won't start

1. Check that required secrets are set in `.env`
2. Ensure port 8081 is not already in use: `lsof -i :8081`
3. Check logs: `docker-compose logs` or view console output

### High tick duration warnings

If you see "Slow tick detected" warnings:

1. Reduce `TICK_RATE` (e.g., from 30 to 20 Hz)
2. Check system resources (CPU, memory)
3. Review metrics: `curl http://localhost:8081/metrics`
4. Enable `DEBUG=true` for verbose logging

### Health check failing

```bash
# Check server logs
docker-compose logs game-server

# Manual health check with details
curl -v http://localhost:8081/health

# Check memory usage
docker stats homegameserver
```

## Maintenance

- Run the helper script to audit and patch dependencies automatically:
  ```bash
  ./update_dependencies.sh
  ```
  The script executes `npm audit` followed by `npm audit fix`, exiting with a non-zero status if fixes require manual follow-up.

## Security Notes

- Use strong, unique secrets in your `.env` file (32+ characters minimum)
- Behind HTTPS, ensure `NODE_ENV=production` so cookies are marked `secure`
- Restrict `ORIGIN_WHITELIST` to only the domains that should access the server
- Set `METRICS_TOKEN` to protect the metrics endpoint in production
- Enable `ENABLE_SEQUENCE_VALIDATION=true` for replay protection
- Use short-lived access tokens (`JWT_ACCESS_TOKEN_EXPIRY=15m`)
- Regularly update dependencies: `npm audit fix`
- Review security headers in `src/security/headers.js`
- Monitor rate limit hits in metrics: `rate_limit_hits_total`

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes with tests
4. Run `npm test` to ensure tests pass
5. Submit a pull request

## License

See LICENSE file for details.
