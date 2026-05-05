# Changelog

## Unreleased

### Documentation

- New [docs/deployment.md](./docs/deployment.md) covering real-world deployment
  patterns observed during initial production rollouts, including:
  - Self-contained vs joining-existing-VPN-gateway compose patterns
  - LAN bypass via `FIREWALL_OUTBOUND_SUBNETS` for VPN gateways
  - Container restart ordering with `network_mode: container:`
  - `COOKIE_SECURE` and HTTP-on-LAN behavior
  - Build cache invalidation tricks for Portainer
  - Anti-bot indexer proxies (Prowlarr + challenge solver)
  - Diagnostic steps when P2P traffic doesn't flow through the gateway
  - Health check scope (does NOT cover upstream reachability)

## v0.1 — Initial release

### Backend

- Node.js 22 + Fastify HTTP server.
- SQLite via `better-sqlite3` with WAL mode for power-loss durability.
- Profile-scoped session cookies via `@fastify/secure-session`.
- Login rate limiting (5 attempts / 15 min per IP).
- TMDB metadata client with rate limiting and retry-on-429.
- Prowlarr API client.
- Subtitle provider abstraction (OpenSubtitles + Subdl) with disk caching
  keyed on TMDB ID + season + episode + language.
- WebTorrent-based streaming engine with sequential head-of-file priority.
- ffmpeg transcoder with a 6-pipeline decision matrix
  (direct / remux / audio-only / subs-convert / burn-in / full transcode).
- Concurrency-limited transcode queue.
- Stall detector that prompts the user instead of auto-switching sources.
- Session cleaner with heartbeat-based zombie reaping.
- Graceful shutdown handlers (SIGTERM, SIGINT, uncaughtException,
  unhandledRejection) with bounded teardown deadline.

### Frontend

- React 18 + Vite + Tailwind CSS 3.
- Editorial dark-cinematic theme.
- Full route tree: login, profile picker, home, search, movie/show detail,
  player, settings.
- Source picker modal with quality/codec/seeders chips.
- HTML5 video player with hls.js fallback for HLS.
- Tab-close cleanup via `navigator.sendBeacon` to a POST teardown endpoint.

### Operability

- Docker Compose stack: app + Prowlarr.
- Multi-stage Dockerfile (build deps separated from runtime).
- Health checks for both containers; `depends_on` ordering.
- Configurable host port bindings to avoid collisions.

### Tests

- 67 tests across 6 files: range parser, torrent ranker, transcoder
  decision matrix, subtitle cache key, Subdl zip extraction, integration
  tests for auth + profiles via `app.inject()`.
