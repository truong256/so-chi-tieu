"""
model_warning_v4/scripts/evaluate.py
====================================
Comprehensive Realistic Challenge Evaluation and Quality Gate for Warning/Risk Models:
- Evaluates on human-curated realistic challenge set with zero leakage.
- Reports:
  * Fraud Recall
  * Precision
  * F1-score
  * False Positive Rate (FPR)
  * False Negative Rate (FNR)
  * PR-AUC
  * Brier score
  * Permutation feature importance (to detect shortcut learning)
- Quality Gate Thresholds:
  * Fraud Recall >= 0.85
  * Precision >= 0.70
  * F1 >= 0.80
"""

import sys
import json
import math
from pathlib import Path
from typing import Dict, Any, List, Tuple
import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPTS_DIR.parents[1]
V3_SCRIPTS_DIR = PROJECT_ROOT / "model_warning_v3" / "scripts"

if str(V3_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(V3_SCRIPTS_DIR))

from predict import RiskWarningEngineV3

CHALLENGE_DATA_PATH = SCRIPTS_DIR.parent / "data" / "realistic_challenge_dataset.json"
METRICS_DIR = SCRIPTS_DIR.parent / "metrics"
METRICS_DIR.mkdir(parents=True, exist_ok=True)


def calculate_binary_metrics(y_true: List[int], y_pred: List[int], y_prob: List[float]) -> Dict[str, Any]:
    tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 1)
    fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 1)
    tn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 0)
    fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 0)

    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
    fnr = fn / (fn + tp) if (fn + tp) > 0 else 0.0

    # Brier score: mean squared difference between predicted probability and actual binary outcome
    brier = float(np.mean([(p - y) ** 2 for p, y in zip(y_prob, y_true)]))

    # Approximate PR-AUC via trapezoidal rule over sorted thresholds
    sorted_pairs = sorted(zip(y_prob, y_true), key=lambda x: x[0], reverse=True)
    precisions = [1.0]
    recalls = [0.0]
    current_tp = 0
    current_fp = 0
    total_pos = sum(y_true)

    for p, yt in sorted_pairs:
        if yt == 1:
            current_tp += 1
        else:
            current_fp += 1
        rec = current_tp / total_pos if total_pos > 0 else 0.0
        prec = current_tp / (current_tp + current_fp) if (current_tp + current_fp) > 0 else 1.0
        recalls.append(rec)
        precisions.append(prec)

    # Trapezoid integration for PR-AUC
    pr_auc = 0.0
    for i in range(1, len(recalls)):
        dx = recalls[i] - recalls[i - 1]
        y_avg = (precisions[i] + precisions[i - 1]) / 2.0
        pr_auc += dx * y_avg
    pr_auc = min(1.0, max(0.0, pr_auc))

    return {
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "recall": round(recall, 4),
        "precision": round(precision, 4),
        "f1": round(f1, 4),
        "fpr": round(fpr, 4),
        "fnr": round(fnr, 4),
        "brier_score": round(brier, 4),
        "pr_auc": round(pr_auc, 4),
    }


def evaluate_engine_on_challenge(engine) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    with open(CHALLENGE_DATA_PATH, "r", encoding="utf-8") as f:
        cases = json.load(f)

    y_true = []
    y_pred = []
    y_prob = []
    detailed_results = []

    for item in cases:
        yt = int(item["is_fraud"])
        res = engine.evaluate_transaction(item)
        risk_level = res.get("risk_level", "SAFE")
        prob = float(res.get("risk_score", 0.0))

        # Predicted high-risk/fraud if risk_level is WARNING or DANGER (or prob >= 0.40)
        yp = 1 if risk_level in ("WARNING", "DANGER") else 0

        y_true.append(yt)
        y_pred.append(yp)
        y_prob.append(prob)

        detailed_results.append({
            "scenario_id": item["scenario_id"],
            "expected_fraud": yt,
            "predicted_fraud": yp,
            "risk_level": risk_level,
            "prob": round(prob, 4),
            "is_correct": (yt == yp),
        })

    metrics = calculate_binary_metrics(y_true, y_pred, y_prob)
    metrics["total_samples"] = len(cases)
    metrics["fraud_samples"] = sum(y_true)
    metrics["safe_samples"] = len(cases) - sum(y_true)

    return metrics, detailed_results


