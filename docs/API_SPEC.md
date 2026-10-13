# REST API & WebSocket Technical Specification

Version 1.0 · Base URL `http://localhost:4000` · Machine-readable REST contract: [`openapi.yaml`](openapi.yaml).
`backend/test/spec.test.js` fails if this document, `openapi.yaml` and the implemented routes diverge.

> **Honesty note:** Snowflake is **simulated** (DuckDB, schema `ACCOUNT_USAGE_SIM`). Timestamps are **synthetic** (the CSV has none): one sweep of 100 reports = one day from 2026-09-01.

## 1. Authentication

`POST /api/auth/login` returns a JWT (HS256, `JWT_EXPIRES_IN`, default 8 h) with claims `sub`, `email`, `role`.
Send it as `Authorization: Bearer <token>`. Passwords are bcrypt-hashed. Unknown user, wrong password and disabled account all return the same `401` (no account enumeration).

Seeded demo users (password from `DEMO_PASSWORD`, default `Passw0rd!`): `admin@pureinsights.demo`, `analyst@pureinsights.demo`, `viewer@pureinsights.demo`.

## 2. Roles and permission matrix

| Permission | admin | analyst (Report Owner/Analyst) | viewer |
|---|:-:|:-:|:-:|
| `dashboard:read` (health, reports, orphans, usage, telemetry, replay status) | ✔ | ✔ | ✔ |
| `alerts:read` | ✔ | ✔ | ✔ |
| `alerts:ack` (acknowledge / resolve) | ✔ | ✔ | ✘ |
| `costs:read` | ✔ | ✔ | ✘ |
| `dq:read` (data quality, quarantine) | ✔ | ✔ | ✘ |
| `orphans:assign` | ✔ | ✘ | ✘ |
| `alerts:inject`, `replay:control` | ✔ | ✘ | ✘ |
| `users:manage`, `audit:read` | ✔ | ✘ | ✘ |

Enforced server-side by `authorize(permission)` middleware (`backend/src/middleware/rbac.js`) and mirrored by UI route guards. `backend/test/api.test.js` asserts every role × endpoint outcome (403 for lower roles).

## 3. Error format

Every non-2xx response: `{ "error": { "code": "...", "message": "...", "details": [...]?, "requestId": "uuid" } }`

| HTTP | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | zod validation failed (`details[]` has `path` + `message`), malformed JSON |
| 401 | `UNAUTHORIZED` | missing/invalid/expired token, bad credentials |
| 403 | `FORBIDDEN` | role lacks the permission |
| 404 | `NOT_FOUND` | unknown route or entity |
| 409 | `CONFLICT` | report not orphaned, alert already resolved |
| 500 | `INTERNAL_ERROR` | unexpected (message is generic; details are logged with the same `requestId`) |

## 4. REST endpoints

All responses are `application/json`. "Perm" is the required permission.

| Method + path | Perm | Purpose |
|---|---|---|
| `POST /api/auth/login` | public | Body `{email, password}` → `{token, user}` |
| `GET /api/health` | public | `{status:"ok", simulatedSnowflake:true, uptimeSec}` |
| `GET /api/auth/me` | any role | `{user:{id,email,role}}` |
| `GET /api/overview` | `dashboard:read` | KPIs + per-sweep latency/refresh trend |
| `GET /api/reports` | `dashboard:read` | Latest snapshot per report, with orphan flag |
| `GET /api/reports/{id}` | `dashboard:read` | Report history across 20 sweeps + cost row. `id` = `RPT_\d+` |
| `GET /api/orphans` | `dashboard:read` | `orphanedNow[]`, `chronic[]` (orphan in ≥2 of last 5 sweeps), `assigned[]`, `rowLevelOrphanRate` |
| `POST /api/orphans/{reportId}/assign` | `orphans:assign` | Body `{ownerEmail}` → `201`; `409` if not currently orphaned |
| `GET /api/usage` | `dashboard:read` | Latest-sweep totals, top reports by views, zero-view snapshots |
| `GET /api/costs` | `costs:read` | Per-report credits, cost, `unit_cost_per_view_usd`; query `price` (USD per credit) |
| `GET /api/costs/summary` | `costs:read` | Fleet unit cost, top spenders, credit buckets, reconciliation checks, proxy control, method sensitivity, users-vs-AWS |
| `GET /api/data-quality` | `dq:read` | The four defects: rule, affectedRows, treatment, rationale, before/after |
| `GET /api/quarantine` | `dq:read` | Quarantined negative-credit rows with raw values |
| `GET /api/alerts` | `alerts:read` | Query `severity`, `status`, `rule`, `limit` (≤500, default 100), `offset` → `{items,total}` |
| `POST /api/alerts/inject` | `alerts:inject` | Body `{reportId, latencySec?, refreshStatus?}` (one required) → `201 {published[]}` |
| `POST /api/alerts/{id}/ack` | `alerts:ack` | Sets status `acknowledged` |
| `POST /api/alerts/{id}/resolve` | `alerts:ack` | Sets status `resolved` (`409` if already resolved) |
| `GET /api/telemetry` | `dashboard:read` | `{connections, replay, alertCounts, ingestion}` |
| `GET /api/replay` | `dashboard:read` | `{state, sweep, totalSweeps, tickMs, emitted}` |
| `POST /api/replay/start` | `replay:control` | Start streaming sweeps |
| `POST /api/replay/pause` | `replay:control` | Pause |
| `POST /api/replay/reset` | `replay:control` | Rewind to sweep 0 and clear alert history |
| `GET /api/users` | `users:manage` | List users (no password hashes) |
| `PATCH /api/users/{id}` | `users:manage` | Body `{role?, active?}` |
| `GET /api/audit` | `audit:read` | Audit log (newest first) |

