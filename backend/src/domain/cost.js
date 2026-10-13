import { round } from './clean.js';

/** Safe division: returns null instead of Infinity/NaN. */
export const safeDivide = (num, den) => (den === 0 || den == null ? null : num / den);

/**
 * Per-report attribution over CLEAN rows only. Numerator and denominator share the same row set;
 * unit cost is a ratio of sums, never a mean of row ratios.
 */
export function attributeByReport(cleanRows, pricePerCredit) {
  const acc = new Map();
  for (const r of cleanRows) {
    const a = acc.get(r.reportId) ?? { reportId: r.reportId, credits: 0, views: 0, queries: 0, aws: 0 };
    a.credits += r.snowflake_credits_consumed;
    a.views += r.monthly_active_views;
    a.queries += r.query_count_last_30d;
    a.aws += r.aws_hosting_cost_usd;
    acc.set(r.reportId, a);
  }
  return [...acc.values()].map((a) => ({
    ...a,
    credits: round(a.credits, 2),
    costUsd: round(a.credits * pricePerCredit, 2),
    unitCostPerView: safeDivide(a.credits * pricePerCredit, a.views),
  }));
}

export function fleetUnitCost(cleanRows, pricePerCredit) {
  const credits = cleanRows.reduce((s, r) => s + r.snowflake_credits_consumed, 0);
  const views = cleanRows.reduce((s, r) => s + r.monthly_active_views, 0);
  return safeDivide(credits * pricePerCredit, views);
}
