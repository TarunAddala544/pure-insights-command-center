-- 06_reconciliation.sql | DIALECT: common
-- Reconciliation and validation checks. Final statement raises an error if ANY check fails.

CREATE OR REPLACE TABLE RECONCILIATION_CHECKS AS
WITH b AS (
  SELECT
    MAX(CASE WHEN bucket = 'metered_total'     THEN credits END) AS metered,
    MAX(CASE WHEN bucket = 'attributed'        THEN credits END) AS attributed,
    MAX(CASE WHEN bucket = 'unattributed_idle' THEN credits END) AS idle,
    MAX(CASE WHEN bucket = 'excluded_negative' THEN credits END) AS excluded
  FROM CREDIT_BUCKETS
)
SELECT 'credits: attributed + idle + excluded = metered' AS check_name,
       CAST(b.metered AS DOUBLE) AS expected,
       CAST(b.attributed + b.idle + b.excluded AS DOUBLE) AS actual,
       ABS(b.metered - (b.attributed + b.idle + b.excluded)) < 0.005 AS passed
FROM b
UNION ALL
SELECT 'rows: clean + quarantined = raw',
       (SELECT COUNT(*) FROM RAW_REPORT_SNAPSHOTS),
       (SELECT COUNT(*) FROM CLEAN_SNAPSHOTS) + (SELECT COUNT(*) FROM DQ_QUARANTINE),
       (SELECT COUNT(*) FROM RAW_REPORT_SNAPSHOTS) = (SELECT COUNT(*) FROM CLEAN_SNAPSHOTS) + (SELECT COUNT(*) FROM DQ_QUARANTINE)
UNION ALL
SELECT 'attributed credits = clean credits',
       (SELECT SUM(snowflake_credits_consumed) FROM CLEAN_SNAPSHOTS),
       (SELECT SUM(credits_direct) FROM REPORT_CREDIT_ATTRIBUTION),
       ABS((SELECT SUM(snowflake_credits_consumed) FROM CLEAN_SNAPSHOTS) - (SELECT SUM(credits_direct) FROM REPORT_CREDIT_ATTRIBUTION)) < 0.005
UNION ALL
SELECT 'proxy allocation conserves clean credits',
       (SELECT SUM(credits_direct) FROM REPORT_CREDIT_ATTRIBUTION),
       (SELECT SUM(credits_query_share) FROM REPORT_CREDIT_PROXY_QUERY_SHARE),
       ABS((SELECT SUM(credits_direct) FROM REPORT_CREDIT_ATTRIBUTION) - (SELECT SUM(credits_query_share) FROM REPORT_CREDIT_PROXY_QUERY_SHARE)) < 0.01
UNION ALL
SELECT 'no negative credits remain in clean data',
       0,
       (SELECT COUNT(*) FROM CLEAN_SNAPSHOTS WHERE snowflake_credits_consumed < 0),
       (SELECT COUNT(*) FROM CLEAN_SNAPSHOTS WHERE snowflake_credits_consumed < 0) = 0
UNION ALL
SELECT 'no unit cost is infinite or computed on zero views',
       0,
       (SELECT COUNT(*) FROM REPORT_UNIT_ECONOMICS WHERE active_views = 0 AND unit_cost_per_view_usd IS NOT NULL),
       (SELECT COUNT(*) FROM REPORT_UNIT_ECONOMICS WHERE active_views = 0 AND unit_cost_per_view_usd IS NOT NULL) = 0;

-- Fail loudly: casting this text to INTEGER raises an error on both engines when any check failed.
SELECT CAST(CASE WHEN SUM(CASE WHEN passed THEN 0 ELSE 1 END) = 0 THEN '0' ELSE 'RECONCILIATION_FAILED' END AS INTEGER) AS failed_checks
FROM RECONCILIATION_CHECKS;
