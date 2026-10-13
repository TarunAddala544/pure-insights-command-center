/** Append-only in-memory audit log of privileged actions. */
export class AuditRepository {
  constructor() {
    this.entries = [];
  }

  record(actor, action, target, detail = {}) {
    this.entries.unshift({ id: this.entries.length + 1, at: new Date().toISOString(), actor, action, target, detail });
  }

  list(limit = 100) {
    return this.entries.slice(0, limit);
  }
}
