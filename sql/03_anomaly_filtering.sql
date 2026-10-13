-- 03_anomaly_filtering.sql | DIALECT: common
-- Flags (does not delete) anomalies on top of CLEAN_SNAPSHOTS. Latency spikes are VALID signals.

-- Row-level robust z-score of ln(aws cost per view), rows with views > 0 (Defect 4, row level).
CREATE OR REPLACE TABLE DQ_COST_PER_VIEW_OUTLIERS AS
WITH logs AS (
  SELECT snapshot_id, report_id, LN(aws_hosting_cost_usd / monthly_active_views) AS x
  FROM RAW_REPORT_SNAPSHOTS
  WHERE monthly_active_views > 0 AND aws_hosting_cost_usd > 0
),
centre AS (SELECT MEDIAN(x) AS med FROM logs),
spread AS (SELECT MEDIAN(ABS(l.x - c.med)) AS mad FROM logs l CROSS JOIN centre c),
scored AS (
  SELECT l.snapshot_id, l.report_id,
         (l.x - c.med) / (1.4826 * s.mad) AS robust_z
  FROM logs l CROSS JOIN centre c CROSS JOIN spread s
)
SELECT snapshot_id, report_id, ROUND(robust_z, 3) AS robust_z
FROM scored
WHERE ABS(robust_z) > (SELECT param_value FROM PARAMS WHERE param_name = 'outlier_robust_z');

-- Hard-impossible rows: concurrent peak above monthly views, and zero-view rows that still spend (Defect 4).
CREATE OR REPLACE TABLE DQ_IMPOSSIBLE_ROWS AS
SELECT snapshot_id, report_id, 'PEAK_GT_MONTHLY_VIEWS' AS defect_code
FROM RAW_REPORT_SNAPSHOTS
WHERE concurrent_user_peak > monthly_active_views
UNION ALL
SELECT snapshot_id, report_id, 'ZERO_VIEWS_WITH_SPEND' AS defect_code
FROM RAW_REPORT_SNAPSHOTS
WHERE monthly_active_views = 0 AND (snowflake_credits_consumed > 0 OR aws_hosting_cost_usd > 0);

-- Latency severity per snapshot. Strictly greater than the threshold (15.0 is NOT a breach).
CREATE OR REPLACE TABLE LATENCY_SEVERITY AS
WITH t AS (
  SELECT
    MAX(CASE WHEN param_name = 'latency_warn_sec' THEN param_value END) AS warn_sec,
    MAX(CASE WHEN param_name = 'latency_high_sec' THEN param_value END) AS high_sec,
    MAX(CASE WHEN param_name = 'latency_crit_sec' THEN param_value END) AS crit_sec
  FROM PARAMS
)
SELECT
  c.snapshot_id, c.sweep, c.report_id, c.avg_load_time_sec,
  CASE WHEN c.avg_load_time_sec > t.crit_sec THEN 'CRIT'
       WHEN c.avg_load_time_sec > t.high_sec THEN 'HIGH'
       WHEN c.avg_load_time_sec > t.warn_sec THEN 'WARN'
       ELSE 'OK' END                                  AS severity,
  CASE WHEN c.avg_load_time_sec <= 0 OR c.avg_load_time_sec > 3600 THEN TRUE ELSE FALSE END AS is_invalid_value
-- RAW rows on purpose: a negative credit reading says nothing about latency validity.
FROM RAW_REPORT_SNAPSHOTS c CROSS JOIN t;
