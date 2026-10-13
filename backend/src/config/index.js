import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const num = (env, name, fallback) => {
  const raw = env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (Number.isNaN(value)) throw new Error(`Env ${name} must be numeric`);
  return value;
};

/** Builds configuration from an env map so tests can pass overrides explicitly. */
export function loadConfig(env = process.env) {
  const get = (k, d) => env[k] ?? d;
  return {
    root,
    port: num(env, 'PORT', 4000),
    jwtSecret: get('JWT_SECRET', 'dev-only-secret-change-me'),
    jwtExpiresIn: get('JWT_EXPIRES_IN', '8h'),
    demoPassword: get('DEMO_PASSWORD', 'Passw0rd!'),
    dbPath: get('DB_PATH', ':memory:'),
    csvPath: path.join(root, 'data', 'Case_Study_3_Pure_Insights_Monitoring.csv'),
    sqlDir: path.join(root, 'sql'),
    thresholds: {
      warn: num(env, 'LATENCY_WARN_SEC', 15),
      high: num(env, 'LATENCY_HIGH_SEC', 30),
      crit: num(env, 'LATENCY_CRIT_SEC', 45),
    },
    replay: {
      tickMs: num(env, 'REPLAY_TICK_MS', 3000),
      autostart: get('REPLAY_AUTOSTART', 'true') === 'true',
    },
    toastCooldownSweeps: num(env, 'TOAST_COOLDOWN_SWEEPS', 3),
    creditPriceUsd: num(env, 'CREDIT_PRICE_USD', 3),
    heartbeatMs: num(env, 'WS_HEARTBEAT_MS', 15000),
  };
}
