import { AlertEngine } from '../domain/alerts.js';
import { REPORTS_PER_SWEEP } from '../domain/clean.js';

/** Replays cleaned CSV events as a live stream: one sweep (100 reports) per tick. */
export class ReplayService {
  constructor({ rows, cfg, alertService, hub, alertRepo, logger }) {
    this.rows = rows;
    this.cfg = cfg;
    this.alerts = alertService;
    this.hub = hub;
    this.alertRepo = alertRepo;
    this.logger = logger;
    this.totalSweeps = Math.ceil(rows.length / REPORTS_PER_SWEEP);
    this.position = 0;
    this.state = 'paused';
    this.emitted = { firings: 0, persisted: 0, toasts: 0 };
    this.#freshEngine();
  }

  #freshEngine() {
    this.engine = new AlertEngine({ thresholds: this.cfg.thresholds, toastCooldownSweeps: this.cfg.toastCooldownSweeps });
  }

  status() {
    return {
      state: this.state,
      sweep: this.position,
      totalSweeps: this.totalSweeps,
      tickMs: this.cfg.replay.tickMs,
      emitted: { ...this.emitted },
    };
  }

  start() {
    if (this.state === 'finished' || this.timer) return this.status();
    this.state = 'running';
    if (this.cfg.replay.tickMs > 0) {
      this.timer = setInterval(
        () => this.step().catch((e) => this.logger.error('replay step failed', { error: e.message })),
        this.cfg.replay.tickMs,
      );
      this.timer.unref();
    }
    this.#broadcastStatus();
    return this.status();
  }

  pause() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.state === 'running') this.state = 'paused';
    this.#broadcastStatus();
    return this.status();
  }

  async reset() {
    this.pause();
    this.position = 0;
    this.state = 'paused';
    this.emitted = { firings: 0, persisted: 0, toasts: 0 };
    this.#freshEngine();
    await this.alertRepo.clear();
    this.#broadcastStatus();
    return this.status();
  }

  /** Processes the next sweep; returns the number of alert events emitted. */
  async step() {
    if (this.position >= this.totalSweeps) {
      this.pause();
      this.state = 'finished';
      this.#broadcastStatus();
      return 0;
    }
    const start = this.position * REPORTS_PER_SWEEP;
    let count = 0;
    for (const row of this.rows.slice(start, start + REPORTS_PER_SWEEP)) {
      for (const event of this.engine.evaluate(row)) {
        const out = await this.alerts.publish(event, 'replay');
        count += 1;
        this.emitted.firings += 1;
        if (out.persisted) this.emitted.persisted += 1;
        if (out.toast) this.emitted.toasts += 1;
      }
    }
    this.position += 1;
    if (this.position >= this.totalSweeps) {
      this.pause();
      this.state = 'finished';
    }
    this.hub.broadcast('telemetry', { sweep: this.position, emitted: this.emitted, connections: this.hub.size }, 'ops');
    this.#broadcastStatus();
    return count;
  }

  async runAll() {
    while (this.position < this.totalSweeps) await this.step();
  }

  #broadcastStatus() {
    this.hub.broadcast('replay_status', this.status(), 'ops');
  }
}
