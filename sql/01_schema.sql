-- 01_schema.sql | DIALECT: common (runs unchanged on Snowflake and DuckDB)
-- Simulated SNOWFLAKE.ACCOUNT_USAGE-style tables. Snowflake's real ACCOUNT_USAGE schema is
-- read-only, so everything lives in our own schema (ACCOUNT_USAGE_SIM). NOTHING here is a live Snowflake feed.
-- RAW_REPORT_SNAPSHOTS is the untouched CSV: one row per report per sweep (100 reports x 20 sweeps).

CREATE OR REPLACE TABLE RAW_REPORT_SNAPSHOTS (
  snapshot_id                INTEGER,        -- 1-based CSV row number
  sweep                      INTEGER,        -- 0-based block of 100 consecutive rows
  synthetic_ts               TIMESTAMP,      -- SYNTHETIC: the CSV has no timestamps
  report_id                  VARCHAR,
  report_name                VARCHAR,
  owner_email_raw            VARCHAR,        -- raw text, including literal 'nan' and 'ORPHANED_REPORT'
  last_refresh_status        VARCHAR,
  monthly_active_views       INTEGER,
  snowflake_credits_consumed DECIMAL(12,2),  -- may be negative (injected defect)
  avg_load_time_sec          DECIMAL(6,1),
  aws_hosting_cost_usd       DECIMAL(12,2),
  query_count_last_30d       INTEGER,
  concurrent_user_peak       INTEGER
);

-- Tunable parameters. Change the credit price here and re-run 04-07.
CREATE OR REPLACE TABLE PARAMS (param_name VARCHAR, param_value DOUBLE);
INSERT INTO PARAMS (param_name, param_value) VALUES ('credit_price_usd', 3.0);
INSERT INTO PARAMS (param_name, param_value) VALUES ('latency_warn_sec', 15);
INSERT INTO PARAMS (param_name, param_value) VALUES ('latency_high_sec', 30);
INSERT INTO PARAMS (param_name, param_value) VALUES ('latency_crit_sec', 45);
INSERT INTO PARAMS (param_name, param_value) VALUES ('outlier_robust_z', 3.5);

-- Admin-assigned owners for orphaned reports (written by the API, not by the cleaning pipeline).
CREATE OR REPLACE TABLE OWNER_ASSIGNMENTS (
  report_id      VARCHAR,
  owner_email    VARCHAR,
  assigned_by    VARCHAR,
  assigned_at    TIMESTAMP
);
