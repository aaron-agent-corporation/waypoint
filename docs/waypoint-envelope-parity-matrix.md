# Waypoint API envelope parity matrix

Established error contract for Waypoint surfaces:

```json
{ "ok": false, "action": "error", "error": "...", "details": "optional" }
```

Success envelopes remain endpoint-specific.

Validation failures that include `details` are normalized to an array of `{ code, path, message }` (with `path` as dotted string or `$` for root).

| Surface | Path / Alias | Success envelope | Error envelope behavior | Key failure modes |
|---|---|---|---|---|
| Waypoint status | `GET /api/projects/:id/waypoint/status` | `{ ok:true, action:'status', status, summary }` | Standard `{ ok:false, action:'error', error }` | invalid project id (400), project missing (404), lifecycle disabled (409), forbidden (403), internal (500) |
| Waypoint command runtime | `POST /api/projects/:id/waypoint/command` (command aliases: `/waypoint ...`, `/wp ...`) | Command-specific payload from `executeWaypointCommand(...)` | Normalized to standard contract; parse/context metadata now emitted under optional `details` | invalid body / malformed json (400 + `details` issues), invalid command parse (400), route/plan not found (400/404), lifecycle disabled (409), forbidden (403), internal (500) |
| Waypoint autopilot | `GET|POST /api/projects/:id/waypoint/autopilot` | `GET`: `{ ok:true, action:'autopilot_status', ... }`; `POST`: `{ ok:true, action:'autopilot', ... }` | Standard contract, with validation details where applicable; mutation 429s are normalized to `{ ok:false, action:'error', error }` | invalid pagination/body (400), rate limited (429), missing project (404), lifecycle disabled (409), forbidden (403), internal (500) |
| Route list/start | `GET|POST /api/projects/:id/waypoint/routes` | `GET`: `{ ok:true, action:'list_routes', ... }`; `POST`: `{ ok:true, action:'start_route', ... }` | Standard contract, optional validation details; POST rate-limit 429 normalized | invalid query/body (400), rate limited (429), missing project (404), lifecycle disabled (409), forbidden (403), internal (500) |
| Route detail | `GET /api/projects/:id/waypoint/routes/:routeId` | `{ ok:true, action:'get_route', ... }` | Standard contract | invalid ids (400), missing project/route (404), lifecycle disabled (409), forbidden (403), internal (500) |
| Route events | `GET /api/projects/:id/waypoint/routes/:routeId/events` | `{ ok:true, action:'list_route_events', ... }` | Standard contract, optional validation details | invalid ids/query (400), missing project/route (404), lifecycle disabled (409), forbidden (403), internal (500) |
| Route gate decision | `POST /api/projects/:id/waypoint/routes/:routeId/gate` | `{ ok:true, action:'approve_gate'|'reject_gate', ... }` | Standard contract, optional validation details; rate-limit 429 normalized | invalid ids/body (400), rate limited (429), missing project/route/node (404), lifecycle disabled (409), forbidden (403), internal (500) |
| Route paused state | `POST /api/projects/:id/waypoint/routes/:routeId/state` | `{ ok:true, action:'pause_route'|'resume_route', ... }` | Standard contract, optional validation details; rate-limit 429 normalized | invalid ids/body (400), rate limited (429), missing project/route (404), lifecycle disabled (409), forbidden (403), internal (500) |
| Task discussion (Waypoint-adjacent) | `GET /api/tasks/:id/discussion`, `POST /api/tasks/:id/discussion/start`, `POST /api/tasks/:id/discussion/messages` | endpoint-specific (`list_discussion`, `start_discussion`, `post_discussion_message`) | Standard contract; validation failures on start/messages return normalized `details` (`{ code, path, message }`); mutation rate-limit 429s normalized on start/messages | invalid/non-positive task id (400), malformed/invalid body (400 + `details` for schema issues), rate limited (429), task missing (404), discussion not enabled (409), internal (500) |

## Command alias -> typed endpoint parity map

Equivalent command and typed endpoint surfaces are contract-locked to the same error envelope semantics (`{ ok:false, action:'error', error, details? }`).

| Command alias | Typed endpoint |
|---|---|
| `/waypoint auto` | `POST /api/projects/:id/waypoint/autopilot` |
| `/waypoint auto status` | `GET /api/projects/:id/waypoint/autopilot` |
| `/waypoint routes ...` | `GET /api/projects/:id/waypoint/routes` |
| `/waypoint start plan ...`, `/waypoint doctor ...`, `/waypoint forensics ...` | `POST /api/projects/:id/waypoint/routes` |
| `/waypoint route --route-id <id>` | `GET /api/projects/:id/waypoint/routes/:routeId` |
| `/waypoint route-events --route-id <id>` | `GET /api/projects/:id/waypoint/routes/:routeId/events` |
| `/waypoint pause --route-id <id>`, `/waypoint resume --route-id <id>` | `POST /api/projects/:id/waypoint/routes/:routeId/state` |
| `/waypoint gate --route-id <id> --node <node_key> (--approve|--reject)` | `POST /api/projects/:id/waypoint/routes/:routeId/gate` |
| `/waypoint discuss --task-id <id> [--message <text>]` | `POST /api/tasks/:id/discussion/start` then optional `POST /api/tasks/:id/discussion/messages` and `GET /api/tasks/:id/discussion` |
