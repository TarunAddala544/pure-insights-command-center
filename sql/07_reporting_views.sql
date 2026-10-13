-- 07_reporting_views.sql | DIALECT: common
-- Views consumed by the REST API (and by the 99_verification query on Snowflake).

CREATE OR REPLACE VIEW V_REPORT_COST AS
SELECT
  u.report_id, n.report_name, u.credits_direct, u.snowflake_cost_usd, u.active_views, u.queries,
  u.aws_cost_usd, u.unit_cost_per_view_usd, u.aws_cost_per_view_usd, u.total_cost_per_view_usd,
  w.warehouse_name
FROM REPORT_UNIT_ECONOMICS u
JOIN (SELECT DISTINCT report_id, report_name FROM CLEAN_SNAPSHOTS) n ON n.report_id = u.report_id
JOIN WAREHOUSE_MAP w ON w.report_id = u.report_id;

CREATE OR REPLACE VIEW V_DQ_SUMMARY AS
SELECT 'ORPHAN_OWNER_ROWS' AS defect_code, COUNT(*) AS affected_rows
FROM RAW_REPORT_SNAPSHOTS
WHERE owner_email_raw IS NULL OR LOWER(TRIM(owner_email_raw)) IN ('', 'nan', 'none', 'null', 'orphaned_report')
UNION ALL SELECT 'NEGATIVE_CREDITS', COUNT(*) FROM DQ_QUARANTINE
UNION ALL SELECT 'LATENCY_GT_15S', COUNT(*) FROM LATENCY_SEVERITY WHERE severity <> 'OK'
UNION ALL SELECT 'COST_PER_VIEW_OUTLIERS', COUNT(*) FROM DQ_COST_PER_VIEW_OUTLIERS
UNION ALL SELECT 'PEAK_GT_MONTHLY_VIEWS', COUNT(*) FROM DQ_IMPOSSIBLE_ROWS WHERE defect_code = 'PEAK_GT_MONTHLY_VIEWS'
UNION ALL SELECT 'ZERO_VIEWS_WITH_SPEND', COUNT(*) FROM DQ_IMPOSSIBLE_ROWS WHERE defect_code = 'ZERO_VIEWS_WITH_SPEND'
UNION ALL SELECT 'REFRESH_UNKNOWN', COUNT(*) FROM RAW_REPORT_SNAPSHOTS WHERE UPPER(TRIM(last_refresh_status)) = 'UNKNOWN';

-- Orphaned NOW = orphan in the latest sweep and no admin assignment yet.
-- Reads RAW rows: ownership is independent of whether the credit reading was valid.
CREATE OR REPLACE VIEW V_ORPHANS_NOW AS
SELECT r.report_id, r.report_name,
       CASE WHEN LOWER(TRIM(r.owner_email_raw)) = 'orphaned_report' THEN 'SENTINEL' ELSE 'MISSING' END AS orphan_reason,
       r.sweep, r.monthly_active_views, r.snowflake_credits_consumed
FROM RAW_REPORT_SNAPSHOTS r
WHERE (r.owner_email_raw IS NULL OR LOWER(TRIM(r.owner_email_raw)) IN ('', 'nan', 'none', 'null', 'orphaned_report'))
  AND r.sweep = (SELECT MAX(sweep) FROM RAW_REPORT_SNAPSHOTS)
  AND r.report_id NOT IN (SELECT report_id FROM OWNER_ASSIGNMENTS);

-- Per-sweep system health trend (latency and refresh success; UNKNOWN excluded from the denominator).
CREATE OR REPLACE VIEW V_HEALTH_BY_SWEEP AS
SELECT
  r.sweep,
  MIN(r.synthetic_ts)                                              AS synthetic_ts,
  AVG(r.avg_load_time_sec)                                         AS avg_latency_sec,
  MAX(r.avg_load_time_sec)                                         AS max_latency_sec,
  SUM(CASE WHEN r.avg_load_time_sec > 15 THEN 1 ELSE 0 END)        AS reports_over_15s,
  SUM(CASE WHEN UPPER(TRIM(r.last_refresh_status)) IN ('FAILED','TIMED_OUT') THEN 1 ELSE 0 END) AS refresh_failures,
  SUM(CASE WHEN UPPER(TRIM(r.last_refresh_status)) = 'UNKNOWN' THEN 1 ELSE 0 END) AS refresh_unknown,
  1.0 * SUM(CASE WHEN UPPER(TRIM(r.last_refresh_status)) = 'SUCCESS' THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN UPPER(TRIM(r.last_refresh_status)) <> 'UNKNOWN' THEN 1 ELSE 0 END), 0) AS refresh_success_rate
FROM RAW_REPORT_SNAPSHOTS r
GROUP BY r.sweep;

-- Cost vs usage flags per report: high AWS cost per view relative to the fleet median.
CREATE OR REPLACE VIEW V_USERS_VS_AWS_BY_REPORT AS
WITH med AS (SELECT MEDIAN(aws_cost_per_view_usd) AS m FROM REPORT_UNIT_ECONOMICS)
SELECT u.report_id, u.active_views, u.aws_cost_usd, u.aws_cost_per_view_usd,
       u.aws_cost_per_view_usd / NULLIF(med.m, 0) AS ratio_to_fleet_median
FROM REPORT_UNIT_ECONOMICS u CROSS JOIN med;
