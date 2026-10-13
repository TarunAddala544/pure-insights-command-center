-- 97_attribution_checks.sql | DIALECT: common (Snowflake + DuckDB)
-- Cloud cost attribution checks as ONE result table (download it as CSV). Run after 07_reporting_views.sql.
-- expected = values from the independent pandas/DuckDB run of the same CSV; credit price 3.00.
SELECT check_name, actual, expected,
       CASE WHEN ABS(actual - expected) < 0.0051 THEN 'PASS' ELSE 'FAIL' END AS status
FROM (
  SELECT 1 AS ord, 'bucket: attributed credits' AS check_name,
         CAST((SELECT ROUND(credits, 2) FROM CREDIT_BUCKETS WHERE bucket = 'attributed') AS DOUBLE) AS actual,
         CAST(1206352.48 AS DOUBLE) AS expected
  UNION ALL
  SELECT 2, 'bucket: excluded negative credits',
         CAST((SELECT ROUND(credits, 2) FROM CREDIT_BUCKETS WHERE bucket = 'excluded_negative') AS DOUBLE), CAST(-161.04 AS DOUBLE)
  UNION ALL
  SELECT 3, 'bucket: metered total',
         CAST((SELECT ROUND(credits, 2) FROM CREDIT_BUCKETS WHERE bucket = 'metered_total') AS DOUBLE), CAST(1206191.44 AS DOUBLE)
  UNION ALL
  SELECT 4, 'bucket: unattributed idle',
         CAST((SELECT ROUND(credits, 2) FROM CREDIT_BUCKETS WHERE bucket = 'unattributed_idle') AS DOUBLE), CAST(0 AS DOUBLE)
  UNION ALL
  SELECT 5, 'bucket gap: attributed + idle + excluded - metered',
         CAST((SELECT ROUND(SUM(CASE WHEN bucket = 'metered_total' THEN -credits ELSE credits END), 2) FROM CREDIT_BUCKETS) AS DOUBLE), CAST(0 AS DOUBLE)
  UNION ALL
  SELECT 6, 'reports compared with independent raw recount',
         CAST((SELECT COUNT(*) FROM REPORT_CREDIT_ATTRIBUTION a
               JOIN (SELECT report_id, SUM(snowflake_credits_consumed) AS credits FROM RAW_REPORT_SNAPSHOTS
                     WHERE snowflake_credits_consumed >= 0 GROUP BY report_id) x ON x.report_id = a.report_id) AS DOUBLE), CAST(100 AS DOUBLE)
  UNION ALL
  SELECT 7, 'reports whose attributed credits differ from raw recount',
         CAST((SELECT COUNT(*) FROM REPORT_CREDIT_ATTRIBUTION a
               JOIN (SELECT report_id, SUM(snowflake_credits_consumed) AS credits FROM RAW_REPORT_SNAPSHOTS
                     WHERE snowflake_credits_consumed >= 0 GROUP BY report_id) x ON x.report_id = a.report_id
               WHERE ABS(a.credits_direct - x.credits) >= 0.005) AS DOUBLE), CAST(0 AS DOUBLE)
  UNION ALL
  SELECT 8, 'fleet: credits',
         CAST((SELECT ROUND(credits, 2) FROM FLEET_UNIT_ECONOMICS) AS DOUBLE), CAST(1206352.48 AS DOUBLE)
  UNION ALL
  SELECT 9, 'fleet: snowflake cost usd',
         CAST((SELECT ROUND(snowflake_cost_usd, 2) FROM FLEET_UNIT_ECONOMICS) AS DOUBLE), CAST(3619057.44 AS DOUBLE)
  UNION ALL
  SELECT 10, 'fleet: active views',
         CAST((SELECT active_views FROM FLEET_UNIT_ECONOMICS) AS DOUBLE), CAST(1486905 AS DOUBLE)
  UNION ALL
  SELECT 11, 'top cost report RPT_223: credits (and it ranks first)',
         CAST((SELECT ROUND(credits_direct, 2) FROM REPORT_UNIT_ECONOMICS ORDER BY snowflake_cost_usd DESC LIMIT 1) AS DOUBLE), CAST(17034.76 AS DOUBLE)
  UNION ALL
  SELECT 12, 'top cost report: unit cost per view (RPT_223)',
         CAST((SELECT ROUND(unit_cost_per_view_usd, 3) FROM REPORT_UNIT_ECONOMICS ORDER BY snowflake_cost_usd DESC LIMIT 1) AS DOUBLE), CAST(4.539 AS DOUBLE)
  UNION ALL
  SELECT 13, 'reports with NULL unit cost',
         CAST((SELECT COUNT(*) FROM REPORT_UNIT_ECONOMICS WHERE unit_cost_per_view_usd IS NULL) AS DOUBLE), CAST(0 AS DOUBLE)
  UNION ALL
  SELECT 14, 'reconciliation checks that passed (of 6)',
         CAST((SELECT COUNT(*) FROM RECONCILIATION_CHECKS WHERE passed = TRUE) AS DOUBLE), CAST(6 AS DOUBLE)
) t
ORDER BY ord;