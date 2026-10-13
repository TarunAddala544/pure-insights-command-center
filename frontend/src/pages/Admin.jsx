import React, { useState } from 'react';
import { api } from '../api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useLiveAlerts } from '../alerts.jsx';
import { Async, Table } from '../components/ui.jsx';

export default function Admin() {
  const users = useAsync(() => api('/users'), []);
  const audit = useAsync(() => api('/audit'), []);
  const live = useLiveAlerts();
  const [msg, setMsg] = useState('');
  const [reportId, setReportId] = useState('RPT_210');
  const [latency, setLatency] = useState(20);

  const run = async (path, body) => {
    try {
      await api(path, { method: path.startsWith('/users') ? 'PATCH' : 'POST', body });
      setMsg('Done');
      users.reload();
      audit.reload();
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <section>
      <h2>Admin</h2>
      <h3>Replay control ({live.replay ? `${live.replay.state}, sweep ${live.replay.sweep}/${live.replay.totalSweeps}` : '…'})</h3>
      <div className="inline">
        <button onClick={() => run('/replay/start')}>Start</button>
        <button onClick={() => run('/replay/pause')}>Pause</button>
        <button
          onClick={() => {
            live.clearFeed();
            run('/replay/reset');
          }}
        >
          Reset
        </button>
      </div>
      <h3>Inject test event</h3>
      <div className="inline">
        <input aria-label="Report id" value={reportId} onChange={(e) => setReportId(e.target.value)} />
        <input aria-label="Latency seconds" type="number" value={latency} onChange={(e) => setLatency(Number(e.target.value))} />
        <button onClick={() => run('/alerts/inject', { reportId, latencySec: latency })}>Inject latency</button>
        <button onClick={() => run('/alerts/inject', { reportId, refreshStatus: 'FAILED' })}>Inject refresh failure</button>
      </div>
      {msg && <p role="status">{msg}</p>}
      <h3>Users</h3>
      <Async state={users}>
        {(d) => (
          <Table
            caption="Users"
            columns={[
              { key: 'email', label: 'Email' },
              {
                key: 'role',
                label: 'Role',
                render: (u) => (
                  <select
                    value={u.role}
                    aria-label={`Role for ${u.email}`}
                    onChange={(e) => run(`/users/${u.id}`, { role: e.target.value })}
                  >
                    {['admin', 'analyst', 'viewer'].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                ),
              },
              {
                key: 'active',
                label: 'Active',
                render: (u) => (
                  <input
                    type="checkbox"
                    checked={u.active}
                    aria-label={`Active ${u.email}`}
                    onChange={(e) => run(`/users/${u.id}`, { active: e.target.checked })}
                  />
                ),
              },
            ]}
            rows={d.items}
          />
        )}
      </Async>
      <h3>Audit log</h3>
      <Async state={audit}>
        {(d) => (
          <Table
            caption="Audit log"
            columns={[
              { key: 'at', label: 'When' },
              { key: 'actor', label: 'Actor' },
              { key: 'action', label: 'Action' },
              { key: 'target', label: 'Target' },
            ]}
            rows={d.items.slice(0, 15)}
          />
        )}
      </Async>
    </section>
  );
}
