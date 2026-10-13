# Snowflake Cloud Cost Allocation SQL suite

**The `ACCOUNT_USAGE` tables are simulated; the Snowflake execution is not.** Two separate things, often conflated:

* **Simulated:** real `SNOWFLAKE.ACCOUNT_USAGE` is read-only and the CSV has no query-level logs, so the suite builds look-alike tables in its own schema `ACCOUNT_USAGE_SIM`. The running application also never opens a Snowflake connection — it reads DuckDB.
* **Executed for real:** every file below has been run in a Snowsight worksheet on an actual Snowflake account (database `PURE_INSIGHTS`, schema `ACCOUNT_USAGE_SIM`, warehouse `PI_WH` XSMALL). Both engines produce identical numbers, and all 37 checks across `97`/`98`/`99` PASS against the pandas reference. Screenshots and downloaded CSVs: [`validation/`](../validation/README.md).

So the suite is dialect-portable in practice, not just in intent. What has *not* been demonstrated is attribution against genuine Snowflake metering data, because no such data exists for a synthetic CSV.

## Which file is which

| Order | File | Dialect | Purpose |
|---|---|---|---|
| 0 | `snowflake/00_setup.sql` | **Snowflake only** | XSMALL warehouse (auto-suspend 60 s), database, schema |
| 1 | `01_schema.sql` | common (Snowflake + DuckDB) | `RAW_REPORT_SNAPSHOTS`, `PARAMS` (credit price etc.), `OWNER_ASSIGNMENTS` |
| 1a | `snowflake/01a_load_raw_data.sql` | common INSERTs, **generated** | 2,000 rows, no stage needed. DuckDB path loads rows from Node instead |
| 2 | `02_load_clean.sql` | common | Quarantine (`DQ_QUARANTINE`), `CLEAN_SNAPSHOTS`, simulated `WAREHOUSE_METERING_HISTORY_SIM` + aggregate `QUERY_HISTORY_SIM_AGG` |
| 3 | `03_anomaly_filtering.sql` | common | Cost-per-view robust-z outliers, impossible rows, latency severity |
| 4 | `04_attribution.sql` | common | Per-report credit attribution (+ proxy control, + credit buckets) |
| 5 | `05_unit_economics.sql` | common | Unit cost per active view, method sensitivity, users-vs-AWS summary |
| 6 | `06_reconciliation.sql` | common | Checks table; last statement **raises an error** if any check fails |
| 7 | `07_reporting_views.sql` | common | `V_*` views read by the REST API |
| 97 | `snowflake/97_attribution_checks.sql` | common | Credit-bucket identity, per-report recount against raw data, fleet totals, top-spender rank, NULL-unit-cost count, reconciliation roll-up (14 checks) |
| 98 | `snowflake/98_spot_check.sql` | common | Re-checks the 10 items of [`validation/spot_check_sheet.csv`](../validation/spot_check_sheet.csv) (sheet value, raw-SQL value, pipeline value, PASS/FAIL) |
| 99 | `snowflake/99_verification.sql` | common, **generated** | One result table: metric, actual, expected_from_pandas, PASS/FAIL (13 checks) |

**Run locally (verified):** `npm run seed` then `npm test` (the backend loads the CSV into DuckDB and executes 01 → 07 in order; `backend/test/sql.test.js` asserts the results).

**Run on Snowflake (verified):** in a worksheet run `00_setup`, `01_schema`, `01a_load_raw_data`, `02` … `07`, then `97_attribution_checks`, `98_spot_check` and `99_verification`. Download each final result as CSV. This has been done — the outputs are committed in [`validation/`](../validation/README.md), so re-run only if you modify `01`–`07`.

## Attribution method

* **Method A (used): direct logged credits.** The source logs `snowflake_credits_consumed` **per report snapshot**, so credits are already tied to a report. Attributed credits of report *r* = Σ credits over its **clean** rows.
* **Method B (control only): query-share proxy.** Within each warehouse-window (simulated warehouse × sweep), clean window credits are split by `query_count` share. It conserves credits (checked) but its rank correlation with Method A is near zero in this data, so it is reported, not used.
* **Why A:** proxy allocation answers "who is probably responsible" when only warehouse-level metering exists. Here direct attribution is available, and a proxy would replace measured data with an estimate.
* **Warehouse mapping is simulated** (`report number mod 4`), documented in `WAREHOUSE_MAP`.

## Formulas

```
attributed_credits(r)      = Σ credits(r, clean rows)
snowflake_cost_usd(r)      = attributed_credits(r) × credit_price_usd          -- PARAMS.credit_price_usd, default 3.00
unit_cost_per_view(r)      = snowflake_cost_usd(r) / NULLIF(Σ monthly_active_views(r, clean rows), 0)
fleet_unit_cost            = Σ cost / Σ views        (same clean row set in numerator and denominator)
credits: attributed + unattributed_idle + excluded_negative = metered_total
```

## Trade-offs and limitations

* **Ratio of sums, not mean of row ratios.** Mean-of-ratios is dominated by low-view rows; the suite computes both (`UNIT_COST_METHOD_SENSITIVITY`) to show the gap.
* **Idle credits = 0** and **cloud-services credits = 0**: the source has no metered-but-unqueried time and no cloud-services column. In real Snowflake both are non-zero; the buckets and checks already carry them, so real data plugs in without changing the reconciliation.
* **`monthly_active_views` is a proxy for "active user views"** (no per-user column exists).
* The credit price is a parameter, not a contract rate; unit cost scales linearly with it (the API rescales without re-running SQL).
* Negative credits are excluded (not abs'd, not clamped) and reported as a bucket, so the reconciliation shows exactly what was excluded.
* Rank correlation uses `RANK()` (ties share a rank): an approximation of Spearman.