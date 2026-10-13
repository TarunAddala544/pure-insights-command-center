import React from 'react';
import { api } from '../api.js';
import { useAsync } from '../hooks/useAsync.js';
import { Async, Table, fmt } from '../components/ui.jsx';

export default function DataQuality() {
  const state = useAsync(
    () => Promise.all([api('/data-quality'), api('/quarantine')]).then(([dq, q]) => ({ ...dq, quarantine: q.items })),
    [],
  );
  return (
    <section>
      <h2>Data quality</h2>
      <Async state={state}>
        {(d) => (
          <>
            {d.defects.map((x) => (
              <article key={x.code} className="card">
                <h3>
                  {x.title} <span className="badge warn">{fmt(x.affectedRows, 0)} rows</span>
                </h3>
                <dl>
                  <dt>Detection rule</dt>
                  <dd>{x.rule}</dd>
                  <dt>Treatment</dt>
                  <dd>{x.treatment}</dd>
                  <dt>Rationale</dt>
                  <dd>{x.rationale}</dd>
                  <dt>Before → after</dt>
                  <dd>
                    {x.before} → {x.after}
                  </dd>
                </dl>
              </article>
            ))}
            <h3>Additional findings</h3>
            <Table
              caption="Additional findings"
              columns={[
                { key: 'code', label: 'Code' },
                { key: 'affectedRows', label: 'Rows' },
                { key: 'note', label: 'Note' },
              ]}
              rows={d.additionalFindings.map((r) => ({ ...r, id: r.code }))}
            />
            <h3>Quarantine (negative credits, raw values kept)</h3>
            <Table
              caption="Quarantine"
              columns={[
                { key: 'snapshot_id', label: 'Snapshot' },
                { key: 'report_id', label: 'Report' },
                { key: 'sweep', label: 'Sweep' },
                { key: 'raw_value', label: 'Raw credits' },
              ]}
              rows={d.quarantine.map((r) => ({ ...r, id: r.snapshot_id }))}
            />
          </>
        )}
      </Async>
    </section>
  );
}
