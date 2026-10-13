# Decisions, assumptions, conflicts, limitations

## Conflicts between the build plan (md handoff) and the brief, and their resolution

| # | Plan said | Brief said | Resolution |
|---|---|---|---|
| 1 | Folders `server/`, `web/` | Monorepo `/backend`, `/frontend` | **Brief wins:** `backend/`, `frontend/`. |
| 2 | Roles `viewer / reviewer / admin` | Admin, Report Owner/Analyst, Viewer | **Brief wins:** `admin`, `analyst`, `viewer`. The plan's review/quarantine release gate was **not built** (not in the brief; see "Not built"). |
| 3 | Alerts "emit on every exceedance", noise handled downstream | "De-duplicate / rate-limit alert storms" | **Both:** every firing is emitted; storage is edge-triggered incident grouping (open/escalated persisted, repeats not); UI toasts have a per-report cooldown; clients can filter. See API_SPEC §5. |
| 4 | WebSocket only, DuckDB | WS or SSE; SQLite or DuckDB | Same. WebSocket + DuckDB. |
| 5 | Plan's draft had `explain`, config PUT, review-gate endpoints | Not in brief | Cut (time). Thresholds/price are env-configured. |
| 6 | Brief: "prefer TypeScript throughout unless plan says otherwise" | | **Deviation:** plain JavaScript (ESM) with Zod runtime validation. Reason: delivery speed. Consequence: no `tsc` type-check step; ESLint + tests are the static gates. Easy to migrate, since layers are small and typed by Zod at the edges. |
| 7 | Brief: SQL "Snowflake-dialect scripts AND a local-runnable equivalent" | | One **common-subset** SQL suite runs unchanged on both engines — **verified on both**: DuckDB via `npm test`, and a real Snowflake account (37/37 checks PASS, evidence in `validation/`). Plus Snowflake-only setup and generated load/verification scripts. |
| 8 | Brief: "assign-owner action for Admin" | | Implemented as `POST /api/orphans/{reportId}/assign` into `OWNER_ASSIGNMENTS`. |

## Key assumptions

* The CSV has no timestamps: **sweep = row_index ÷ 100**, one sweep = one synthetic day from 2026-09-01. Real-time replay streams one sweep per `REPLAY_TICK_MS` (default 3000 ms).
* No "active user count" column: `monthly_active_views` (and `concurrent_user_peak`) are the proxies.
* `avg_load_time_sec` is the observed dashboard load latency for that snapshot. The 15 s rule is **strictly greater than**.
* `TIMED_OUT` counts as a refresh failure; `UNKNOWN` is "unverified", not a failure, excluded from the success-rate denominator.
* Credit price **$3.00** is a parameter. AWS cost is reported separately and not converted into credits.
* "Orphaned now" = orphan in the latest sweep (an "ever orphan" rule flags 94/100 reports and is useless here).
* Report-to-warehouse mapping is simulated (4 warehouses).

## Findings worth knowing

* **The 15 s alert rule saturates:** the median latency in this file is above 15 s (≈75% of rows breach). We implement the mandated rule and make it configurable; recalibration is recommended.
* Views and AWS cost are uncorrelated (the data is synthetic and columns are independent), so any "discrepancy" is the absence of a relationship; row-level outliers and impossible rows are flagged instead of removed.

## Limitations (honest)

* **The `ACCOUNT_USAGE` tables are simulated, but the SQL did run on real Snowflake.** The suite was executed in a Snowsight worksheet (37/37 checks PASS, `validation/`). What remains simulated: the tables are look-alikes rather than `SNOWFLAKE.ACCOUNT_USAGE`, the app reads DuckDB at runtime, and attribution has never met genuine warehouse metering data — a property of the synthetic source, not an untested code path.
* Alert history, users and audit log are in memory / in the process-local DuckDB and **reset on restart** (replay regenerates alerts). `DB_PATH` can point to a file, but alerts are re-created at boot.
* JWT secret/passwords default to demo values; `.env.example` documents overrides. No refresh tokens, rate limiting on login, or HTTPS in this demo.
* WebSocket is single-process, at-most-once, no offline buffering (recovery = `GET /api/alerts`).
* No Docker, no CI workflow, no screenshots committed (placeholder section in README).
* Frontend has no automated tests; verification was build + proxy smoke test.

## With real Snowflake / AWS

Replace the simulated tables with `SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY` and `QUERY_HISTORY` (45–180 min latency), attribute by `query_tag`/`execution_time` (or bytes scanned) within each metering window, populate idle and cloud-services buckets, join AWS Cost Explorer / CUR by tag, use a key-pair connection with a read-only role, and move alerts/audit to a durable store with an outbox feeding the WebSocket tier.

## Submission and verification policy

Documentation distinguishes **implemented code**, **local test evidence**, and **externally validated integrations**. A passing Python verifier demonstrates data-parity calculations, not browser functionality. The runtime SQL engine is DuckDB and remains explicitly labeled a simulation.

Applying that policy to the current state: the Snowflake execution log **now exists** and is linked (`validation/`). Screenshots and a deployed URL **do not exist** and are therefore described as pending, never as done.

The WebSocket heartbeat setting is configurable using `WS_HEARTBEAT_MS=15000` in `.env.example`; this is a documentation/configuration synchronization change and does not alter the default runtime behavior.