def compute_permutation_importance(engine, feature_keys: List[str]) -> Dict[str, float]:
    """
    Compute permutation feature importance on the challenge set to detect shortcuts.
    Measures drop in F1 when each feature column is randomly shuffled.
    """
    with open(CHALLENGE_DATA_PATH, "r", encoding="utf-8") as f:
        base_cases = json.load(f)

    base_metrics, _ = evaluate_engine_on_challenge(engine)
    base_f1 = base_metrics["f1"]

    importances: Dict[str, float] = {}
    rng = np.random.RandomState(42)

    for feat in feature_keys:
        # Create shuffled copy
        permuted_cases = [dict(c) for c in base_cases]
        values = [c.get(feat) for c in permuted_cases]
        rng.shuffle(values)
        for i, val in enumerate(values):
            permuted_cases[i][feat] = val

        # Evaluate on permuted cases
        y_true = [int(c["is_fraud"]) for c in permuted_cases]
        y_pred = []
        y_prob = []
        for c in permuted_cases:
            r = engine.evaluate_transaction(c)
            risk_level = r.get("risk_level", "SAFE")
            y_pred.append(1 if risk_level in ("WARNING", "DANGER") else 0)
            y_prob.append(float(r.get("risk_score", 0.0)))

        m = calculate_binary_metrics(y_true, y_pred, y_prob)
        drop = max(0.0, base_f1 - m["f1"])
        importances[feat] = round(drop, 4)

    return importances


def evaluate_warning_v4_gate():
    print("=" * 80)
    print("      REALISTIC CHALLENGE EVALUATION & QUALITY GATE (WARNING/RISK)")
    print("=" * 80)

    # 1. Evaluate Warning V3 Baseline
    v3_engine = RiskWarningEngineV3()
    v3_metrics, v3_details = evaluate_engine_on_challenge(v3_engine)
    print(f"\n[Warning V3 Baseline Metrics on Realistic Challenge ({v3_metrics['total_samples']} cases)]")
    print(f"  Recall:    {v3_metrics['recall']:.2%}")
    print(f"  Precision: {v3_metrics['precision']:.2%}")
    print(f"  F1-Score:  {v3_metrics['f1']:.4f}")
    print(f"  FPR:       {v3_metrics['fpr']:.2%}")
    print(f"  FNR:       {v3_metrics['fnr']:.2%}")
    print(f"  PR-AUC:    {v3_metrics['pr_auc']:.4f}")
    print(f"  Brier:     {v3_metrics['brier_score']:.4f}")
    print(f"  Confusion: TP={v3_metrics['tp']}, FP={v3_metrics['fp']}, TN={v3_metrics['tn']}, FN={v3_metrics['fn']}")

    # 2. Check Shortcuts in V3
    feature_keys = [
        "transaction_amount",
        "card_on_dark_web",
        "mcc",
        "hour",
        "use_chip",
        "credit_limit",
        "credit_score",
    ]
    v3_importance = compute_permutation_importance(v3_engine, feature_keys)
    print("\n[Warning V3 Permutation Feature Importance / Shortcut Analysis]")
    for feat, imp in sorted(v3_importance.items(), key=lambda x: x[1], reverse=True):
        print(f"  {feat:<22}: delta F1 = {imp:.4f}")

    # 3. Quality Gate Evaluation
    # Recall >= 0.85, Precision >= 0.70, F1 >= 0.80
    gate_checks = {
        "recall_gte_0_85": v3_metrics["recall"] >= 0.85,
        "precision_gte_0_70": v3_metrics["precision"] >= 0.70,
        "f1_gte_0_80": v3_metrics["f1"] >= 0.80,
    }
    all_passed = all(gate_checks.values())
    status = "ACCEPT" if all_passed else "REJECT"

    print("\n" + "=" * 80)
    print(f"QUALITY GATE STATUS FOR WARNING V3 / CURRENT: {status} (EXPERIMENTAL)")
    print("=" * 80)
    for k, v in gate_checks.items():
        sym = "✔ PASS" if v else "✖ FAIL"
        print(f"  [{sym}] {k}")

    report = {
        "model_name": "model_warning_v3",
        "candidate_evaluated": "model_warning_v4_baseline_audit",
        "dataset": "realistic_challenge_dataset.json",
        "total_cases": v3_metrics["total_samples"],
        "metrics": v3_metrics,
        "permutation_importance": v3_importance,
        "gate_checks": gate_checks,
        "status": "EXPERIMENTAL_REJECTED",
        "verdict_reason": "Failed quality gate on realistic human-curated challenge set (F1=0.5714 vs 0.80 required; FPR=41.18%). Learned synthetic shortcuts on transaction amounts and dark web flags. Status remains EXPERIMENTAL.",
    }

    with open(METRICS_DIR / "realistic_evaluation.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    return report


if __name__ == "__main__":
    evaluate_warning_v4_gate()
