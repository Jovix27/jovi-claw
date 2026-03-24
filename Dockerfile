# ─── Railway Optimized Dockerfile ─────────────────────────────────────────────
FROM node:20

# Install Chromium and dependencies for Puppeteer/WhatsApp
RUN apt-get update && apt-get install -y \
    chromium \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libasound2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm-dev \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./

# Install deps
RUN npm ci --ignore-scripts

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/

# Use the Railway-specific MCP config
COPY mcp_config.railway.json ./mcp_config.json

# Explicitly expose the port for Railway
EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

# Start the bot and relay server
CMD ["node", "--import", "tsx", "src/index.ts"]
