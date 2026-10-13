import { notFound, badRequest, conflict } from '../utils/errors.js';

const rnd = (v, d = 4) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Read-side analytics over the simulated warehouse views (sql/07_reporting_views.sql). */
export class AnalyticsService {
  constructor({ db, data, cfg, audit }) {
    this.db = db;
    this.data = data;
    this.cfg = cfg;
    this.audit = audit;
  }

  async overview() {
    const trend = await this.db.all(
      'SELECT sweep, avg_latency_sec, max_latency_sec, reports_over_15s, refresh_failures, refresh_unknown, refresh_success_rate FROM V_HEALTH_BY_SWEEP ORDER BY sweep',
    );
    const latest = trend.at(-1);
    const [{ n: orphans }] = await this.db.all('SELECT COUNT(*) AS n FROM V_ORPHANS_NOW');
    const [fleet] = await this.db.all('SELECT unit_cost_per_view_usd, credits FROM FLEET_UNIT_ECONOMICS');
    const [rates] = await this.db.all(`SELECT 1.0 * SUM(CASE WHEN UPPER(TRIM(last_refresh_status)) = 'SUCCESS' THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN UPPER(TRIM(last_refresh_status)) <> 'UNKNOWN' THEN 1 ELSE 0 END), 0) AS r FROM RAW_REPORT_SNAPSHOTS`);
    return {
      latestSweep: latest.sweep,
      kpis: {
        reportsMonitored: 100,
        reportsOver15s: latest.reports_over_15s,
        refreshFailuresLatest: latest.refresh_failures,
        refreshUnknownLatest: latest.refresh_unknown,
        orphanedNow: orphans,
        refreshSuccessRateAll: rnd(rates.r),
        medianLatencyAllSec: this.#medianLatency(),
        fleetUnitCostUsd: rnd(fleet.unit_cost_per_view_usd),
      },
      trend,
      note: 'UNKNOWN refresh status is excluded from the success-rate denominator.',
    };
  }

