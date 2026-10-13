import React from 'react';
import { api } from '../api.js';
import { useAsync } from '../hooks/useAsync.js';
import { Async, Kpi, LineChart, fmt, usd } from '../components/ui.jsx';

export default function Overview() {
  const state = useAsync(() => api('/overview'), []);
  return (
    <section>
      <h2>System health</h2>
      <Async state={state}>
        {(d) => (
          <>
            <div className="kpis">
              <Kpi label={`Reports > 15 s (sweep ${d.latestSweep})`} value={d.kpis.reportsOver15s} tone="warn" />
              <Kpi label="Refresh failures (latest sweep)" value={d.kpis.refreshFailuresLatest} tone="crit" />
              <Kpi label="Orphaned now" value={d.kpis.orphanedNow} tone="warn" />
              <Kpi label="Refresh success rate (excl. UNKNOWN)" value={`${fmt(d.kpis.refreshSuccessRateAll * 100, 1)}%`} />
              <Kpi label="Median latency (s)" value={d.kpis.medianLatencyAllSec} />
              <Kpi label="Unit cost / active view" value={usd(d.kpis.fleetUnitCostUsd)} />
            </div>
            <h3>Average load latency per sweep (dashed = 15 s alert threshold)</h3>
            <LineChart
              label="Average latency per sweep"
              threshold={15}
              points={d.trend.map((t) => ({ x: t.sweep, y: t.avg_latency_sec }))}
            />
            <h3>Refresh success rate per sweep</h3>
            <LineChart
              label="Refresh success rate per sweep"
              points={d.trend.map((t) => ({ x: t.sweep, y: t.refresh_success_rate * 100 }))}
            />
            <p className="muted">
              {d.note} Median latency is above the 15 s threshold, so that rule is saturated in this dataset (see Data Quality).
            </p>
          </>
        )}
      </Async>
    </section>
  );
}
