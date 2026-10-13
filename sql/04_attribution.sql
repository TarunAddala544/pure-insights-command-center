-- 04_attribution.sql | DIALECT: common
-- Credit attribution to reports. METHOD A (used): direct, logged credits rolled up per report.
-- METHOD B (control only): warehouse-window credits split by query share. See sql/README.md.

CREATE OR REPLACE TABLE REPORT_CREDIT_ATTRIBUTION AS
SELECT
  report_id,
  SUM(snowflake_credits_consumed)  AS credits_direct,      -- Method A (clean rows only)
  SUM(monthly_active_views)        AS active_views,
  SUM(query_count_last_30d)        AS queries,
  SUM(aws_hosting_cost_usd)        AS aws_cost_usd,
  COUNT(*)                         AS clean_snapshots
FROM CLEAN_SNAPSHOTS
GROUP BY report_id;

-- Method B: within each warehouse-window, split that window's clean credits by query share.
CREATE OR REPLACE TABLE REPORT_CREDIT_PROXY_QUERY_SHARE AS
WITH window_total AS (
  SELECT warehouse_name, sweep, SUM(query_count) AS q_total
  FROM QUERY_HISTORY_SIM_AGG GROUP BY warehouse_name, sweep
),
window_credits AS (
  SELECT m.warehouse_name, c.sweep, SUM(c.snowflake_credits_consumed) AS credits_clean
  FROM CLEAN_SNAPSHOTS c JOIN WAREHOUSE_MAP m ON m.report_id = c.report_id
  GROUP BY m.warehouse_name, c.sweep
)
SELECT
  q.report_id,
  SUM(wc.credits_clean * q.query_count / NULLIF(wt.q_total, 0)) AS credits_query_share
FROM QUERY_HISTORY_SIM_AGG q
JOIN window_total wt   ON wt.warehouse_name = q.warehouse_name AND wt.sweep = q.sweep
JOIN window_credits wc ON wc.warehouse_name = q.warehouse_name AND wc.sweep = q.sweep
GROUP BY q.report_id;

-- Credit buckets for reconciliation: attributed + unattributed (idle) + excluded = metered.
-- Idle = 0 because the source has no metered-but-unqueried time (documented limitation).
CREATE OR REPLACE TABLE CREDIT_BUCKETS AS
SELECT 'metered_total'   AS bucket, SUM(credits_used)                          AS credits FROM WAREHOUSE_METERING_HISTORY_SIM
UNION ALL
SELECT 'attributed',       SUM(credits_direct)                                 FROM REPORT_CREDIT_ATTRIBUTION
UNION ALL
SELECT 'unattributed_idle', CAST(0 AS DECIMAL(12,2))
UNION ALL
SELECT 'excluded_negative', COALESCE(SUM(raw_value), 0)                        FROM DQ_QUARANTINE;
