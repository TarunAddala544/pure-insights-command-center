import React, { useState } from 'react';
import { api } from '../api.js';
import { useAsync } from '../hooks/useAsync.js';
import { Async, Badge, Kpi, Table, fmt, usd } from '../components/ui.jsx';

export default function Costs() {
  const [price, setPrice] = useState(3);
  const state = useAsync(() => api(`/costs/summary?price=${price}`), [price]);
  return (
    <section>
      <h2>Cost attribution</h2>
      <label>
        Credit price (USD){' '}
        <input type="number" min="0.1" step="0.1" value={price} onChange={(e) => setPrice(Number(e.target.value) || 3)} />
      </label>
      <Async state={state}>
        {(d) => (
          <>
            <div className="kpis">
              <Kpi label="Fleet unit cost per active view" value={usd(d.fleet.unitCostPerViewUsd)} />
              <Kpi label="Snowflake cost (simulated)" value={usd(d.fleet.snowflakeCostUsd, 0)} />
              <Kpi label="Active views" value={fmt(d.fleet.activeViews, 0)} />
              <Kpi
                label="Rank corr: direct vs query-share proxy"
                value={fmt(d.proxyControl.rank_correlation_direct_vs_query_share)}
                tone="warn"
              />
              <Kpi label="Users vs AWS cost: Pearson r" value={fmt(d.usersVsAws.pearson_views_vs_aws, 3)} tone="warn" />
              <Kpi label="Method gap (median)" value={`${fmt(d.methodSensitivity.median_abs_pct_diff * 100, 0)}%`} />
            </div>
            <h3>Top spenders</h3>
            <Table
              caption="Top spenders"
              columns={[
                { key: 'report_id', label: 'Report' },
                { key: 'warehouse_name', label: 'Warehouse' },
                { key: 'credits_direct', label: 'Credits', render: (r) => fmt(r.credits_direct) },
                { key: 'snowflake_cost_usd', label: 'Cost', render: (r) => usd(r.snowflake_cost_usd, 0) },
                { key: 'active_views', label: 'Active views', render: (r) => fmt(r.active_views, 0) },
                { key: 'unit_cost_per_view_usd', label: 'Unit cost / view', render: (r) => usd(r.unit_cost_per_view_usd) },
              ]}
              rows={d.topSpenders}
            />
            <h3>
              Reconciliation{' '}
              <Badge tone={d.reconciliation.every((c) => c.passed) ? 'ok' : 'crit'}>
                {d.reconciliation.every((c) => c.passed) ? 'all pass' : 'FAILED'}
              </Badge>
            </h3>
            <Table
              caption="Reconciliation"
              columns={[
                { key: 'check_name', label: 'Check' },
                { key: 'expected', label: 'Expected', render: (r) => fmt(r.expected) },
                { key: 'actual', label: 'Actual', render: (r) => fmt(r.actual) },
                { key: 'passed', label: 'Pass', render: (r) => (r.passed ? '✔' : '✘') },
              ]}
              rows={d.reconciliation.map((r, i) => ({ ...r, id: i }))}
            />
            <h3>AWS cost per view vs fleet median (users-vs-compute discrepancy)</h3>
            <Table
              caption="AWS flags"
              columns={[
                { key: 'report_id', label: 'Report' },
                { key: 'aws_cost_per_view_usd', label: 'AWS $/view', render: (r) => usd(r.aws_cost_per_view_usd) },
                { key: 'ratio_to_fleet_median', label: '× fleet median', render: (r) => fmt(r.ratio_to_fleet_median) },
              ]}
              rows={d.awsFlags}
            />
            <p className="muted">
              Snowflake is simulated; credits are the logged CSV values per report. Idle and cloud-services credits are 0 because the source
              has none.
            </p>
          </>
        )}
      </Async>
    </section>
  );
}
