import React from 'react';

/** Renders loading / error / empty states consistently, then the children render-prop. */
export function Async({ state, children, isEmpty }) {
  if (state.loading && !state.data)
    return (
      <p className="muted" role="status">
        Loading…
      </p>
    );
  if (state.error) {
    return (
      <p className="error" role="alert">
        {state.error.status === 403 ? 'Your role cannot view this.' : state.error.message}
        <button onClick={state.reload}>Retry</button>
      </p>
    );
  }
  if (state.data && isEmpty?.(state.data)) return <p className="muted">Nothing to show.</p>;
  return state.data ? children(state.data) : null;
}

export const Kpi = ({ label, value, tone }) => (
  <div className={`kpi ${tone ?? ''}`}>
    <div className="kpi-value">{value}</div>
    <div className="kpi-label">{label}</div>
  </div>
);

export const Badge = ({ tone, children }) => <span className={`badge ${tone}`}>{children}</span>;

export const severityTone = (s) => ({ CRIT: 'crit', HIGH: 'high', WARN: 'warn' })[s] ?? 'ok';

export const fmt = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
export const usd = (v, d = 2) => (v == null ? '—' : `$${fmt(v, d)}`);

export function Table({ columns, rows, caption }) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? r.report_id ?? i}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dependency-free SVG line chart with an optional threshold line. */
export function LineChart({ points, label, threshold, height = 140 }) {
  const w = 600;
  const max = Math.max(...points.map((p) => p.y), threshold ?? 0) * 1.1 || 1;
  const x = (i) => 30 + (i * (w - 40)) / Math.max(points.length - 1, 1);
  const y = (v) => height - 20 - (v / max) * (height - 30);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label} className="chart">
      {threshold != null && <line x1="30" x2={w - 10} y1={y(threshold)} y2={y(threshold)} className="threshold" />}
      <polyline fill="none" className="series" points={points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ')} />
      {points.map((p, i) => (
        <circle key={p.x} cx={x(i)} cy={y(p.y)} r="3">
          <title>{`sweep ${p.x}: ${fmt(p.y)}`}</title>
        </circle>
      ))}
      <text x="30" y={height - 4} className="axis">
        sweep 0 → {points.length - 1} (synthetic days)
      </text>
    </svg>
  );
}
