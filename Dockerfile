# syntax=docker/dockerfile:1.7

# ---- Build stage ----
# Includes Python + g++ + make for native compilation of better-sqlite3.
FROM node:22-bookworm AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --include=dev

COPY . .
RUN npm run build:web && npm run build:server

# Strip dev deps from node_modules for the runtime image.
RUN npm prune --omit=dev

# ---- Runtime stage ----
# Slim image with ffmpeg + Node, no toolchain.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# Required runtime dirs.
RUN mkdir -p /data /data/torrents /data/subtitles && chown -R node:node /data

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/migrations ./migrations

USER node
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "dist/server/index.js"]
