import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLiveAlerts } from '../alerts.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Async, Badge, Table, severityTone } from '../components/ui.jsx';

export default function Alerts() {
  const { can } = useAuth();
  const live = useLiveAlerts();
  const [severity, setSeverity] = useState('');
  const history = useAsync(() => api(`/alerts?limit=50${severity ? `&severity=${severity}` : ''}`), [severity, live.reconnects]);
  const act = async (id, action) => {
    await api(`/alerts/${id}/${action}`, { method: 'POST' });
    history.reload();
  };
  const liveCols = [
    { key: 'sweep', label: 'Sweep' },
    { key: 'reportId', label: 'Report' },
    { key: 'rule', label: 'Rule' },
    { key: 'severity', label: 'Severity', render: (a) => <Badge tone={severityTone(a.severity)}>{a.severity}</Badge> },
    { key: 'value', label: 'Value' },
    { key: 'incidentState', label: 'Incident' },
    { key: 'source', label: 'Source' },
  ];
  const histCols = [
    { key: 'id', label: 'ID' },
    { key: 'report_id', label: 'Report' },
    { key: 'rule', label: 'Rule' },
    { key: 'severity', label: 'Severity', render: (a) => <Badge tone={severityTone(a.severity)}>{a.severity}</Badge> },
    { key: 'value', label: 'Value' },
    { key: 'status', label: 'Status' },
    {
      key: 'act',
      label: 'Action',
      render: (a) =>
        can('alerts:ack') ? (
          <>
            <button disabled={a.status !== 'open'} onClick={() => act(a.id, 'ack')}>
              Ack
            </button>
            <button disabled={a.status === 'resolved'} onClick={() => act(a.id, 'resolve')}>
              Resolve
            </button>
          </>
        ) : (
          <span className="muted">read-only</span>
        ),
    },
  ];
  return (
    <section>
      <h2>
        Live alerts <Badge tone={live.status === 'open' ? 'ok' : 'crit'}>{live.status === 'open' ? 'connected' : live.status}</Badge>
      </h2>
      <p className="muted">
        Replay:{' '}
        {live.replay ? `${live.replay.state}, sweep ${live.replay.sweep}/${live.replay.totalSweeps}` : 'status visible to analyst/admin'}.
        Every firing streams here; toasts show CRIT latency and refresh failures only.
      </p>
      {live.feed.length === 0 ? (
        <p className="muted">Waiting for alerts… (admin can start replay or inject a test event)</p>
      ) : (
        <Table
          caption="Live alert feed"
          columns={liveCols}
          rows={live.feed.slice(0, 40).map((a, i) => ({ ...a, id: `${a.dedupeKey}-${a.sweep}-${i}` }))}
        />
      )}
      <h3>Alert history (stored incidents)</h3>
      <label>
        Severity{' '}
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All</option>
          <option>WARN</option>
          <option>HIGH</option>
          <option>CRIT</option>
        </select>
      </label>
      <Async state={history} isEmpty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <p>{d.total} stored incidents</p>
            <Table caption="Alert history" columns={histCols} rows={d.items} />
          </>
        )}
      </Async>
    </section>
  );
}
