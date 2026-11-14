#!/usr/bin/env python3
"""
Suspicion scan for merge-time features (HOK-3023, Phase 4).

On development repos only (evaluation-slice repos are dropped before anything is
read), against the 30-day `corrective_rework` label:

  1. single-feature AUC for every arm input, pooled and averaged within repo,
     plus the AUC of each feature's null indicator
  2. null rate per feature by merge quarter, and how well each feature alone
     tells the last six months from earlier ones (a feature that does can carry
     the period into a model)
  3. agent-marker rate by quarter
  4. a gradient-boosted model with and without the `feature.agent.*` inputs, on a
     temporal split and on repo-grouped folds, and markers alone

A leaked feature shows up as a single-feature AUC far from 0.5, or as a null rate
that tracks time. The output holds pooled figures only: no repo names, per-repo
values or PR identifiers.

Usage:
  python3 scripts/corpus/audit-feature-suspicion.py \
    --manifest <cohort.json> --cache-dir ~/hokusai-data/arbiter-corpus \
    --exclude-slice ~/.hokusai-private/hok-3028-slice.json \
    --feature-manifest <print-manifest.json> --out <pooled.json>
"""

import argparse
import gzip
import hashlib
import json
import math
import os
from collections import defaultdict

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GroupKFold

RUNNABLE = {"kept", "pending_exception", "unmeasured"}
HORIZON = 30
RECENT_FROM = "2026-02-01"
SUSPICIOUS_AUC = 0.75
NULL_SWING = 0.20


def quarter(at):
    return f"{at[:4]}Q{(int(at[5:7]) - 1) // 3 + 1}"


def auc(y, x):
    if len(set(y)) < 2 or len(set(x)) < 2:
        return None
    return float(roc_auc_score(y, x))


def oriented(value):
    return None if value is None else max(value, 1 - value)


