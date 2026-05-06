# Waypoint Operations Runbook

## Purpose

Operational guide for running Waypoint safely in Mission Control.

## Safety Defaults

- Discussion auto-response is **OFF by default**.
- Auto-response request emission requires:
  1. task metadata opt-in: `waypoint.discussion.auto_response.enabled: true`
  2. global env opt-in: `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED=1|true|yes|on`
- If not requested, API returns `auto_response.requested=false` with reason:
  - `metadata_disabled`
  - `global_disabled`
  - `missing_agent`

## Waypoint Command Surface

- `/waypoint status`
- `/waypoint start plan --plan-id <id> [--definition <slug>] [--version <n>]`
- `/waypoint routes [--status ...] [--limit N] [--offset N]`
- `/waypoint route --route-id <id>`
- `/waypoint route-events --route-id <id> [--limit N] [--offset N]`
- `/waypoint pause --route-id <id>`
- `/waypoint resume --route-id <id>`
- `/waypoint gate --route-id <id> --node <key> (--approve|--reject) [--note <text>]`
- `/waypoint auto [--max-iterations N]`
- `/waypoint auto status [--limit N] [--offset N]`
- `/waypoint doctor [--definition waypoint-doctor] [--version 1]`
- `/waypoint forensics [--definition waypoint-forensics] [--version 1]`
- `/waypoint discuss --task-id <id> [--message <text>]`

## Typed API Surface

- `GET /api/projects/:id/waypoint/status`
- `POST /api/projects/:id/waypoint/command`
- `GET|POST /api/projects/:id/waypoint/routes`
- `GET /api/projects/:id/waypoint/routes/:routeId`
- `GET /api/projects/:id/waypoint/routes/:routeId/events`
- `POST /api/projects/:id/waypoint/routes/:routeId/state`
- `POST /api/projects/:id/waypoint/routes/:routeId/gate`
- `GET|POST /api/projects/:id/waypoint/autopilot`
- `GET /api/tasks/:id/discussion`
- `POST /api/tasks/:id/discussion/start`
- `POST /api/tasks/:id/discussion/messages`

## Error Contract

Waypoint error envelope is standardized:

```json
{ "ok": false, "action": "error", "error": "...", "details": "optional" }
```

Validation `details` are normalized to:

```json
[{ "code": "...", "path": "field.or.$", "message": "..." }]
```

## Smoke Test Checklist

1. **Status**: project with Waypoint enabled returns `ok:true`.
2. **Command parse fail**: malformed command body returns `400` standardized envelope.
3. **Routes list/query validation**: invalid `limit` returns normalized validation details.
4. **Gate mutation rate limit**: 429 returns normalized envelope.
5. **Discussion start/post**: strict body validation and standardized error envelopes.
6. **Auto-response OFF default**: message post returns `requested:false` with reason.
7. **Auto-response ON gated**: with metadata + env opt-in, request event is emitted.

## Rollback Notes

- Disable discussion auto-response immediately by unsetting:
  - `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED`
- Leave endpoint behavior intact; this only suppresses auto-response request events.
- If needed, rollback to previous commit on `feat/waypoint-runtime-slice` after verifying migration-free diff.

## Verification Commands

```bash
pnpm exec vitest run \
  src/app/api/projects/[id]/waypoint/command/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/routes/[routeId]/events/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/routes/[routeId]/gate/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/routes/[routeId]/state/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/autopilot/__tests__/route.test.ts \
  src/app/api/tasks/[id]/discussion/__tests__/route.test.ts \
  src/app/api/tasks/[id]/discussion/start/__tests__/route.test.ts \
  src/app/api/tasks/[id]/discussion/messages/__tests__/route.test.ts \
  src/lib/__tests__/waypoint-task-discussion.test.ts

pnpm typecheck
pnpm lint
```
