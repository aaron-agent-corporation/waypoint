# @waypoint/ui

Browser web UI for Waypoint — observability + agent chat against a running
engine host. Web-first; the desktop Tauri shell is a later slice.

## Dev

1. Start an engine host that writes a handshake file:

   ```bash
   WAYPOINT_ENGINE_HANDSHAKE=/tmp/waypoint-handshake.json \
   WAYPOINT_ENGINE_ROOT=/path/to/project \
   node packages/waypoint-engine-host/src/bin.ts
   ```

2. Point the UI dev proxy at the same handshake and start Vite:

   ```bash
   WAYPOINT_ENGINE_HANDSHAKE=/tmp/waypoint-handshake.json pnpm dev:ui
   ```

The Vite dev proxy reads the handshake, forwards `/cmd` + `/ws` to the engine,
and injects the bearer token server-side — the browser never sees the token.

## Layout

Three-pane console: routes + agent sessions (left), route DAG + task detail
(center), agent chat (right).

## Test

```bash
pnpm test:ui          # component + integration tests (jsdom)
pnpm typecheck:ui
pnpm smoke:ui         # headless data-layer smoke against a real engine host
```
