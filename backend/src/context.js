import { loadConfig } from './config/index.js';
import { ingest } from './domain/clean.js';
import { Database } from './repositories/db.js';
import { buildWarehouse } from './repositories/warehouseRepository.js';
import { AlertRepository } from './repositories/alertRepository.js';
import { UserRepository } from './repositories/userRepository.js';
import { AuditRepository } from './repositories/auditRepository.js';
import { AuthService } from './services/authService.js';
import { AnalyticsService } from './services/analyticsService.js';
import { AlertService } from './services/alertService.js';
import { Hub } from './ws/hub.js';
import { ReplayService } from './sim/replay.js';
import { createLogger } from './utils/logger.js';

/** Composition root: wires repositories -> services -> hub/replay. No globals. */
export async function createContext(env = process.env) {
  const cfg = loadConfig(env);
  const logger = createLogger(env.LOG_LEVEL ?? 'info');
  const data = ingest(cfg.csvPath);
  const db = await Database.open(cfg.dbPath);
  await buildWarehouse(db, data.rows, cfg.sqlDir, cfg.creditPriceUsd);
  const alertRepo = new AlertRepository(db);
  await alertRepo.init();
  const users = new UserRepository(cfg.demoPassword);
  const audit = new AuditRepository();
  const ctx = { cfg, logger, data, db, alertRepo, users, audit };
  ctx.auth = new AuthService({ users, cfg, audit });
  ctx.analytics = new AnalyticsService({ db, data, cfg, audit });
  ctx.hub = new Hub({
    jwtSecret: cfg.jwtSecret,
    heartbeatMs: cfg.heartbeatMs,
    logger,
    onAckRequest: async (id, user) => ctx.alerts.acknowledge(id, user).catch(() => null),
  });
  ctx.alerts = new AlertService({ alertRepo, hub: ctx.hub, audit, cfg });
  ctx.replay = new ReplayService({ rows: data.rows, cfg, alertService: ctx.alerts, hub: ctx.hub, alertRepo, logger });
  return ctx;
}
