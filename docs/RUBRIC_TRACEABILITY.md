# Rubric traceability (checklist)

Status markers below describe **repository-reported implementation/testing**, not an independent certification of the entire application. ✔ = code and project test evidence are present; ◐ = implemented but manual or external verification is pending; ✘ = not completed. See [HANDOFF.md](HANDOFF.md) for the fresh-run checklist and [`validation/`](../validation/README.md) for retained Snowflake output.

## A. Full-stack web architecture

| Requirement | Evidence | Status |
|---|---|---|
| React + Node/Express monorepo | `frontend/`, `backend/` | ✔ build + smoke run |
| Layered backend, env config, error envelope, validation, logging | `backend/src/{routes,controllers,services,repositories}`, `config/`, `middleware/`, `utils/logger.js` | ✔ `api.test.js` |
| JWT + hashed passwords + seeded users | `services/authService.js`, `repositories/userRepository.js` | ✔ `api.test.js` login tests |
| ≥3 roles + permission matrix, server-side RBAC | `middleware/rbac.js`, docs/API_SPEC.md §2 | ✔ role × endpoint matrix test (403s) |
| RBAC in UI (guards, hidden controls) | `frontend/src/App.jsx` ROUTES, `permissions.js`, disabled actions | ◐ manual/proxy smoke only |
| System health overview | `GET /api/overview`, `pages/Overview.jsx` | ✔ API; ◐ UI |
| Orphaned reports + assign owner | `GET /api/orphans`, `POST /api/orphans/{reportId}/assign`, `pages/Orphans.jsx` | ✔ `api.test.js` |
| Cost, Data Quality, Admin pages; loading/empty/error states | `pages/*`, `components/ui.jsx` | ◐ |
| Simulated ACCOUNT_USAGE tables, explicit about simulation | `sql/01_schema.sql`, `02_load_clean.sql`, README, `/api/health` | ✔ |

## B. Real-time alerting & telemetry

| Requirement | Evidence | Status |
|---|---|---|
| WS server: JWT handshake, role-aware channels, heartbeat | `ws/hub.js` | ✔ `ws.e2e.test.js` |
| Client auto-reconnect with backoff, status indicator | `hooks/useAlertSocket.js` | ◐ not automatically tested |
| Latency >15 s alert, severity tiers, configurable env | `domain/alerts.js`, `.env.example` | ✔ boundary 14.9/15.0/15.1 in `domain.test.js` |
| Refresh-failure alert | `domain/alerts.js` | ✔ |
| De-dupe / rate limit | incident grouping + toast cooldown | ✔ golden 2,054 → 1,203 → 382 |
| Telemetry simulator at configurable speed | `sim/replay.js`, `REPLAY_TICK_MS` | ✔ |
| Admin inject endpoint | `POST /api/alerts/inject` | ✔ |
| Persist, history, ack/resolve | `repositories/alertRepository.js`, `/api/alerts*` | ✔ (in-memory DB; resets on restart) |
| Toast + live feed | `alerts.jsx`, `pages/Alerts.jsx`, `App.jsx` Toasts | ◐ |
| E2E test: WS client receives >15 s and failed-refresh alerts within time bound | `ws.e2e.test.js` ("within 1 s") | ✔ |

## C. Cloud cost SQL attribution

| Requirement | Evidence | Status |
|---|---|---|
| Numbered suite 01–07, Snowflake + local | `sql/01…07`, `sql/snowflake/*` | ✔ DuckDB (`sql.test.js`) **and real Snowflake** — 37/37 checks PASS, `validation/` |
| Cross-engine verification worksheets | `snowflake/97_attribution_checks.sql`, `98_spot_check.sql`, `99_verification.sql` | ✔ 14 + 10 + 13 checks, screenshots + CSVs committed |
| Quarantine, not delete | `DQ_QUARANTINE` | ✔ |
| Attribution + idle/cloud-services/price param, documented | `04_attribution.sql`, `sql/README.md` | ✔ (idle & cloud-services = 0 by data) |
| Unit cost per active view, safe divide | `05_unit_economics.sql` (`NULLIF`) | ✔ vs pandas, `domain.test.js` + `sql.test.js` |
| Reconciliation attributed + unattributed + excluded = metered, fail loudly | `06_reconciliation.sql` | ✔ `sql.test.js` |
| Views used by API | `07_reporting_views.sql` | ✔ |
| CTEs, comments, no `SELECT *` in suite | all files | ◐ API reads `V_REPORT_COST` via `SELECT *` in two JS queries |

## D. Code quality & documentation

| Requirement | Evidence | Status |
|---|---|---|
| README (mermaid, setup, creds, demo, tests, screenshots placeholder) | `README.md` | ✔ (screenshots ✘) |
| ARCHITECTURE, DECISIONS | `docs/` | ✔ |
| API spec + OpenAPI + sync test | `docs/API_SPEC.md`, `docs/openapi.yaml`, `spec.test.js` | ✔ |
| Lint + format pass | `npm run lint`, `npm run format:check` | ✔ |
| Type checks | n/a (JavaScript) | ✘ documented deviation |
| Unit tests: cleaning, RBAC, alerts, cost math; integration; WS e2e | `backend/test/` | ✔ |

## Data defects

| Defect | Detection | Count | Docs / UI | Status |
|---|---|---|---|---|
| Orphaned owners (nan, ORPHANED_REPORT, variants) | `domain/clean.js orphanReason`, `02_load_clean.sql` | 245 rows (14 orphaned now) | DATA_QUALITY_REPORT, Orphans + DQ pages | ✔ |
| Negative credits | `clean.js`, `DQ_QUARANTINE` | 24 rows, −161.04 credits | same | ✔ |
| Latency spikes ≤55 s | `severityOf`, `LATENCY_SEVERITY` | 1,490 rows >15 s | same | ✔ |
| Users vs AWS cost | `03` outliers, `USERS_VS_AWS_SUMMARY`, `/api/costs/summary` | r = −0.027; 27 outliers; 93 impossible rows | same | ✔ |
| Extra: UNKNOWN status, no timestamps | `V_DQ_SUMMARY`, DQ report | 100 rows | same | ✔ |

Counts are asserted equal across Node, SQL and pandas (`validation/golden.json`).

## Final evidence to attach before submission

| Evidence | Current state | Action |
|---|---|---|
| Fresh install + backend tests | ✔ Reproduced: `npm ci` → `npm run seed` → 39/39 pass | — |
| Frontend build + lint/format | ✔ Reproduced: build clean, lint clean, format clean | — |
| Server-side RBAC | ✔ Live smoke test: viewer → `/api/costs` = 403 | — |
| Real Snowflake execution | ✔ 37/37 checks PASS; 3 screenshots + 3 result CSVs in `validation/` | — |
| Browser walkthrough (route guards, toasts, owner assignment) | ✘ Pending manual acceptance | Capture screenshots and a short video |
| Application screenshots | ✘ Not captured | Add to `docs/screenshots/`, link from README |
| GitHub repository URL | ✘ Not provided | `git init`, publish, add URL to README |
| Live deployment URL | ✘ Optional, not provided | Add if deployed |

**Scope statement.** The SQL suite is verified to execute correctly on real Snowflake and to produce numbers identical to the DuckDB and pandas references. It is *not* production Snowflake-integrated: the `ACCOUNT_USAGE_SIM` tables are look-alikes rather than `SNOWFLAKE.ACCOUNT_USAGE`, the running application reads DuckDB, and attribution has never been exercised against genuine warehouse metering data. Those are properties of the synthetic source, not untested code paths.