def main():
    p = argparse.ArgumentParser()
    for name in ("manifest", "cache-dir", "exclude-slice", "feature-manifest", "out"):
        p.add_argument(f"--{name}", required=True)
    args = p.parse_args()

    slice_bytes = open(os.path.expanduser(args.exclude_slice), "rb").read()
    sealed = set(json.loads(slice_bytes)["repos"])
    cohort = json.load(open(args.manifest))
    repos = [e["repo"] for e in cohort["repos"] + cohort.get("alternates", []) if e["status"] in RUNNABLE and e["repo"] not in sealed]
    entries = json.load(open(args.feature_manifest))["entries"]
    inputs = [e for e in entries if not e["segment"] and e["kind"] != "content_sha256"]
    categories = {e["name"]: e["categories"] for e in inputs if e["kind"] == "category"}
    cache = os.path.expanduser(args.cache_dir)

    rows, labels, groups, as_of = [], [], [], []
    for gid, repo in enumerate(repos):
        d = os.path.join(cache, repo.replace("/", "__"))
        target = {}
        for line in gzip.open(os.path.join(d, "corrective.jsonl.gz"), "rt"):
            r = json.loads(line)
            if r["horizon_days"] == HORIZON and r["corrective"] is not None:
                target[int(r["prUrl"].rsplit("/", 1)[1])] = int(r["corrective"])
        for line in gzip.open(os.path.join(d, "features.jsonl.gz"), "rt"):
            r = json.loads(line)
            if r["pr_number"] in target:
                rows.append(r["features"])
                labels.append(target[r["pr_number"]])
                groups.append(gid)
                as_of.append(r["as_of"])
    y = np.array(labels)
    groups = np.array(groups)
    quarters = [quarter(a) for a in as_of]
    recent = np.array([int(a >= RECENT_FROM) for a in as_of])
    n = len(rows)

    def column(name):
        out = np.full(n, np.nan)
        if name in categories:
            # Encoded by the category's positive rate, so one AUC summarises the column.
            values = [r[name] for r in rows]
            rate = defaultdict(lambda: [0, 0])
            for v, t in zip(values, labels):
                if v is not None:
                    rate[v][0] += t
                    rate[v][1] += 1
            for i, v in enumerate(values):
                if v is not None:
                    out[i] = rate[v][0] / rate[v][1]
            return out
        for i, r in enumerate(rows):
            v = r[name]
            if v is not None:
                out[i] = float(v)
        return out

    features = {}
    for e in inputs:
        x = column(e["name"])
        present = ~np.isnan(x)
        within = []
        for g in np.unique(groups):
            m = present & (groups == g)
            a = auc(y[m], x[m])
            if a is not None:
                within.append((a, int(y[m].sum())))
        weight = sum(w for _, w in within)
        within_auc = sum(a * w for a, w in within) / weight if weight else None
        null_auc = auc(y, (~present).astype(int))
        by_quarter = defaultdict(lambda: [0, 0])
        for q, isnull in zip(quarters, ~present):
            by_quarter[q][0] += int(isnull)
            by_quarter[q][1] += 1
        null_rates = {q: round(v[0] / v[1], 4) for q, v in sorted(by_quarter.items())}
        swing = max(null_rates.values()) - min(null_rates.values())
        pooled = auc(y[present], x[present])
        period = auc(recent[present], x[present])
        flags = []
        if pooled is not None and oriented(pooled) >= SUSPICIOUS_AUC:
            flags.append("high_single_feature_auc")
        if within_auc is not None and oriented(within_auc) >= SUSPICIOUS_AUC:
            flags.append("high_within_repo_auc")
        if null_auc is not None and oriented(null_auc) >= SUSPICIOUS_AUC:
            flags.append("null_indicator_predicts_label")
        if swing > NULL_SWING:
            flags.append("null_rate_tracks_time")
        features[e["name"]] = {
            "non_null": int(present.sum()),
            "auc": None if pooled is None else round(pooled, 4),
            "within_repo_auc": None if within_auc is None else round(within_auc, 4),
            "null_indicator_auc": None if null_auc is None else round(null_auc, 4),
            "recent_period_auc": None if period is None else round(period, 4),
            "null_rate_by_quarter": null_rates,
            "null_rate_swing": round(swing, 4),
            "flags": flags,
        }

    # Agent markers by quarter.
    marker_by_quarter = defaultdict(lambda: [0, 0])
    for q, r in zip(quarters, rows):
        if r["feature.agent.marker_present"] is not None:
            marker_by_quarter[q][0] += int(r["feature.agent.marker_present"])
            marker_by_quarter[q][1] += 1
    label_by_quarter = defaultdict(lambda: [0, 0])
    for q, t in zip(quarters, labels):
        label_by_quarter[q][0] += t
        label_by_quarter[q][1] += 1

    # Models. Categories are one-hot here, from the closed list, so no label enters the encoding.
    def matrix(include_agent):
        cols = []
        names = []
        for e in inputs:
            name = e["name"]
            if not include_agent and name.startswith("feature.agent."):
                continue
            if name in categories:
                for c in categories[name]:
                    cols.append(np.array([1.0 if r[name] == c else (np.nan if r[name] is None else 0.0) for r in rows]))
                    names.append(f"{name}={c}")
            else:
                x = np.full(n, np.nan)
                for i, r in enumerate(rows):
                    if r[name] is not None:
                        x[i] = float(r[name])
                cols.append(x)
                names.append(name)
        return np.column_stack(cols), names

    def evaluate(X):
        out = {}
        train = recent == 0
        model = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, random_state=0).fit(X[train], y[train])
        score = model.predict_proba(X[~train])[:, 1]
        out["temporal"] = {"auc": round(float(roc_auc_score(y[~train], score)), 4), "pr_auc": round(float(average_precision_score(y[~train], score)), 4), "test_rows": int((~train).sum()), "test_positives": int(y[~train].sum())}
        scores = np.zeros(n)
        for tr, te in GroupKFold(n_splits=4).split(X, y, groups):
            scores[te] = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, random_state=0).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
        out["repo_grouped"] = {"auc": round(float(roc_auc_score(y, scores)), 4), "pr_auc": round(float(average_precision_score(y, scores)), 4)}
        return out

    with_agent, _ = matrix(True)
    without_agent, _ = matrix(False)
    agent_cols = [e["name"] for e in inputs if e["name"].startswith("feature.agent.")]
    markers = []
    for name in agent_cols:
        if name in categories:
            for c in categories[name]:
                markers.append([1.0 if r[name] == c else 0.0 for r in rows])
        else:
            markers.append([0.0 if r[name] is None else float(r[name]) for r in rows])
    M = np.array(markers).T
    train = recent == 0
    lr = LogisticRegression(max_iter=2000).fit(M[train], y[train])
    marker_only = round(float(roc_auc_score(y[~train], lr.predict_proba(M[~train])[:, 1])), 4)

    marked = np.array([bool(r["feature.agent.marker_present"]) for r in rows])
    result = {
        "procedure": "hok-3023-suspicion-scan",
        "excluded_slice_sha256": hashlib.sha256(slice_bytes).hexdigest(),
        "target": {"name": "corrective_rework", "horizon_days": HORIZON, "note": "label pipeline output as of the HOK-3022 run; the target version is not yet pinned (HOK-3269)"},
        "development_repos": len(repos),
        "rows": n,
        "positives": int(y.sum()),
        "base_rate": round(float(y.mean()), 4),
        "recent_period_from": RECENT_FROM,
        "thresholds": {"suspicious_auc": SUSPICIOUS_AUC, "null_rate_swing": NULL_SWING},
        "features": features,
        "flagged": sorted(name for name, f in features.items() if f["flags"]),
        "agent_marker_rate_by_quarter": {q: round(v[0] / v[1], 4) for q, v in sorted(marker_by_quarter.items())},
        "label_rate_by_quarter": {q: round(v[0] / v[1], 4) for q, v in sorted(label_by_quarter.items())},
        "label_rate_marked": round(float(y[marked].mean()), 4) if marked.any() else None,
        "label_rate_unmarked": round(float(y[~marked].mean()), 4),
        "models": {
            "with_agent_markers": evaluate(with_agent),
            "without_agent_markers": evaluate(without_agent),
            "agent_markers_only_temporal_auc": marker_only,
        },
    }
    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    print(json.dumps({k: result[k] for k in ("rows", "positives", "flagged", "models")}))


if __name__ == "__main__":
    main()
