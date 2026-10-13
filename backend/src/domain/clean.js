import fs from 'node:fs';

export const REPORTS_PER_SWEEP = 100;
const MISSING_OWNER_TOKENS = new Set(['', 'nan', 'none', 'null']);
const ORPHAN_SENTINEL = 'orphaned_report';
const FAILURE_STATUSES = new Set(['FAILED', 'TIMED_OUT']);
const NUMERIC_COLUMNS = [
  'monthly_active_views',
  'snowflake_credits_consumed',
  'avg_load_time_sec',
  'aws_hosting_cost_usd',
  'query_count_last_30d',
  'concurrent_user_peak',
];

/** Minimal CSV parser; the file has no quoted fields, enforced by the column-count check. */
export function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = header.split(',');
  return lines.map((line, i) => {
    const cells = line.split(',');
    if (cells.length !== columns.length) {
      throw new Error(`Row ${i + 2}: expected ${columns.length} columns, got ${cells.length}`);
    }
    return Object.fromEntries(columns.map((c, j) => [c, cells[j]]));
  });
}

/** Defect 1: returns the orphan reason, or null when the owner is valid. */
export function orphanReason(ownerRaw) {
  const v = String(ownerRaw ?? '')
    .trim()
    .toLowerCase();
  if (v === ORPHAN_SENTINEL) return 'SENTINEL';
  if (MISSING_OWNER_TOKENS.has(v)) return 'MISSING';
  return null;
}

export const severityOf = (latency, t) => (latency > t.crit ? 'CRIT' : latency > t.high ? 'HIGH' : latency > t.warn ? 'WARN' : null);

export const isRefreshFailure = (status) => FAILURE_STATUSES.has(status);

/** Types one raw row and attaches derived flags. Unparsable numbers are rejected loudly. */
export function typeRow(raw, index) {
  const row = { snapshotId: index + 1, sweep: Math.floor(index / REPORTS_PER_SWEEP) };
  row.reportId = raw.report_id.trim();
  row.reportName = raw.report_name.trim();
  row.ownerRaw = raw.owner_email;
  row.refreshStatus = raw.last_refresh_status.trim().toUpperCase();
  for (const col of NUMERIC_COLUMNS) {
    const n = Number(raw[col]);
    if (raw[col].trim() === '' || Number.isNaN(n)) {
      throw new Error(`Row ${index + 2}: column ${col} is not numeric: "${raw[col]}"`);
    }
    row[col] = n;
  }
  row.orphanReason = orphanReason(raw.owner_email);
  row.isOrphan = row.orphanReason !== null;
  row.isNegativeCredit = row.snowflake_credits_consumed < 0;
  return row;
}

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Defect 4 (row level): robust z of ln(aws cost / views) over rows with views > 0. */
export function costPerViewOutliers(rows, cutoff = 3.5) {
  const eligible = rows.filter((r) => r.monthly_active_views > 0);
  const logs = eligible.map((r) => Math.log(r.aws_hosting_cost_usd / r.monthly_active_views));
  const med = median(logs);
  const mad = median(logs.map((x) => Math.abs(x - med)));
  return eligible
    .map((r, i) => ({ r, z: (logs[i] - med) / (1.4826 * mad) }))
    .filter(({ z }) => Math.abs(z) > cutoff)
    .map(({ r, z }) => ({ snapshotId: r.snapshotId, reportId: r.reportId, z: round(z, 3) }));
}

export function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
}

const sumBy = (arr, f) => arr.reduce((a, r) => a + f(r), 0);

/** Full ingestion: parse, type, flag, and summarise every defect with counts. */
export function ingest(csvPath) {
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).map(typeRow);
  const clean = rows.filter((r) => !r.isNegativeCredit);
  const quarantined = rows.filter((r) => r.isNegativeCredit);
  const credits = (r) => r.snowflake_credits_consumed;
  const outliers = costPerViewOutliers(rows);
  const summary = {
    rows: rows.length,
    cleanRows: clean.length,
    quarantinedRows: quarantined.length,
    orphanRows: rows.filter((r) => r.isOrphan).length,
    orphanMissingRows: rows.filter((r) => r.orphanReason === 'MISSING').length,
    orphanSentinelRows: rows.filter((r) => r.orphanReason === 'SENTINEL').length,
    rawCreditTotal: round(sumBy(rows, credits)),
    cleanCreditTotal: round(sumBy(clean, credits)),
    negativeCreditSum: round(sumBy(quarantined, credits)),
    latencyGt15: rows.filter((r) => r.avg_load_time_sec > 15).length,
    latencyExactly15: rows.filter((r) => r.avg_load_time_sec === 15).length,
    latencyMax: Math.max(...rows.map((r) => r.avg_load_time_sec)),
    refreshFailures: rows.filter((r) => isRefreshFailure(r.refreshStatus)).length,
    refreshUnknown: rows.filter((r) => r.refreshStatus === 'UNKNOWN').length,
    zeroViewRows: rows.filter((r) => r.monthly_active_views === 0).length,
    peakGtViewsRows: rows.filter((r) => r.concurrent_user_peak > r.monthly_active_views).length,
    viewsAwsPearson: round(
      pearson(
        rows.map((r) => r.monthly_active_views),
        rows.map((r) => r.aws_hosting_cost_usd),
      ),
      4,
    ),
    costOutlierRows: outliers.length,
  };
  return { rows, clean, quarantined, outliers, summary };
}
