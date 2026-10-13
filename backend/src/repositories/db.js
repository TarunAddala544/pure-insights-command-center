import fs from 'node:fs';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const SCHEMA = 'ACCOUNT_USAGE_SIM';

/** Thin DuckDB wrapper. DuckDB stands in for Snowflake locally (see docs/DECISIONS.md). */
export class Database {
  static async open(dbPath = ':memory:') {
    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    const db = new Database(connection);
    await connection.run(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await connection.run(`SET schema='${SCHEMA}'`);
    return db;
  }

  constructor(connection) {
    this.connection = connection;
    this.queue = Promise.resolve();
  }

  /** One DuckDB connection is not safe for concurrent queries (native crash), so every query waits its turn. */
  enqueue(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  /** Runs a query and returns plain JS rows (BigInt/Decimal normalised to numbers). */
  all(sql, params = []) {
    const [text, values] = inlineNulls(sql, params);
    return this.enqueue(async () => {
      const reader = values.length ? await this.connection.runAndReadAll(text, values) : await this.connection.runAndReadAll(text);
      return reader.getRowObjectsJson().map(normaliseRow);
    });
  }

  run(sql, params = []) {
    const [text, values] = inlineNulls(sql, params);
    return this.enqueue(async () => {
      if (values.length) await this.connection.run(text, values);
      else await this.connection.run(text);
    });
  }

  /** Executes every statement of a SQL file; comment-only lines are stripped before splitting. */
  async runSqlFile(file) {
    const text = fs.readFileSync(file, 'utf8');
    const statements = splitStatements(text);
    const results = [];
    for (const stmt of statements) results.push(await this.all(stmt));
    return results;
  }

  async runSuite(sqlDir, files) {
    for (const f of files) await this.runSqlFile(path.join(sqlDir, f));
  }
}

/** The DuckDB binder rejects null parameters, so null placeholders become literal NULL. */
export function inlineNulls(sql, params) {
  let i = 0;
  const kept = [];
  const text = sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === null || v === undefined) return 'NULL';
    kept.push(v);
    return '?';
  });
  return [text, kept];
}

export function splitStatements(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normaliseRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v) ? Number(v) : v,
    ]),
  );
}
