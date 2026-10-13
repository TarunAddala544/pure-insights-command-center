import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Async, Badge, Table } from '../components/ui.jsx';

function AssignForm({ reportId, onDone }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api(`/orphans/${reportId}/assign`, { method: 'POST', body: { ownerEmail: email } });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="inline" onSubmit={submit}>
      <input
        type="email"
        required
        placeholder="owner@company.com"
        aria-label={`Owner for ${reportId}`}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button>Assign</button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

export default function Orphans() {
  const { can } = useAuth();
  const state = useAsync(() => api('/orphans'), []);
  const [filter, setFilter] = useState('ALL');
  return (
    <section>
      <h2>Orphaned reports</h2>
      <Async state={state}>
        {(d) => {
          const rows = d.orphanedNow.filter((r) => filter === 'ALL' || r.orphan_reason === filter);
          const chronicIds = new Set(d.chronic.map((c) => c.report_id));
          const columns = [
            { key: 'report_id', label: 'Report' },
            { key: 'report_name', label: 'Name' },
            {
              key: 'orphan_reason',
              label: 'Why',
              render: (r) => <Badge tone="warn">{r.orphan_reason === 'SENTINEL' ? 'ORPHANED_REPORT' : 'owner missing (nan)'}</Badge>,
            },
            { key: 'chronic', label: 'Chronic', render: (r) => (chronicIds.has(r.report_id) ? <Badge tone="crit">chronic</Badge> : '—') },
            { key: 'views', label: 'Monthly views' },
            {
              key: 'assign',
              label: 'Action',
              render: (r) =>
                can('orphans:assign') ? (
                  <AssignForm reportId={r.report_id} onDone={state.reload} />
                ) : (
                  <span className="muted" title="Admin only">
                    Admin only
                  </span>
                ),
            },
          ];
          return (
            <>
              <p>
                {rows.length} orphaned in the latest sweep; {d.chronic.length} chronic (orphaned in ≥ 2 of the last 5 sweeps). Row-level
                orphan rate across all snapshots: {(d.rowLevelOrphanRate * 100).toFixed(1)}%.
              </p>
              <label>
                Filter{' '}
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="ALL">All</option>
                  <option value="MISSING">Missing / nan</option>
                  <option value="SENTINEL">ORPHANED_REPORT</option>
                </select>
              </label>
              {rows.length === 0 ? (
                <p className="muted">No orphaned reports match.</p>
              ) : (
                <Table caption="Orphaned reports" columns={columns} rows={rows} />
              )}
              {d.assigned.length > 0 && (
                <>
                  <h3>Assigned this session</h3>
                  <Table
                    caption="Assigned owners"
                    columns={[
                      { key: 'report_id', label: 'Report' },
                      { key: 'owner_email', label: 'Owner' },
                      { key: 'assigned_by', label: 'By' },
                    ]}
                    rows={d.assigned}
                  />
                </>
              )}
            </>
          );
        }}
      </Async>
    </section>
  );
}
