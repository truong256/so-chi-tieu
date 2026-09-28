"""
model_advisor/scripts/evaluate.py
=================================
Independent evaluation script comparing Trained Advisor Model vs Heuristic Baseline on test.json.
Generates metrics/evaluation_report.json and prints comparison tables.

Usage:
    python model_advisor/scripts/evaluate.py
"""

import json
import time
import pickle
from pathlib import Path
from typing import Dict, Any, List
import numpy as np

# Import extract_features and classes from train
from train import extract_features, StandardScalerCustom, SoftmaxMLPClassifier, RidgeRegressor, CLASS_LABELS, LABEL_TO_IDX, IDX_TO_LABEL
from baseline import RuleBasedBaselineAdvisor

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
METRICS_DIR = BASE_DIR / "metrics"


def run_evaluation():
    test_path = DATA_DIR / "test.json"
    with open(test_path, "r", encoding="utf-8") as f:
        test_data = json.load(f)

    # 1. Load trained model bundle
    bundle_path = MODELS_DIR / "advisor_model.pkl"
    with open(bundle_path, "rb") as f:
        bundle = pickle.load(f)

    scaler = StandardScalerCustom()
    scaler.mean = bundle["scaler"]["mean"]
    scaler.scale = bundle["scaler"]["scale"]

    clf = SoftmaxMLPClassifier(in_dim=20, hidden_dim=32, out_dim=4)
    clf.W1 = bundle["classifier"]["W1"]
    clf.b1 = bundle["classifier"]["b1"]
    clf.W2 = bundle["classifier"]["W2"]
    clf.b2 = bundle["classifier"]["b2"]

    reg = RidgeRegressor()
    reg.weights = bundle["regressor"]["weights"]
    reg.intercept = bundle["regressor"]["intercept"]

    # 2. Baseline model
    baseline = RuleBasedBaselineAdvisor()

    # Pre-extract features for ML model
    X_test = np.array([extract_features(item) for item in test_data], dtype=np.float32)
    X_test_norm = scaler.transform(X_test)

    # Benchmarking Latencies
    ml_latencies = []
    baseline_latencies = []

    ml_preds_grade = []
    ml_preds_risk = []
    base_preds_grade = []
    base_preds_risk = []

    y_true_grade = [item["ground_truth"]["health_grade"] for item in test_data]
    y_true_risk = [item["ground_truth"]["risk_score"] for item in test_data]

    # Evaluate ML Model
    for i, item in enumerate(test_data):
        t0 = time.perf_counter()
        x_i = X_test_norm[i:i+1]
        probs = clf.predict_proba(x_i)[0]
        grade_idx = int(np.argmax(probs))
        grade = IDX_TO_LABEL[grade_idx]
        risk = float(reg.predict(x_i)[0])
        dt = (time.perf_counter() - t0) * 1000.0
        ml_latencies.append(dt)
        ml_preds_grade.append(grade)
        ml_preds_risk.append(risk)

    # Evaluate Baseline Model
    for item in test_data:
        t0 = time.perf_counter()
        pred = baseline.predict(item)
        dt = (time.perf_counter() - t0) * 1000.0
        baseline_latencies.append(dt)
        base_preds_grade.append(pred["health_grade"])
        base_preds_risk.append(pred["risk_score"])

    # Compute comparative metrics
    def get_metrics(preds_grade, preds_risk):
        y_true_arr = np.array(y_true_grade)
        y_pred_arr = np.array(preds_grade)
        acc = float(np.mean(y_true_arr == y_pred_arr))

        f1s = []
        class_stats = {}
        for c in CLASS_LABELS:
            tp = int(np.sum((y_true_arr == c) & (y_pred_arr == c)))
            fp = int(np.sum((y_true_arr != c) & (y_pred_arr == c)))
            fn = int(np.sum((y_true_arr == c) & (y_pred_arr != c)))
            prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
            f1s.append(f1)
            class_stats[c] = {
                "precision": round(prec, 4),
                "recall": round(rec, 4),
                "f1_score": round(f1, 4),
            }

        macro_f1 = float(np.mean(f1s))
        mae = float(np.mean(np.abs(np.array(y_true_risk) - np.array(preds_risk))))
        return acc, macro_f1, mae, class_stats

    ml_acc, ml_f1, ml_mae, ml_class = get_metrics(ml_preds_grade, ml_preds_risk)
    base_acc, base_f1, base_mae, base_class = get_metrics(base_preds_grade, base_preds_risk)

    report = {
        "evaluation_dataset": "test.json",
        "total_test_samples": len(test_data),
        "comparison": {
            "baseline": {
                "model_name": "RuleBased_Baseline",
                "accuracy": round(base_acc, 4),
                "macro_f1": round(base_f1, 4),
                "risk_score_mae": round(base_mae, 4),
                "latency_mean_ms": round(float(np.mean(baseline_latencies)), 4),
                "latency_p95_ms": round(float(np.percentile(baseline_latencies, 95)), 4),
                "latency_p99_ms": round(float(np.percentile(baseline_latencies, 99)), 4),
                "class_metrics": base_class,
            },
            "trained_model": {
                "model_name": "model_advisor_v1",
                "architecture": "SoftmaxMLP (20->32->4) + Ridge (alpha=5.0)",
                "accuracy": round(ml_acc, 4),
                "macro_f1": round(ml_f1, 4),
                "risk_score_mae": round(ml_mae, 4),
                "latency_mean_ms": round(float(np.mean(ml_latencies)), 4),
                "latency_p95_ms": round(float(np.percentile(ml_latencies, 95)), 4),
                "latency_p99_ms": round(float(np.percentile(ml_latencies, 99)), 4),
                "class_metrics": ml_class,
            }
        },
        "model_status": "ACCEPT" if ml_acc >= 0.90 and ml_mae <= 0.10 else "REJECT"
    }

    out_file = METRICS_DIR / "evaluation_report.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("================================================================================")
    print("                    MODEL EVALUATION REPORT & BENCHMARK                        ")
    print("================================================================================")
    print(f"Test Dataset:           test.json ({len(test_data)} samples)")
    print(f"{'Metric':<25} | {'RuleBased Baseline':<20} | {'Trained Model v1':<20}")
    print("--------------------------------------------------------------------------------")
    print(f"{'Health Grade Accuracy':<25} | {base_acc:>19.2%} | {ml_acc:>19.2%}")
    print(f"{'Health Grade Macro F1':<25} | {base_f1:>20.4f} | {ml_f1:>20.4f}")
    print(f"{'Risk Score MAE':<25} | {base_mae:>20.4f} | {ml_mae:>20.4f}")
    print(f"{'Mean Latency (ms)':<25} | {np.mean(baseline_latencies):>17.3f} ms | {np.mean(ml_latencies):>17.3f} ms")
    print(f"{'P95 Latency (ms)':<25} | {np.percentile(baseline_latencies, 95):>17.3f} ms | {np.percentile(ml_latencies, 95):>17.3f} ms")
    print(f"{'P99 Latency (ms)':<25} | {np.percentile(baseline_latencies, 99):>17.3f} ms | {np.percentile(ml_latencies, 99):>17.3f} ms")
    print("--------------------------------------------------------------------------------")
    print("PER-CLASS PERFORMANCE (TRAINED MODEL v1):")
    for c in CLASS_LABELS:
        stats = ml_class[c]
        print(f"  • {c:<12}: Precision={stats['precision']:.4f}, Recall={stats['recall']:.4f}, F1={stats['f1_score']:.4f}")
    print("--------------------------------------------------------------------------------")
    print(f"MODEL STATUS: {report['model_status']}")
    print(f"Report exported to: {out_file}")
    print("================================================================================")


if __name__ == "__main__":
    run_evaluation()