### Examples

```http
POST /api/auth/login
{"email":"admin@pureinsights.demo","password":"Passw0rd!"}

200 {"token":"eyJ...","user":{"id":"U-1","email":"admin@pureinsights.demo","name":"Ada Admin","role":"admin"}}
```

```http
GET /api/costs/summary?price=3   (Authorization: Bearer <analyst token>)

200 {"creditPriceUsd":3,"fleet":{"snowflakeCostUsd":3619057.44,"activeViews":1486905,"unitCostPerViewUsd":2.434},
     "creditBuckets":[{"bucket":"metered_total","credits":1206191.44},{"bucket":"attributed","credits":1206352.48},
                      {"bucket":"unattributed_idle","credits":0},{"bucket":"excluded_negative","credits":-161.04}],
     "reconciliation":[{"check_name":"credits: attributed + idle + excluded = metered","passed":true}, "..."], "...": "..."}
```

```http
GET /api/costs      (Authorization: Bearer <viewer token>)
403 {"error":{"code":"FORBIDDEN","message":"Requires permission costs:read","requestId":"..."}}
```

```http
POST /api/alerts/inject   (admin)   {"reportId":"RPT_210","latencySec":16.5}
201 {"published":[{"id":"ALT-1","rule":"LATENCY_GT_15S","severity":"WARN","value":16.5,"threshold":15,"incidentState":"open","source":"inject","toast":true}]}
```

## 5. Alert rules and lifecycle

| Rule | Fires when | Severity |
|---|---|---|
| `LATENCY_GT_15S` | `avg_load_time_sec` **strictly >** `LATENCY_WARN_SEC` (15) | `WARN` (15,30] · `HIGH` (30,45] · `CRIT` >45 (env `LATENCY_HIGH_SEC`, `LATENCY_CRIT_SEC`) |
| `REFRESH_FAILED` | status `FAILED` or `TIMED_OUT` (`UNKNOWN` is *not* a failure) | `WARN` for FAILED, `HIGH` for TIMED_OUT |

* **Every** exceedance/failure is emitted live (the brief says "whenever"). Noise handling is downstream, never by dropping events:
  * **Incident grouping** (`incidentState`): `open` (first exceedance), `escalated` (severity rose), `repeat` (still breaching). Only `open`/`escalated` are **persisted** in history (`GET /api/alerts`) → de-duplicated storage.
  * **Toast rate limit** (`toast:true`): CRIT latency or any refresh failure, at most once per report per `TOAST_COOLDOWN_SWEEPS` (3) sweeps.
  * **Per-client filter** via `subscribe` (min severity, rules).
* Status lifecycle of a stored alert: `open → acknowledged → resolved` (`POST /api/alerts/{id}/ack|resolve`).
* Measured on the full CSV: 2,054 firings (1,490 latency + 564 refresh) → 1,203 stored incidents → 382 default toasts (asserted in `domain.test.js`).

## 6. WebSocket specification

**URL:** `ws://localhost:4000/ws?token=<JWT>` (alternative: `Sec-WebSocket-Protocol: bearer.<JWT>`).
**Handshake auth:** the JWT is verified during the HTTP upgrade. Missing/invalid/expired → the server replies `HTTP/1.1 401 Unauthorized` and never opens the socket.

