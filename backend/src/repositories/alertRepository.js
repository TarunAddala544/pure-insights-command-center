const COLUMNS = [
  'id',
  'seq',
  'created_at',
  'sweep',
  'synthetic_ts',
  'report_id',
  'rule',
  'severity',
  'value',
  'threshold',
  'incident_id',
  'incident_state',
  'dedupe_key',
  'source',
  'status',
  'acked_by',
  'acked_at',
];

/** Alert history persisted in the (simulated) warehouse database table ALERTS. */
export class AlertRepository {
  constructor(db) {
    this.db = db;
    this.seq = 0;
  }

  async init() {
    await this.db.run(`CREATE OR REPLACE TABLE ALERTS (
      id VARCHAR, seq INTEGER, created_at VARCHAR, sweep INTEGER, synthetic_ts VARCHAR, report_id VARCHAR,
      rule VARCHAR, severity VARCHAR, value VARCHAR, threshold VARCHAR, incident_id VARCHAR,
      incident_state VARCHAR, dedupe_key VARCHAR, source VARCHAR, status VARCHAR, acked_by VARCHAR, acked_at VARCHAR)`);
    this.seq = 0;
  }

  async insert(event, source) {
    const seq = ++this.seq;
    const record = {
      id: `ALT-${seq}`,
      seq,
      created_at: new Date().toISOString(),
      sweep: event.sweep,
      synthetic_ts: event.syntheticTs,
      report_id: event.reportId,
      rule: event.rule,
      severity: event.severity,
      value: String(event.value),
      threshold: String(event.threshold),
      incident_id: event.incidentId,
      incident_state: event.incidentState,
      dedupe_key: event.dedupeKey,
      source,
      status: 'open',
      acked_by: null,
      acked_at: null,
    };
    await this.db.run(
      `INSERT INTO ALERTS (${COLUMNS.join(',')}) VALUES (${COLUMNS.map(() => '?').join(',')})`,
      COLUMNS.map((c) => record[c]),
    );
    return record;
  }

  async list({ severity, status, rule, limit = 100, offset = 0 }) {
    const where = [];
    const params = [];
    for (const [col, v] of [
      ['severity', severity],
      ['status', status],
      ['rule', rule],
    ]) {
      if (v) {
        where.push(`${col} = ?`);
        params.push(v);
      }
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.all(
      `SELECT ${COLUMNS.join(',')} FROM ALERTS ${clause} ORDER BY seq DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params,
    );
    const [{ n }] = await this.db.all(`SELECT COUNT(*) AS n FROM ALERTS ${clause}`, params);
    return { items: rows, total: n };
  }

  async find(id) {
    const rows = await this.db.all(`SELECT ${COLUMNS.join(',')} FROM ALERTS WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  async setStatus(id, status, actor) {
    await this.db.run('UPDATE ALERTS SET status = ?, acked_by = ?, acked_at = ? WHERE id = ?', [
      status,
      actor,
      new Date().toISOString(),
      id,
    ]);
    return this.find(id);
  }

  async counts() {
    return this.db.all('SELECT severity, status, COUNT(*) AS n FROM ALERTS GROUP BY severity, status');
  }

  async clear() {
    await this.init();
  }
}
