-- 98_spot_check.sql | DIALECT: common (Snowflake + DuckDB)
-- Re-validates the 10 items of validation/spot_check_sheet.csv on Snowflake. Run AFTER 07_reporting_views.sql.
-- raw_sql_value  = computed straight from RAW_REPORT_SNAPSHOTS exactly as the sheet's how_to_compute says
--                  (independent of the cleaning pipeline; credit price 3.00 typed in on purpose).
-- pipeline_value = what the suite's own tables/views report (NULL where no pipeline table covers the item).
-- status = PASS only if every non-NULL value equals the sheet value.
SELECT item, sheet_value, raw_sql_value, pipeline_value,
       CASE WHEN ABS(raw_sql_value - sheet_value) < 0.0005
             AND (pipeline_value IS NULL OR ABS(pipeline_value - sheet_value) < 0.0005)
            THEN 'PASS' ELSE 'FAIL' END AS status
FROM (
  SELECT 1 AS ord, 'Unit cost per view, ' || e.report_id AS item,
         CAST(e.sheet_value AS DOUBLE) AS sheet_value,
         CAST(ROUND(SUM(CASE WHEN r.snowflake_credits_consumed >= 0 THEN r.snowflake_credits_consumed END) * 3.00
                    / SUM(CASE WHEN r.snowflake_credits_consumed >= 0 THEN r.monthly_active_views END), 3) AS DOUBLE) AS raw_sql_value,
         CAST(MAX(ROUND(u.unit_cost_per_view_usd, 3)) AS DOUBLE) AS pipeline_value
  FROM (VALUES ('RPT_200', 2.185), ('RPT_223', 4.539), ('RPT_250', 2.354), ('RPT_270', 2.175), ('RPT_299', 1.535))
       AS e(report_id, sheet_value)
  JOIN RAW_REPORT_SNAPSHOTS r ON r.report_id = e.report_id
  LEFT JOIN REPORT_UNIT_ECONOMICS u ON u.report_id = e.report_id
  GROUP BY e.report_id, e.sheet_value
  UNION ALL
  SELECT 2, 'Latest sweep: reports with latency > 15 s', 76,
         CAST((SELECT COUNT(*) FROM RAW_REPORT_SNAPSHOTS WHERE snapshot_id BETWEEN 1901 AND 2000 AND avg_load_time_sec > 15) AS DOUBLE),
         CAST((SELECT reports_over_15s FROM V_HEALTH_BY_SWEEP WHERE sweep = (SELECT MAX(sweep) FROM RAW_REPORT_SNAPSHOTS)) AS DOUBLE)
  UNION ALL
  SELECT 3, 'Latest sweep: refresh failures', 25,
         CAST((SELECT COUNT(*) FROM RAW_REPORT_SNAPSHOTS WHERE snapshot_id BETWEEN 1901 AND 2000 AND UPPER(TRIM(last_refresh_status)) IN ('FAILED', 'TIMED_OUT')) AS DOUBLE),
         CAST((SELECT refresh_failures FROM V_HEALTH_BY_SWEEP WHERE sweep = (SELECT MAX(sweep) FROM RAW_REPORT_SNAPSHOTS)) AS DOUBLE)
  UNION ALL
  SELECT 4, 'Latest sweep: CRIT latency (> 45 s)', 9,
         CAST((SELECT COUNT(*) FROM RAW_REPORT_SNAPSHOTS WHERE snapshot_id BETWEEN 1901 AND 2000 AND avg_load_time_sec > 45) AS DOUBLE),
         CAST((SELECT COUNT(*) FROM LATENCY_SEVERITY WHERE severity = 'CRIT' AND sweep = (SELECT MAX(sweep) FROM RAW_REPORT_SNAPSHOTS)) AS DOUBLE)
  UNION ALL
  SELECT 5, 'Whole file: rows with negative credits', 24,
         CAST((SELECT COUNT(*) FROM RAW_REPORT_SNAPSHOTS WHERE snowflake_credits_consumed < 0) AS DOUBLE),
         CAST((SELECT COUNT(*) FROM DQ_QUARANTINE) AS DOUBLE)
  UNION ALL
  SELECT 6, 'Whole file: rows with latency exactly 15.0', 7,
         CAST((SELECT COUNT(*) FROM RAW_REPORT_SNAPSHOTS WHERE avg_load_time_sec = 15) AS DOUBLE),
         CAST((SELECT COUNT(*) FROM LATENCY_SEVERITY WHERE avg_load_time_sec = 15) AS DOUBLE)
) t
ORDER BY ord, item;
