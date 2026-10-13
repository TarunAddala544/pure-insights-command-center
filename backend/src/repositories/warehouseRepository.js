const SYNTHETIC_BASE = Date.UTC(2026, 8, 1);
const DAY_MS = 86_400_000;

/** SYNTHETIC timestamp for a sweep: the source CSV has none. One sweep = one day from 2026-09-01. */
export const syntheticTimestamp = (sweep) => new Date(SYNTHETIC_BASE + sweep * DAY_MS).toISOString();

const SQL_FILES = [
  '01_schema.sql',
  '02_load_clean.sql',
  '03_anomaly_filtering.sql',
  '04_attribution.sql',
  '05_unit_economics.sql',
  '06_reconciliation.sql',
  '07_reporting_views.sql',
];

/** Loads raw rows then runs the cost SQL suite in order (01 -> 07). Throws if reconciliation fails. */
export async function buildWarehouse(db, rows, sqlDir, creditPriceUsd) {
  await db.runSqlFile(`${sqlDir}/${SQL_FILES[0]}`);
  await db.run('DELETE FROM PARAMS WHERE param_name = ?', ['credit_price_usd']);
  await db.run('INSERT INTO PARAMS VALUES (?, ?)', ['credit_price_usd', creditPriceUsd]);
  await insertRaw(db, rows);
  for (const f of SQL_FILES.slice(1)) await db.runSqlFile(`${sqlDir}/${f}`);
}

async function insertRaw(db, rows) {
  const values = rows
    .map((r) => {
      const owner = String(r.ownerRaw).replaceAll("'", "''");
      return `(${r.snapshotId},${r.sweep},TIMESTAMP '${syntheticTimestamp(r.sweep).slice(0, 19).replace('T', ' ')}','${r.reportId}','${r.reportName}','${owner}','${r.refreshStatus}',${r.monthly_active_views},${r.snowflake_credits_consumed},${r.avg_load_time_sec},${r.aws_hosting_cost_usd},${r.query_count_last_30d},${r.concurrent_user_peak})`;
    })
    .join(',\n');
  await db.run(`INSERT INTO RAW_REPORT_SNAPSHOTS VALUES ${values}`);
}

/** Re-runs 04-07 after a credit price change. */
export async function recomputeCosts(db, sqlDir, creditPriceUsd) {
  await db.run('DELETE FROM PARAMS WHERE param_name = ?', ['credit_price_usd']);
  await db.run('INSERT INTO PARAMS VALUES (?, ?)', ['credit_price_usd', creditPriceUsd]);
  for (const f of SQL_FILES.slice(3)) await db.runSqlFile(`${sqlDir}/${f}`);
}
