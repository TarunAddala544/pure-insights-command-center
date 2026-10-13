/** Structured JSON logger (one line per event). Silenced when LOG_LEVEL=silent (tests). */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export function createLogger(level = process.env.LOG_LEVEL ?? 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl, msg, fields) => {
    if (LEVELS[lvl] < threshold) return;
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...fields })}\n`);
  };
  return Object.fromEntries(['debug', 'info', 'warn', 'error'].map((l) => [l, (msg, fields = {}) => emit(l, msg, fields)]));
}
