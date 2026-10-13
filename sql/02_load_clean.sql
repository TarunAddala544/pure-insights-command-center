-- 02_load_clean.sql | DIALECT: common
-- Cleans RAW_REPORT_SNAPSHOTS. Rows are NEVER silently deleted: negative-credit rows are
-- moved to DQ_QUARANTINE with their raw value and excluded from CLEAN_SNAPSHOTS.

-- Quarantine table: raw value preserved, reason recorded (Defect 2).
CREATE OR REPLACE TABLE DQ_QUARANTINE AS
SELECT
  snapshot_id,
  sweep,
  report_id,
  'NEGATIVE_CREDITS'                         AS defect_code,
  snowflake_credits_consumed                 AS raw_value,
  'Metered credits cannot be negative - excluded from attribution and kept for review' AS reason
FROM RAW_REPORT_SNAPSHOTS
WHERE snowflake_credits_consumed < 0;

-- Clean table: owner normalised to NULL plus an explicit orphan flag (Defect 1).
CREATE OR REPLACE TABLE CLEAN_SNAPSHOTS AS
WITH normalised AS (
  SELECT
    snapshot_id, sweep, synthetic_ts, report_id, report_name,
    LOWER(TRIM(owner_email_raw))              AS owner_norm,
    UPPER(TRIM(last_refresh_status))          AS refresh_status,
    monthly_active_views, snowflake_credits_consumed, avg_load_time_sec,
    aws_hosting_cost_usd, query_count_last_30d, concurrent_user_peak
  FROM RAW_REPORT_SNAPSHOTS
  WHERE snowflake_credits_consumed >= 0
)
SELECT
  snapshot_id, sweep, synthetic_ts, report_id, report_name,
  CASE WHEN owner_norm IS NULL OR owner_norm IN ('', 'nan', 'none', 'null', 'orphaned_report')
       THEN NULL ELSE owner_norm END                                     AS owner_email,
  CASE WHEN owner_norm IS NULL OR owner_norm IN ('', 'nan', 'none', 'null', 'orphaned_report')
       THEN TRUE ELSE FALSE END                                          AS is_orphan,
  CASE WHEN owner_norm = 'orphaned_report' THEN 'SENTINEL'
       WHEN owner_norm IS NULL OR owner_norm IN ('', 'nan', 'none', 'null') THEN 'MISSING'
       ELSE NULL END                                                     AS orphan_reason,
  refresh_status,
  CASE WHEN refresh_status IN ('FAILED', 'TIMED_OUT') THEN TRUE ELSE FALSE END AS is_refresh_failure,
  monthly_active_views, snowflake_credits_consumed, avg_load_time_sec,
  aws_hosting_cost_usd, query_count_last_30d, concurrent_user_peak
FROM normalised;

-- Deterministic report -> warehouse mapping (SIMULATED: the CSV has no warehouse column).
CREATE OR REPLACE TABLE WAREHOUSE_MAP AS
SELECT DISTINCT
  report_id,
  'BI_WH_' || CAST(MOD(CAST(SUBSTR(report_id, 5) AS INTEGER), 4) + 1 AS VARCHAR) AS warehouse_name
FROM RAW_REPORT_SNAPSHOTS;

-- Simulated WAREHOUSE_METERING_HISTORY: one hourly-style window per warehouse per sweep.
-- Metered credits include the negative anomalies, exactly as a faulty meter would report them.
-- Cloud-services credits are not present in the source data and are held at 0 (documented limitation).
CREATE OR REPLACE TABLE WAREHOUSE_METERING_HISTORY_SIM AS
SELECT
  m.warehouse_name,
  r.sweep                                  AS window_sweep,
  MIN(r.synthetic_ts)                      AS start_time,
  SUM(r.snowflake_credits_consumed)        AS credits_used_compute,
  CAST(0 AS DECIMAL(12,2))                 AS credits_used_cloud_services,
  SUM(r.snowflake_credits_consumed)        AS credits_used
FROM RAW_REPORT_SNAPSHOTS r
JOIN WAREHOUSE_MAP m ON m.report_id = r.report_id
GROUP BY m.warehouse_name, r.sweep;

-- Simulated QUERY_HISTORY at AGGREGATE grain (query_count per report snapshot).
-- No query-level rows are invented: the source only has a 30-day query count.
CREATE OR REPLACE TABLE QUERY_HISTORY_SIM_AGG AS
SELECT
  c.snapshot_id, c.sweep, c.report_id, m.warehouse_name,
  c.query_count_last_30d                   AS query_count,
  c.avg_load_time_sec                      AS avg_elapsed_sec
FROM CLEAN_SNAPSHOTS c
JOIN WAREHOUSE_MAP m ON m.report_id = c.report_id;
