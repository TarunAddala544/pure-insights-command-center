# Project handoff and final verification

## Implemented in repository

- React + Vite frontend and Express backend with JWT-based role access (admin, analyst, viewer).
- REST API, WebSocket alert hub, replay simulator, configurable latency thresholds and refresh-failure alerts.
- DuckDB-based simulated ACCOUNT_USAGE warehouse, SQL cost attribution, reconciliation and cost per view.
- CSV cleaning, anomaly/quarantine logic, Python verifier and backend test suite.
- API specification, OpenAPI definition, architecture, design decisions and rubric traceability.

## Verification status (distinguish evidence from implementation)

**Executed, with retained output:**

- `npm ci` → `npm run seed` → `npm test`: **39/39 backend tests pass**. Seed summary printed (2,000 rows → 1,976 clean + 24 quarantined).
- `npm run lint`: clean. `npm run build -w frontend`: clean (45 modules).
- `python3 validation/verify.py`: completes; golden metrics reproduce.
- Live API smoke test: `GET /api/health` returns `{"status":"ok","simulatedSnowflake":true}`; login succeeds for all three seeded roles; a **viewer token receives HTTP 403 on `GET /api/costs`** while `GET /api/overview` returns populated KPIs. RBAC is therefore enforced server-side, not only declared.
- **Real Snowflake execution:** the full suite (`00_setup` → `07_reporting_views`, then `97`/`98`/`99`) was run in a Snowsight worksheet against database `PURE_INSIGHTS`, schema `ACCOUNT_USAGE_SIM`, warehouse `PI_WH`. **37 of 37 checks PASS**, matching the pandas reference values exactly. Screenshots and downloaded CSVs are committed in [`../validation/`](../validation/README.md).

**Not yet established:**

- Interactive browser testing of the UI (route guards, toasts, reconnect behaviour) — verified only via API and automated WebSocket tests, not visually.
- Application screenshots and a recorded walkthrough.
- Production deployment, and a public repository URL.
- Attribution against genuine Snowflake metering data — impossible here, since the source is a synthetic CSV with no query-level logs.

## Reproducible local verification

```bash
npm ci
npm run seed
python3 validation/verify.py  # requires pandas
npm test
npm run lint
npm run format:check
npm run build -w frontend
npm start
```

Use a second terminal or browser to inspect `http://localhost:5173` and the API on port 4000. Record pass/fail outcomes and any errors before asserting that these checks pass.

## Manual acceptance checklist

- [x] Admin, analyst and viewer can log in; unauthorized endpoints return 403. *(Verified via API: viewer → `/api/costs` = 403.)*
- [ ] Overview, Costs, Data Quality, Orphans, Alerts and Admin pages load as permitted. *(Browser check still pending.)*
- [ ] Inject 20-second latency; a live WebSocket alert appears.
- [ ] Inject refresh failure; a live alert appears and can be acknowledged/resolved by authorized users.
- [ ] Assign an orphaned report owner; the updated state is visible.
- [ ] Verify credits, unattributed/excluded amounts and unit cost per view reconcile.
- [ ] Restart backend and check WebSocket reconnect behavior.
- [ ] Capture screenshots in `docs/screenshots/` and update README links.
- [x] Run the Snowflake scripts in a trial account, then record output and differences. *(Done — 37/37 PASS, no differences; see `validation/`.)*
- [ ] Publish the final repository and optionally deploy a live demo.

## Prioritized remaining work

1. Capture the six application screenshots into `docs/screenshots/` and link them from the README. This is now the largest gap: the UI is the fastest thing a reviewer judges and there is currently nothing to look at.
2. Perform manual browser + WebSocket acceptance testing (route guards, toasts, reconnect) and retain evidence.
3. Initialise a git repository, commit, publish, and put the URL in the README — the brief asks for a GitHub repository, not an archive.
4. Optional enhancements: GitHub Actions CI, frontend tests, Docker, durable alert history and deployment.

*Completed and removed from this list:* clean install / tests / lint / frontend build (all pass), and Snowflake execution (37/37).

Do not claim a test passed unless you executed it and retained its output.
