# =============================================================================
# HomeGameServer Dockerfile
# =============================================================================
# Multi-stage build for optimal image size and security
#
# Features:
# - Alpine Linux base for minimal size
# - Non-root user for security
# - Tini for proper signal handling
# - Health check endpoint
# - Production optimizations

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS dependencies

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 2: Build (if needed)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci --ignore-scripts && \
    npm cache clean --force

# Copy source code
COPY . .

# Run any build steps if needed
# RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: Production
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Install tini for proper PID 1 behavior and signal handling
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

WORKDIR /app

# Copy dependencies from dependencies stage
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create necessary directories with correct permissions
RUN mkdir -p data logs .sessions && \
    chown -R nodejs:nodejs data logs .sessions

# Environment variables (can be overridden)
ENV NODE_ENV=production \
    PORT=8081 \
    LOG_LEVEL=info

# Expose port
EXPOSE 8081

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8081/healthz', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start application
CMD ["node", "server.js"]

# Labels for metadata
LABEL org.opencontainers.image.title="HomeGameServer" \
      org.opencontainers.image.description="Secure, server-authoritative game server" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.vendor="HomeGameServer" \
      org.opencontainers.image.authors="HomeGameServer Team"