**Envelope (server → client):** `{ "type": "<type>", "seq": 17, "ts": "2026-10-10T10:00:00.000Z", "data": { ... } }` — `seq` is strictly increasing per server process (clients may use it to detect gaps/duplicates).
**Client → server:** `{ "type": "<type>", "data": { ... } }`.

### Channels (role-aware)

| Channel | Message types | Required permission |
|---|---|---|
| `alerts` | `alert` | `alerts:read` (all roles) |
| `ops` | `replay_status`, `telemetry` | `costs:read` (admin, analyst) |
| `admin` | reserved | `audit:read` (admin) |
| direct | `hello`, `subscribed`, `pong`, `heartbeat`, `incident_update`, `error` | — |

### Server → client messages

| `type` | Payload `data` | Example |
|---|---|---|
| `hello` | `{user, heartbeatMs, channels[]}` | `{"user":{"id":"U-3","email":"viewer@pureinsights.demo","role":"viewer"},"heartbeatMs":15000,"channels":["alerts"]}` |
| `alert` | see below | |
| `incident_update` | `{id, status, by}` after an ack/resolve | `{"id":"ALT-12","status":"acknowledged","by":"analyst@pureinsights.demo"}` |
| `telemetry` | `{sweep, emitted:{firings,persisted,toasts}, connections}` (ops channel) | |
| `replay_status` | `{state:"running|paused|finished", sweep, totalSweeps, tickMs, emitted}` (ops channel) | |
| `heartbeat` | `{connections}` every `WS_HEARTBEAT_MS` | |
| `subscribed` | echo of the active filter | `{"minSeverity":"CRIT","rules":null}` |
| `pong` | `{}` reply to `ping` | |
| `error` | `{code, message}` | `{"code":"FORBIDDEN","message":"Role cannot acknowledge alerts"}` |

**`alert` payload:** `id` (string|null, null when not persisted), `sweep` (int), `syntheticTs`, `reportId`, `rule` (`LATENCY_GT_15S`|`REFRESH_FAILED`), `severity` (`WARN|HIGH|CRIT`), `value` (seconds or status), `threshold`, `incidentId`, `incidentState` (`open|escalated|repeat`), `dedupeKey` (`<reportId>:<rule>`), `persisted` (bool), `toast` (bool), `source` (`replay|inject`).

```json
{"type":"alert","seq":42,"ts":"2026-10-10T10:00:01.120Z","data":{"id":"ALT-7","sweep":0,"syntheticTs":"2026-09-01T00:00:00.000Z","reportId":"RPT_200","rule":"LATENCY_GT_15S","severity":"HIGH","value":44.8,"threshold":15,"incidentId":"INC-1","incidentState":"open","dedupeKey":"RPT_200:LATENCY_GT_15S","persisted":true,"toast":false,"source":"replay"}}
```

### Client → server messages

| `type` | Payload | Notes |
|---|---|---|
| `subscribe` | `{minSeverity?: "WARN"|"HIGH"|"CRIT", rules?: string[]|null}` | Default `WARN`, all rules. Server answers `subscribed`. |
| `ack` | `{alertId}` | Needs `alerts:ack`; otherwise `error FORBIDDEN`. Unknown id → `error NOT_FOUND`. Success → `incident_update` broadcast. |
| `ping` | `{}` | Server answers `pong`. |

### Heartbeat and reconnect

* Server sends a protocol-level `ping` **and** an application `heartbeat` message every `WS_HEARTBEAT_MS`. A client that has not answered the previous ping with `pong` is closed with code **4408**.
* The reference client (`frontend/src/hooks/useAlertSocket.js`) reconnects automatically with exponential backoff (1 s → 2 s → … capped at 15 s, with jitter) and shows a live connection-status badge. After reconnect it refetches `GET /api/alerts` to fill the gap (alerts are persisted, so history is the recovery path).

### Close / error codes

| Code | Meaning |
|---|---|
| HTTP 401 at upgrade | missing/invalid/expired JWT |
| WS close 4408 | heartbeat timeout |
| `error.code` `BAD_MESSAGE` | not JSON or unknown `type` |
| `error.code` `FORBIDDEN` | role lacks permission for the action |
| `error.code` `NOT_FOUND` | unknown alert id |

### Delivery guarantees (honest limits)

At-most-once live delivery per connection; no server-side buffering for offline clients. Recovery = `GET /api/alerts`. Single process, no horizontal fan-out (see `docs/DECISIONS.md`).
