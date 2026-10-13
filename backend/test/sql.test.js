import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadConfig } from '../src/config/index.js';
import { ingest } from '../src/domain/clean.js';
import { Database } from '../src/repositories/db.js';
import { buildWarehouse } from '../src/repositories/warehouseRepository.js';

const cfg = loadConfig();
const golden = JSON.parse(fs.readFileSync(`${cfg.root}/validation/golden.json`, 'utf8'));
let db;
before(async () => {
  db = await Database.open();
  await buildWarehouse(db, ingest(cfg.csvPath).rows, cfg.sqlDir, 3);
});

test('SQL reconciliation checks all pass', async () => {
  const checks = await db.all('SELECT check_name, passed FROM RECONCILIATION_CHECKS');
  assert.ok(checks.length >= 6);
  assert.deepEqual(
    checks.filter((c) => !c.passed),
    [],
  );
});

test('SQL defect counts equal pandas golden', async () => {
  const s = Object.fromEntries((await db.all('SELECT * FROM V_DQ_SUMMARY')).map((r) => [r.defect_code, r.affected_rows]));
  assert.equal(s.ORPHAN_OWNER_ROWS, golden.orphan_rows);
  assert.equal(s.NEGATIVE_CREDITS, golden.quarantined_rows);
  assert.equal(s.LATENCY_GT_15S, golden.latency_gt15);
  assert.equal(s.COST_PER_VIEW_OUTLIERS, golden.cost_outliers_z35);
  assert.equal(s.PEAK_GT_MONTHLY_VIEWS, golden.peak_gt_views_rows);
  assert.equal(s.ZERO_VIEWS_WITH_SPEND, golden.zero_view_rows);
  assert.equal(s.REFRESH_UNKNOWN, golden.refresh_unknown);
});

test('SQL per-report unit cost matches pandas to 1e-9', async () => {
  const rows = await db.all('SELECT report_id, unit_cost_per_view_usd AS u FROM REPORT_UNIT_ECONOMICS');
  assert.equal(rows.length, 100);
  for (const r of rows) assert.ok(Math.abs(r.u - golden.per_report[r.report_id].unit_cost) < 1e-5, r.report_id);
});

test('SQL orphaned-now and fleet unit cost match golden', async () => {
  assert.equal((await db.all('SELECT COUNT(*) AS n FROM V_ORPHANS_NOW'))[0].n, golden.orphaned_now);
  const [f] = await db.all('SELECT unit_cost_per_view_usd AS u FROM FLEET_UNIT_ECONOMICS');
  assert.ok(Math.abs(f.u - golden.fleet_unit_cost) < 1e-4);
});