  #medianLatency() {
    const v = this.data.rows.map((r) => r.avg_load_time_sec).sort((a, b) => a - b);
    return (v[999] + v[1000]) / 2;
  }

  async reports() {
    return this.db.all(`SELECT r.report_id, r.report_name, r.last_refresh_status AS refresh_status, r.avg_load_time_sec AS latency_sec,
        r.monthly_active_views AS views, r.concurrent_user_peak AS peak, r.owner_email_raw AS owner_raw,
        (r.owner_email_raw IS NULL OR LOWER(TRIM(r.owner_email_raw)) IN ('', 'nan', 'none', 'null', 'orphaned_report')) AS is_orphan,
        a.owner_email AS assigned_owner
      FROM RAW_REPORT_SNAPSHOTS r LEFT JOIN OWNER_ASSIGNMENTS a ON a.report_id = r.report_id
      WHERE r.sweep = (SELECT MAX(sweep) FROM RAW_REPORT_SNAPSHOTS) ORDER BY r.report_id`);
  }

  async reportDetail(id) {
    const history = await this.db.all(
      'SELECT sweep, owner_email_raw AS owner_raw, last_refresh_status AS refresh_status, avg_load_time_sec AS latency_sec, monthly_active_views AS views, snowflake_credits_consumed AS credits, aws_hosting_cost_usd AS aws_cost FROM RAW_REPORT_SNAPSHOTS WHERE report_id = ? ORDER BY sweep',
      [id],
    );
    if (history.length === 0) throw notFound(`Report ${id} not found`);
    const [cost] = await this.db.all('SELECT * FROM V_REPORT_COST WHERE report_id = ?', [id]);
    return { reportId: id, history, cost };
  }

  async orphans() {
    const now = await this.db.all(
      'SELECT report_id, report_name, orphan_reason, monthly_active_views AS views FROM V_ORPHANS_NOW ORDER BY report_id',
    );
    const chronic = await this.db.all(`SELECT report_id, COUNT(*) AS orphan_sweeps_of_last5 FROM RAW_REPORT_SNAPSHOTS
      WHERE sweep >= (SELECT MAX(sweep) - 4 FROM RAW_REPORT_SNAPSHOTS)
        AND (owner_email_raw IS NULL OR LOWER(TRIM(owner_email_raw)) IN ('', 'nan', 'none', 'null', 'orphaned_report'))
      GROUP BY report_id HAVING COUNT(*) >= 2 ORDER BY orphan_sweeps_of_last5 DESC, report_id`);
    const assigned = await this.db.all(
      'SELECT report_id, owner_email, assigned_by, CAST(assigned_at AS VARCHAR) AS assigned_at FROM OWNER_ASSIGNMENTS ORDER BY assigned_at DESC',
    );
    return { orphanedNow: now, chronic, assigned, rowLevelOrphanRate: rnd(this.data.summary.orphanRows / this.data.summary.rows) };
  }

  async assignOwner(reportId, ownerEmail, actor) {
    const exists = await this.db.all('SELECT 1 AS x FROM V_ORPHANS_NOW WHERE report_id = ?', [reportId]);
    if (exists.length === 0) {
      const known = await this.db.all('SELECT 1 AS x FROM RAW_REPORT_SNAPSHOTS WHERE report_id = ? LIMIT 1', [reportId]);
      if (known.length === 0) throw notFound(`Report ${reportId} not found`);
      throw conflict(`Report ${reportId} is not currently orphaned`);
    }
    await this.db.run('INSERT INTO OWNER_ASSIGNMENTS VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [
      reportId,
      ownerEmail.toLowerCase(),
      actor.email,
    ]);
    this.audit.record(actor.email, 'orphan.assign', reportId, { ownerEmail });
    return { reportId, ownerEmail: ownerEmail.toLowerCase(), assignedBy: actor.email };
  }

  async usage() {
    const top = await this.db.all(
      'SELECT report_id, report_name, active_views, queries FROM V_REPORT_COST ORDER BY active_views DESC LIMIT 10',
    );
    const [peak] = await this.db.all(
      'SELECT MAX(concurrent_user_peak) AS max_peak, SUM(monthly_active_views) AS total_views, SUM(query_count_last_30d) AS total_queries FROM RAW_REPORT_SNAPSHOTS WHERE sweep = (SELECT MAX(sweep) FROM RAW_REPORT_SNAPSHOTS)',
    );
    const idle = await this.db.all(
      'SELECT snapshot_id, report_id, sweep FROM RAW_REPORT_SNAPSHOTS WHERE monthly_active_views = 0 ORDER BY snapshot_id',
    );
    return { latestSweepTotals: peak, topReportsByViews: top, zeroViewSnapshots: idle };
  }

  async costs(price) {
    const base = this.cfg.creditPriceUsd;
    const rows = await this.db.all('SELECT * FROM V_REPORT_COST ORDER BY snowflake_cost_usd DESC');
    const scale = price / base;
    const items = rows.map((r) => {
      const sf = r.snowflake_cost_usd * scale;
      return {
        ...r,
        snowflake_cost_usd: rnd(sf, 2),
        unit_cost_per_view_usd: r.active_views ? rnd(sf / r.active_views, 4) : null,
        total_cost_per_view_usd: r.active_views ? rnd((sf + r.aws_cost_usd) / r.active_views, 4) : null,
      };
    });
    return { creditPriceUsd: price, basePriceUsd: base, items };
  }

  async costSummary(price) {
    const items = (await this.costs(price)).items;
    const totalSf = items.reduce((s, r) => s + r.snowflake_cost_usd, 0);
    const views = items.reduce((s, r) => s + r.active_views, 0);
    const [buckets, checks, proxy, sens, aws] = await Promise.all([
      this.db.all('SELECT bucket, credits FROM CREDIT_BUCKETS'),
      this.db.all('SELECT check_name, expected, actual, passed FROM RECONCILIATION_CHECKS'),
      this.db.all('SELECT * FROM PROXY_CONTROL'),
      this.db.all(
        'SELECT MEDIAN(abs_pct_diff) AS median_abs_pct_diff, MAX(abs_pct_diff) AS max_abs_pct_diff FROM UNIT_COST_METHOD_SENSITIVITY',
      ),
      this.db.all('SELECT * FROM USERS_VS_AWS_SUMMARY'),
    ]);
    return {
      creditPriceUsd: price,
      fleet: { snowflakeCostUsd: rnd(totalSf, 2), activeViews: views, unitCostPerViewUsd: rnd(totalSf / views) },
      topSpenders: items.slice(0, 10),
      creditBuckets: buckets,
      reconciliation: checks,
      proxyControl: proxy[0],
      methodSensitivity: sens[0],
      usersVsAws: aws[0],
      awsFlags: await this.db.all(
        'SELECT report_id, aws_cost_per_view_usd, ratio_to_fleet_median FROM V_USERS_VS_AWS_BY_REPORT ORDER BY ratio_to_fleet_median DESC LIMIT 10',
      ),
    };
  }

  async dataQuality() {
    const s = this.data.summary;
    const sql = await this.db.all('SELECT defect_code, affected_rows FROM V_DQ_SUMMARY');
    return {
      csvRows: s.rows,
      defects: [
        {
          code: 'ORPHANED_REPORTS',
          title: 'Orphaned reports (missing owner)',
          rule: "owner_email trimmed, case-insensitive: NULL, '', nan, none, null, or ORPHANED_REPORT",
          affectedRows: s.orphanRows,
          breakdown: { missingOrNan: s.orphanMissingRows, sentinel: s.orphanSentinelRows },
          treatment: 'Normalised to owner_email = NULL plus is_orphan flag. Kept visible.',
          rationale: 'Orphans are the product signal, not noise. Dropping them would hide the problem the dashboard exists to expose.',
          before: `${s.orphanRows} rows with literal text nan or ORPHANED_REPORT`,
          after: `${s.orphanRows} rows flagged is_orphan, 0 deleted`,
        },
        {
          code: 'NEGATIVE_CREDITS',
          title: 'Negative Snowflake credits',
          rule: 'snowflake_credits_consumed < 0',
          affectedRows: s.quarantinedRows,
          creditsExcluded: s.negativeCreditSum,
          treatment: 'Quarantined (raw value kept), excluded from attribution. No abs(), no clamping.',
          rationale: 'Credits cannot be negative. abs() would invent consumption. Clamping to 0 would invent fake zero readings.',
          before: `raw credit total ${s.rawCreditTotal}`,
          after: `clean total ${s.cleanCreditTotal}, quarantined ${s.negativeCreditSum}`,
        },
        {
          code: 'LATENCY_SPIKES',
          title: 'Load-latency spikes (max 55 s)',
          rule: `avg_load_time_sec > ${this.cfg.thresholds.warn} (strict). Impossible = <= 0 or > 3600`,
          affectedRows: s.latencyGt15,
          exactlyAtThreshold: s.latencyExactly15,
          maxSec: s.latencyMax,
          treatment: 'Kept as valid signals. Severity WARN/HIGH/CRIT drives alerts.',
          rationale: 'Spikes are what Task 2 must alert on. 15 s is below the median, so the rule saturates (documented).',
          before: 'n/a',
          after: `${s.latencyGt15} rows above threshold, 0 impossible values`,
        },
        {
          code: 'USERS_VS_AWS',
          title: 'Active users vs AWS compute cost discrepancy',
          rule: 'Pearson(views, AWS cost); robust z > 3.5 of ln(AWS $/view); peak > monthly views; zero views with spend',
          affectedRows: s.costOutlierRows,
          impossiblePeakRows: s.peakGtViewsRows,
          zeroViewRows: s.zeroViewRows,
          pearson: s.viewsAwsPearson,
          treatment: 'Flagged, not removed. Exposed in /api/costs/summary and the Cost page.',
          rationale: 'Views and AWS cost are uncorrelated in this file (synthetic). Report-level ratios hide the row-level outliers.',
          before: 'n/a',
          after: `${s.costOutlierRows} outlier rows, ${s.peakGtViewsRows} impossible peak rows`,
        },
      ],
      additionalFindings: [
        {
          code: 'REFRESH_UNKNOWN',
          affectedRows: s.refreshUnknown,
          note: 'Own unverified state, not a failure; excluded from the success-rate denominator.',
        },
        {
          code: 'NO_TIMESTAMPS',
          affectedRows: s.rows,
          note: 'CSV has no timestamps. Sweeps (100 rows each) are used and timestamps are synthetic.',
        },
        { code: 'DUPLICATES', affectedRows: 0, note: 'No duplicate (report, sweep) pairs.' },
      ],
      sqlSummary: sql,
      costOutlierSample: this.data.outliers.slice(0, 10),
    };
  }

  quarantine() {
    return this.db.all('SELECT snapshot_id, sweep, report_id, defect_code, raw_value, reason FROM DQ_QUARANTINE ORDER BY snapshot_id');
  }

  validatePrice(raw) {
    const price = raw === undefined ? this.cfg.creditPriceUsd : Number(raw);
    if (!(price > 0) || price > 1000) throw badRequest('price must be a positive number');
    return price;
  }
}
