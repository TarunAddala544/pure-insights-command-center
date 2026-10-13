-- 00_setup.sql | DIALECT: Snowflake only
-- Run first in a Snowsight worksheet (trial account is fine). Creates an XSMALL warehouse and the
-- simulated schema. Then run, in order: sql/01_schema.sql, snowflake/01a_load_raw_data.sql,
-- sql/02 .. 07, snowflake/99_verification.sql. All simulated data lives in ACCOUNT_USAGE_SIM.
CREATE WAREHOUSE IF NOT EXISTS PI_WH WAREHOUSE_SIZE = 'XSMALL' AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE;
USE WAREHOUSE PI_WH;
CREATE DATABASE IF NOT EXISTS PURE_INSIGHTS;
USE DATABASE PURE_INSIGHTS;
CREATE SCHEMA IF NOT EXISTS ACCOUNT_USAGE_SIM;
USE SCHEMA ACCOUNT_USAGE_SIM;
