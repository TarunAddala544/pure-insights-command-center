import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadConfig } from '../src/config/index.js';
import { ingest, orphanReason, severityOf } from '../src/domain/clean.js';
import { AlertEngine } from '../src/domain/alerts.js';
import { attributeByReport, fleetUnitCost, safeDivide } from '../src/domain/cost.js';

const cfg = loadConfig();
const golden = JSON.parse(fs.readFileSync(`${cfg.root}/validation/golden.json`, 'utf8'));
const data = ingest(cfg.csvPath);

test('orphan detection handles nan, empty, whitespace and case variants', () => {
  for (const v of ['nan', 'NaN', '', '  ', 'None', 'null', 'ORPHANED_REPORT', ' orphaned_report ']) {
    assert.notEqual(orphanReason(v), null, v);
  }
  assert.equal(orphanReason('user_1@company.com'), null);
});

test('cleaning counts match the independent pandas verifier', () => {
  const s = data.summary;
  assert.equal(s.rows, golden.rows);
  assert.equal(s.cleanRows, golden.clean_rows);
  assert.equal(s.quarantinedRows, golden.quarantined_rows);
  assert.equal(s.orphanRows, golden.orphan_rows);
  assert.equal(s.orphanMissingRows, golden.orphan_nan_rows);
  assert.equal(s.orphanSentinelRows, golden.orphan_token_rows);
  assert.equal(s.rawCreditTotal, golden.raw_credit_total);
  assert.equal(s.cleanCreditTotal, golden.clean_credit_total);
  assert.equal(s.negativeCreditSum, golden.negative_credit_sum);
  assert.equal(s.latencyGt15, golden.latency_gt15);
  assert.equal(s.zeroViewRows, golden.zero_view_rows);
  assert.equal(s.peakGtViewsRows, golden.peak_gt_views_rows);
  assert.equal(s.costOutlierRows, golden.cost_outliers_z35);
  assert.equal(s.viewsAwsPearson, golden.views_aws_pearson);
});

test('negative credits are quarantined, never abs()-ed', () => {
  assert.ok(data.quarantined.every((r) => r.snowflake_credits_consumed < 0));
  assert.ok(data.clean.every((r) => r.snowflake_credits_consumed >= 0));
});

test('latency boundary: 14.9 / 15.0 / 15.1', () => {
  const t = cfg.thresholds;
  assert.equal(severityOf(14.9, t), null);
  assert.equal(severityOf(15.0, t), null);
  assert.equal(severityOf(15.1, t), 'WARN');
  assert.equal(severityOf(30.1, t), 'HIGH');
  assert.equal(severityOf(45.1, t), 'CRIT');
});

test('alert engine reproduces golden firings, stored incidents and toasts', () => {
  const engine = new AlertEngine({ thresholds: cfg.thresholds, toastCooldownSweeps: 3 });
  const tally = { latency: 0, refresh: 0, stored: 0, toasts: 0 };
  for (const row of data.rows) {
    for (const e of engine.evaluate(row)) {
      tally[e.rule === 'REFRESH_FAILED' ? 'refresh' : 'latency'] += 1;
      if (e.persisted || (e.rule === 'REFRESH_FAILED' && e.incidentState === 'open')) tally.stored += 1;
      if (e.toast) tally.toasts += 1;
    }
  }
  assert.equal(tally.latency, golden.alert_firings.latency);
  assert.equal(tally.refresh, golden.alert_firings.refresh);
  assert.equal(tally.stored, golden.alert_stored_incidents.total);
  assert.equal(tally.toasts, golden.alert_toasts);
});

test('refresh failure always fires an alert, UNKNOWN does not', () => {
  const engine = new AlertEngine({ thresholds: cfg.thresholds, toastCooldownSweeps: 3 });
  const base = { sweep: 0, reportId: 'RPT_X', avg_load_time_sec: 1 };
  assert.equal(engine.evaluate({ ...base, refreshStatus: 'FAILED' }).length, 1);
  assert.equal(engine.evaluate({ ...base, sweep: 1, refreshStatus: 'UNKNOWN' }).length, 0);
});

test('cost math matches pandas and handles zero views', () => {
  const rows = attributeByReport(data.clean, cfg.creditPriceUsd);
  for (const r of rows) {
    const g = golden.per_report[r.reportId];
    assert.ok(Math.abs(r.unitCostPerView - g.unit_cost) < 1e-5, r.reportId);
  }
  assert.ok(Math.abs(fleetUnitCost(data.clean, 3) - golden.fleet_unit_cost) < 1e-4);
  assert.equal(safeDivide(5, 0), null);
});
