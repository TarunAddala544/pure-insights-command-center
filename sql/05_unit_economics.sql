-- 05_unit_economics.sql | DIALECT: common
-- Unit cost per active user view = attributed cost / active views, as a RATIO OF SUMS.
-- Mean-of-row-ratios is computed only to quantify how wrong it would be.

CREATE OR REPLACE TABLE REPORT_UNIT_ECONOMICS AS
WITH p AS (SELECT param_value AS price FROM PARAMS WHERE param_name = 'credit_price_usd')
SELECT
  a.report_id,
  a.credits_direct,
  a.credits_direct * p.price                                   AS snowflake_cost_usd,
  a.active_views,
  a.queries,
  a.aws_cost_usd,
  (a.credits_direct * p.price) / NULLIF(a.active_views, 0)     AS unit_cost_per_view_usd,
  a.aws_cost_usd / NULLIF(a.active_views, 0)                   AS aws_cost_per_view_usd,
  (a.credits_direct * p.price + a.aws_cost_usd) / NULLIF(a.active_views, 0) AS total_cost_per_view_usd
FROM REPORT_CREDIT_ATTRIBUTION a CROSS JOIN p;

CREATE OR REPLACE TABLE FLEET_UNIT_ECONOMICS AS
WITH p AS (SELECT param_value AS price FROM PARAMS WHERE param_name = 'credit_price_usd')
SELECT
  SUM(credits_direct)                                          AS credits,
  SUM(credits_direct) * MAX(p.price)                           AS snowflake_cost_usd,
  SUM(active_views)                                            AS active_views,
  SUM(credits_direct) * MAX(p.price) / NULLIF(SUM(active_views), 0) AS unit_cost_per_view_usd,
  SUM(aws_cost_usd)                                            AS aws_cost_usd
FROM REPORT_CREDIT_ATTRIBUTION CROSS JOIN p;

-- Method sensitivity: per-report mean of row ratios vs ratio of sums (rows with views > 0 only).
CREATE OR REPLACE TABLE UNIT_COST_METHOD_SENSITIVITY AS
WITH p AS (SELECT param_value AS price FROM PARAMS WHERE param_name = 'credit_price_usd'),
row_ratio AS (
  SELECT c.report_id, AVG(c.snowflake_credits_consumed * p.price / c.monthly_active_views) AS mean_of_ratios
  FROM CLEAN_SNAPSHOTS c CROSS JOIN p
  WHERE c.monthly_active_views > 0
  GROUP BY c.report_id
)
SELECT
  u.report_id, u.unit_cost_per_view_usd AS ratio_of_sums, r.mean_of_ratios,
  ABS(r.mean_of_ratios - u.unit_cost_per_view_usd) / NULLIF(u.unit_cost_per_view_usd, 0) AS abs_pct_diff
FROM REPORT_UNIT_ECONOMICS u JOIN row_ratio r ON r.report_id = u.report_id;

-- Proxy-allocation control: rank correlation of direct credits vs query-share credits.
CREATE OR REPLACE TABLE PROXY_CONTROL AS
WITH ranked AS (
  SELECT a.report_id,
         RANK() OVER (ORDER BY a.credits_direct)       AS rank_direct,
         RANK() OVER (ORDER BY p.credits_query_share)  AS rank_proxy
  FROM REPORT_CREDIT_ATTRIBUTION a JOIN REPORT_CREDIT_PROXY_QUERY_SHARE p ON p.report_id = a.report_id
)
SELECT CORR(rank_direct, rank_proxy) AS rank_correlation_direct_vs_query_share FROM ranked;

-- Users vs AWS compute cost discrepancy (Defect 4): headline correlation at row level.
CREATE OR REPLACE TABLE USERS_VS_AWS_SUMMARY AS
SELECT
  CORR(monthly_active_views, aws_hosting_cost_usd)             AS pearson_views_vs_aws,
  CORR(monthly_active_views, aws_hosting_cost_usd) * CORR(monthly_active_views, aws_hosting_cost_usd) AS r_squared,
  COUNT(*)                                                     AS rows_used
FROM RAW_REPORT_SNAPSHOTS;
