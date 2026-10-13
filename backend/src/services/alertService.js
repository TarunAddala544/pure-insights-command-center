import { AlertEngine } from '../domain/alerts.js';
import { notFound, conflict } from '../utils/errors.js';
import { syntheticTimestamp } from '../repositories/warehouseRepository.js';

/** Turns engine events into persisted alerts (incident-level) and live WebSocket messages (every firing). */
export class AlertService {
  constructor({ alertRepo, hub, audit, cfg }) {
    this.repo = alertRepo;
    this.hub = hub;
    this.audit = audit;
    this.cfg = cfg;
  }

  async publish(event, source = 'replay') {
    const withTs = { ...event, syntheticTs: syntheticTimestamp(event.sweep), source };
    let id = null;
    if (event.persisted) {
      id = (await this.repo.insert(withTs, source)).id;
    }
    this.hub.broadcast('alert', { ...withTs, id });
    return { ...withTs, id };
  }

  /** Admin demo hook: builds a one-off event through a fresh engine so replay state is untouched. */
  async inject({ reportId, latencySec, refreshStatus }, actor, sweep = 0) {
    const engine = new AlertEngine({ thresholds: this.cfg.thresholds, toastCooldownSweeps: this.cfg.toastCooldownSweeps });
    const row = { sweep, reportId, avg_load_time_sec: latencySec ?? 1, refreshStatus: refreshStatus ?? 'SUCCESS' };
    const events = engine.evaluate(row).map((e) => ({ ...e, persisted: true, toast: true }));
    const published = [];
    for (const e of events) published.push(await this.publish(e, 'inject'));
    this.audit.record(actor.email, 'alert.inject', reportId, { latencySec, refreshStatus });
    return published;
  }

  list(query) {
    return this.repo.list(query);
  }

  async acknowledge(id, actor, status = 'acknowledged') {
    const alert = await this.repo.find(id);
    if (!alert) throw notFound(`Alert ${id} not found`);
    if (alert.status === 'resolved') throw conflict('Alert already resolved');
    const updated = await this.repo.setStatus(id, status, actor.email);
    this.audit.record(actor.email, `alert.${status}`, id);
    this.hub.broadcast('incident_update', { id, status, by: actor.email });
    return updated;
  }
}
