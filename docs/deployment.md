# Deployment notes

Real-world deployment patterns and gotchas observed during initial production rollouts. Read alongside the main README.

## Two compose patterns

The default `docker-compose.yml` runs a self-contained stack: app + Prowlarr + a dedicated VPN container. If you already operate a VPN gateway container for other services, joining it is cleaner than running a parallel one.

### Pattern A — Self-contained (default)

Use `docker-compose.yml` as shipped. The included `gluetun` service handles VPN egress for the app container. Supply WireGuard or OpenVPN credentials via env.

### Pattern B — Joining an existing VPN gateway

If you already run a gluetun (or compatible) container outside this stack, swap kinema's `app` service to share that container's network namespace and remove the bundled gluetun:

```yaml
services:
  app:
    # ... rest unchanged ...
    network_mode: "container:gluetun"     # name of YOUR existing VPN container
    # No `ports:` block — VPN container publishes :3000 instead.
    # No `depends_on:` on gluetun — it's not in this compose project.

  prowlarr:
    # ... rest unchanged ...
    networks:
      - vpn_shared

networks:
  vpn_shared:
    external: true
    name: <YOUR_VPN_STACK_NETWORK>     # e.g. transmission-vpn_default
```

Two important consequences:

1. **The web UI port (`:3000`) is published by the VPN container, not by `app`.** Add `3000:3000` to the VPN container's `ports:` list.

2. **`PROWLARR_URL` changes.** Because `app` no longer shares a Docker network with prowlarr (it shares the VPN gateway's namespace instead), Docker DNS for `prowlarr` doesn't resolve from `app`. The fix is to attach prowlarr to the VPN gateway's network as an external network (shown above) and reference it by container name: `PROWLARR_URL: 'http://stream-prowlarr:9696'`.

## VPN gateway firewall: LAN bypass

Most VPN gateways (gluetun included) route ALL outbound traffic through the tunnel by default — including LAN traffic. This causes problems when:

- App tries to reach Prowlarr at a host LAN IP (`192.168.x.y:9696`) — the request is routed via VPN and the response can't return.
- Containers on the gateway need to reach other LAN hosts.

Set `FIREWALL_OUTBOUND_SUBNETS` on gluetun to allow direct (non-VPN) traffic to LAN and Docker bridge ranges:

```yaml
    environment:
      - FIREWALL_OUTBOUND_SUBNETS=192.168.0.0/16,10.0.0.0/8,172.16.0.0/12
```

Public internet traffic still goes through the VPN.

## Container restart ordering with `network_mode: container:`

Containers using `network_mode: "container:gluetun"` reference the VPN container by ID at start time. **When the VPN container restarts, it gets a new ID, and any container sharing its namespace breaks** with errors like:

```
joining network namespace of container: No such container: <old-id>
```

Workarounds:

- Recreate the dependent container (don't just restart): `docker rm -f stream-app` then `docker compose up -d` (or hit "Update the stack" in Portainer).
- Restart the VPN container last during planned maintenance.

## Cookie security flag and HTTP-on-LAN

Default `COOKIE_SECURE=false`. This is intentional: most homelab deploys serve over plain HTTP on the LAN, and browsers refuse `Secure` cookies over HTTP, which silently breaks login.

Set `COOKIE_SECURE=true` only when serving over HTTPS (reverse proxy, tunnel, or direct TLS).

## Build context behavior

`docker-compose.yml` uses a git URL as the BuildKit build context (`context: https://github.com/.../#main`). Two implications:

1. **Web Editor in Portainer works** — the compose is self-contained, no GitHub clone step needed at the orchestration layer.

2. **Updates aren't always picked up** — Docker may cache the build by URL. To force a fresh fetch, remove the image first:
   ```bash
   docker rmi -f stream-app:latest
   ```
   Then redeploy. Or use Portainer's "Re-pull image and redeploy" option (only works with `image:`-based services, not `build:`).

## Indexer backend behind anti-bot protection

Some indexer backends sit behind anti-bot challenge providers and reject direct API requests. Prowlarr supports proxying through a challenge solver (FlareSolverr or similar) per-indexer:

1. Add the solver as an Indexer Proxy: Prowlarr → Settings → Indexers → Indexer Proxies.
2. Tag it with a name like `cloudflare`.
3. On each affected indexer, add the same tag. Prowlarr routes requests through the solver.

The solver typically runs as a separate container on a non-VPN network, since it needs to interact with the challenge in the clear.

## P2P traffic and the gateway firewall

If P2P traffic isn't flowing through the VPN tunnel — sessions create directories but never receive bytes — the gateway firewall may be dropping responses. Two diagnostic angles:

1. **DNS works but no peers**: tracker hostnames resolve, but UDP/TCP responses aren't reaching the container. Likely firewall/NAT.

2. **Some VPN providers throttle or block P2P on specific endpoints.** Switch `SERVER_COUNTRIES` to a region that explicitly supports P2P with your provider.

Temporary diagnosis: set `FIREWALL=off` on gluetun. If P2P starts working, the issue is firewall-related; re-enable with explicit allow rules. If it still doesn't work, the issue is upstream.

## React StrictMode and duplicate stream-start requests

In production builds the frontend's React StrictMode is preserved, which causes the stream-start effect to fire twice (and occasionally more on rapid re-render). The backend tolerates this — duplicate sessions are torn down by the cleaner — but it's noisy in logs. Cleanup planned: gate the start effect on a stable session ref.

## Health check expectations

The `app` container's health check hits `/api/health`, which only requires the SQLite DB and Fastify to be up — it does NOT verify VPN connectivity, Prowlarr reachability, or external API keys. A healthy `app` container can still produce 502s on `/api/torrents` if Prowlarr is unreachable. Don't equate "all green" with "everything works"; do an end-to-end search test on first deploy.

## SQLite + WAL mode

The app opens its SQLite DB with `PRAGMA journal_mode=WAL` and `synchronous=NORMAL`. This survives mid-write power loss without losing committed transactions. The DB path is `/data/db.sqlite` inside the container, which is a Docker volume (`app_data`) — survives container recreation.

Backups: `docker exec stream-app node -e "import('./services/db.js').then(m => m.backup('/data/db-backup.sqlite'))"` runs a hot backup. Or simpler: stop the container briefly and copy the volume.
