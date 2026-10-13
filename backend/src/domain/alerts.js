import { severityOf, isRefreshFailure } from './clean.js';

export const RULES = { LATENCY: 'LATENCY_GT_15S', REFRESH: 'REFRESH_FAILED' };
const RANK = { WARN: 1, HIGH: 2, CRIT: 3 };
export const severityRank = (s) => RANK[s] ?? 0;

/**
 * Stateful alert engine. Every exceedance/failure produces an event (the brief says "whenever");
 * noise is handled downstream: incident grouping (edge-triggered persistence) and a per-report
 * toast cooldown. State is kept per report.
 */
export class AlertEngine {
  constructor({ thresholds, toastCooldownSweeps }) {
    this.thresholds = thresholds;
    this.cooldown = toastCooldownSweeps;
    this.prevSeverity = new Map();
    this.prevFailure = new Map();
    this.lastToastSweep = new Map();
    this.openIncident = new Map();
    this.incidentSeq = 0;
  }

  /** Evaluates one telemetry row and returns zero, one or two alert events. */
  evaluate(row) {
    const events = [this.#latencyEvent(row), this.#refreshEvent(row)].filter(Boolean);
    this.#applyToastRule(row, events);
    return events;
  }

  #latencyEvent(row) {
    const severity = severityOf(row.avg_load_time_sec, this.thresholds);
    const prev = this.prevSeverity.get(row.reportId) ?? 0;
    const rank = severityRank(severity);
    this.prevSeverity.set(row.reportId, rank);
    if (!severity) {
      this.openIncident.delete(`${row.reportId}:${RULES.LATENCY}`);
      return null;
    }
    const state = prev === 0 ? 'open' : rank > prev ? 'escalated' : 'repeat';
    return this.#build(row, RULES.LATENCY, severity, row.avg_load_time_sec, this.thresholds.warn, state);
  }

  #refreshEvent(row) {
    const failed = isRefreshFailure(row.refreshStatus);
    const prev = this.prevFailure.get(row.reportId) ?? false;
    this.prevFailure.set(row.reportId, failed);
    if (!failed) {
      this.openIncident.delete(`${row.reportId}:${RULES.REFRESH}`);
      return null;
    }
    const severity = row.refreshStatus === 'TIMED_OUT' ? 'HIGH' : 'WARN';
    return this.#build(row, RULES.REFRESH, severity, row.refreshStatus, 'FAILED|TIMED_OUT', prev ? 'repeat' : 'open');
  }

  #build(row, rule, severity, value, threshold, incidentState) {
    const dedupeKey = `${row.reportId}:${rule}`;
    if (incidentState === 'open') this.openIncident.set(dedupeKey, `INC-${++this.incidentSeq}`);
    return {
      sweep: row.sweep,
      reportId: row.reportId,
      rule,
      severity,
      value,
      threshold,
      incidentId: this.openIncident.get(dedupeKey) ?? null,
      incidentState,
      dedupeKey,
      persisted: incidentState === 'open' || incidentState === 'escalated',
      toast: false,
    };
  }

  /** UI toast rule: CRIT latency or any refresh failure, at most one toast per report per cooldown. */
  #applyToastRule(row, events) {
    const flagged = events.filter((e) => e.rule === RULES.REFRESH || e.severity === 'CRIT');
    if (flagged.length === 0) return;
    const last = this.lastToastSweep.get(row.reportId) ?? -99;
    if (row.sweep - last > this.cooldown) {
      this.lastToastSweep.set(row.reportId, row.sweep);
      flagged[0].toast = true;
    }
  }
}
