"""Independent pandas verifier. Recomputes every golden number from the raw CSV
with no shared code with the Node backend. Writes validation/golden.json."""
import hashlib, json, pathlib
import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "Case_Study_3_Pure_Insights_Monitoring.csv"
PRICE = 3.0
COOLDOWN = 3
ORPHAN_TOKENS = {"", "nan", "none", "null", "orphaned_report"}


def severity(v):
    return 0 if v <= 15 else 1 if v <= 30 else 2 if v <= 45 else 3


def load():
    df = pd.read_csv(CSV, keep_default_na=False, dtype=str)
    for c in ["monthly_active_views", "query_count_last_30d", "concurrent_user_peak"]:
        df[c] = df[c].astype(int)
    for c in ["snowflake_credits_consumed", "avg_load_time_sec", "aws_hosting_cost_usd"]:
        df[c] = df[c].astype(float)
    df["sweep"] = np.arange(len(df)) // 100
    df["orphan"] = df.owner_email.str.strip().str.lower().isin(ORPHAN_TOKENS)
    df["quarantined"] = df.snowflake_credits_consumed < 0
    return df


def incidents(df):
    """Edge-triggered incident model + toast rule, per handoff section 3."""
    stored = {"latency_open": 0, "latency_escalated": 0, "refresh": 0}
    firings = {"latency": 0, "refresh": 0}
    toasts, last_emit = 0, {}
    prev_sev, prev_fail = {}, {}
    for r in df.itertuples():
        sev = severity(r.avg_load_time_sec)
        fail = r.last_refresh_status in ("FAILED", "TIMED_OUT")
        p = prev_sev.get(r.report_id, 0)
        if sev > 0:
            firings["latency"] += 1
            if p == 0:
                stored["latency_open"] += 1
            elif sev > p:
                stored["latency_escalated"] += 1
        if fail:
            firings["refresh"] += 1
            if not prev_fail.get(r.report_id, False):
                stored["refresh"] += 1
        flag = r.avg_load_time_sec > 45 or fail
        if flag and r.sweep - last_emit.get(r.report_id, -99) > COOLDOWN:
            toasts += 1
            last_emit[r.report_id] = r.sweep
        prev_sev[r.report_id], prev_fail[r.report_id] = sev, fail
    stored["total"] = sum(stored.values())
    return firings, stored, toasts


def main():
    df = load()
    clean = df[~df.quarantined]
    last = df[df.sweep == 19]
    firings, stored, toasts = incidents(df)
    rep = clean.groupby("report_id").agg(
        credits=("snowflake_credits_consumed", "sum"),
        views=("monthly_active_views", "sum"),
        queries=("query_count_last_30d", "sum"),
        aws=("aws_hosting_cost_usd", "sum"),
    )
    rep["unit_cost"] = rep.credits * PRICE / rep.views
    nz = df[df.monthly_active_views > 0].copy()
    x = np.log(nz.aws_hosting_cost_usd / nz.monthly_active_views)
    mad = (x - x.median()).abs().median()
    z = (x - x.median()) / (1.4826 * mad)
    ok = df.last_refresh_status.isin(["SUCCESS", "FAILED", "TIMED_OUT"])
    succ = (df.last_refresh_status == "SUCCESS")
    chronic = df[(df.sweep >= 15) & df.orphan].groupby("report_id").size()
    golden = {
        "csv_sha256": hashlib.sha256(CSV.read_bytes()).hexdigest(),
        "price_per_credit": PRICE,
        "rows": len(df), "clean_rows": int((~df.quarantined).sum()),
        "quarantined_rows": int(df.quarantined.sum()),
        "orphan_rows": int(df.orphan.sum()),
        "orphan_nan_rows": int((df.owner_email.str.strip().str.lower() == "nan").sum()),
        "orphan_token_rows": int((df.owner_email.str.strip().str.lower() == "orphaned_report").sum()),
        "orphaned_now": int(last.orphan.sum()),
        "orphan_chronic": int((chronic >= 2).sum()),
        "negative_credit_sum": round(float(df.loc[df.quarantined, "snowflake_credits_consumed"].sum()), 2),
        "raw_credit_total": round(float(df.snowflake_credits_consumed.sum()), 2),
        "clean_credit_total": round(float(clean.snowflake_credits_consumed.sum()), 2),
        "latency_gt15": int((df.avg_load_time_sec > 15).sum()),
        "latency_exactly15": int((df.avg_load_time_sec == 15).sum()),
        "latency_max": float(df.avg_load_time_sec.max()),
        "sev_warn": int(df.avg_load_time_sec.between(15, 30, inclusive="right").sum()),
        "sev_high": int(df.avg_load_time_sec.between(30, 45, inclusive="right").sum()),
        "sev_crit": int((df.avg_load_time_sec > 45).sum()),
        "refresh_success": int(succ.sum()),
        "refresh_failed": int((df.last_refresh_status == "FAILED").sum()),
        "refresh_timed_out": int((df.last_refresh_status == "TIMED_OUT").sum()),
        "refresh_unknown": int((df.last_refresh_status == "UNKNOWN").sum()),
        "success_rate_excl_unknown": round(float(succ.sum() / ok.sum()), 4),
        "zero_view_rows": int((df.monthly_active_views == 0).sum()),
        "peak_gt_views_rows": int((df.concurrent_user_peak > df.monthly_active_views).sum()),
        "views_aws_pearson": round(float(df.monthly_active_views.corr(df.aws_hosting_cost_usd)), 4),
        "cost_outliers_z35": int((z.abs() > 3.5).sum()),
        "fleet_unit_cost": round(float(clean.snowflake_credits_consumed.sum() * PRICE / clean.monthly_active_views.sum()), 4),
        "unit_cost_min": round(float(rep.unit_cost.min()), 4),
        "unit_cost_median": round(float(rep.unit_cost.median()), 4),
        "unit_cost_max": round(float(rep.unit_cost.max()), 4),
        "latest_sweep": {
            "latency_gt15": int((last.avg_load_time_sec > 15).sum()),
            "crit": int((last.avg_load_time_sec > 45).sum()),
            "refresh_failures": int(last.last_refresh_status.isin(["FAILED", "TIMED_OUT"]).sum()),
            "unknown": int((last.last_refresh_status == "UNKNOWN").sum()),
            "orphans": int(last.orphan.sum()),
        },
        "alert_firings": firings,
        "alert_stored_incidents": stored,
        "alert_toasts": toasts,
        "per_report": {k: {"credits": round(float(v.credits), 2), "views": int(v.views),
                           "unit_cost": round(float(v.unit_cost), 6)} for k, v in rep.iterrows()},
    }
    (ROOT / "validation" / "golden.json").write_text(json.dumps(golden, indent=2, sort_keys=True) + "\n")
    print(json.dumps({k: v for k, v in golden.items() if k != "per_report"}, indent=1))


if __name__ == "__main__":
    main()
